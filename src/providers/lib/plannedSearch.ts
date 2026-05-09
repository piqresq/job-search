import { getSearchRoleTiers } from "../../db/appSettings";
import {
  ensureProviderPlanInitialized,
  listProviderCountryStates,
  listProviderQueryUnitStates,
  listProviderUnitScheduleStates,
  loadProviderSchedulerState,
  commitProviderUnitPickAndPagination,
  type ProviderCountryPlan,
  type ProviderCountryStateRow,
  type ProviderQueryUnitPlan,
  type ProviderQueryUnitStateRow,
  type ProviderUnitScheduleStateRow,
  updateCountryState,
  updateProviderCountryCursor,
  updateQueryUnitState,
} from "../../db/providerScheduler";
import { log, observabilityLog } from "../../logging/appLog";
import type { JobSourceId, NormalizedJob } from "../../types/job";
import type { ProviderChunkResult } from "../types";
import { mergeRequestParamRecords } from "../../lib/httpRequestParamsRecord";
import { finalizeNormalizedJob } from "./normalizedJobValidation";
import { nextUtcMidnightUnix } from "../../lib/nextUtcMidnight";
import { assignWorkplaceTypeToJob } from "./workplaceTypeCanonical";

const DEFAULT_ERROR_BACKOFF_SECONDS = 5 * 60;

export class PlannedSearchBackoffError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds = DEFAULT_ERROR_BACKOFF_SECONDS) {
    super(message);
    this.name = "PlannedSearchBackoffError";
    this.retryAfterSeconds = Math.max(30, retryAfterSeconds);
  }
}

export class PlannedSearchDoneForCycleError extends Error {
  readonly nextEligibleAt: number;
  readonly meta: Record<string, unknown>;

  constructor(message: string, nextEligibleAt: number, meta: Record<string, unknown> = {}) {
    super(message);
    this.name = "PlannedSearchDoneForCycleError";
    this.nextEligibleAt = Math.max(0, nextEligibleAt);
    this.meta = meta;
  }
}

export type SearchPageResult<TSearchRow> = {
  rows: TSearchRow[];
  nextCursor?: string | null;
  meta?: Record<string, unknown>;
  /** Params for the list/search HTTP request (merged onto each job in this page). */
  ingestionRequestParams?: Record<string, string | number | boolean>;
};

export type PlannedSearchContext = {
  providerId: JobSourceId;
  cycleId: string;
  country: ProviderCountryPlan;
  queryUnit: ProviderQueryUnitPlan;
  cursor: string | null;
};

export type PlannedSearchOptions<TSearchRow, TDetail> = {
  env: Env;
  userId: string;
  providerId: JobSourceId;
  cycleId: string;
  countries: ProviderCountryPlan[];
  queryUnits?: ProviderQueryUnitPlan[];
  buildQueryUnits?: (roles: { tier1: string[]; tier2: string[] }) => ProviderQueryUnitPlan[];
  maxSearchAttemptsPerChunk: number;
  maxDetailFetches: number;
  /** @deprecated All configured positions are now planned as tier 1. */
  tierSequence?: readonly (1 | 2)[];
  defaultIsRemote?: boolean;
  search: (ctx: PlannedSearchContext) => Promise<SearchPageResult<TSearchRow>>;
  rowId: (row: TSearchRow) => string | undefined;
  fetchDetail?: (ctx: PlannedSearchContext & { row: TSearchRow; id: string }) => Promise<TDetail | null>;
  merge: (row: TSearchRow, detail: TDetail | null, ctx: PlannedSearchContext) => NormalizedJob | null;
};

export function buildSingleRoleQueryUnits(roles: { tier1: string[]; tier2: string[] }): ProviderQueryUnitPlan[] {
  return [
    ...roles.tier1.map((role, idx) => ({ id: `tier1:${idx}:${role}`, tier: 1 as const, queryValue: role })),
    ...roles.tier2.map((role, idx) => ({ id: `tier1:legacy-tier2:${idx}:${role}`, tier: 1 as const, queryValue: role })),
  ];
}

export function buildConcatTierQueryUnits(
  roles: { tier1: string[]; tier2: string[] },
  joinRoles: (roles: string[]) => string,
): ProviderQueryUnitPlan[] {
  const out: ProviderQueryUnitPlan[] = [];
  if (roles.tier1.length) {
    out.push({ id: "tier1:bundle", tier: 1, queryValue: joinRoles(roles.tier1) });
  }
  if (roles.tier2.length) {
    out.push({ id: "tier1:legacy-tier2:bundle", tier: 1, queryValue: joinRoles(roles.tier2) });
  }
  return out;
}

export function resolvePlannerPaginationCommit(args: {
  originalCursor: string | null;
  nextCursor: string | null;
  hydrationStoppedCycle: boolean;
}): {
  paginationCursor: string | null;
  exhausted: boolean;
} {
  if (args.hydrationStoppedCycle) {
    return {
      // Preserve the current page cursor so the unhydrated tail is retried instead of skipped.
      paginationCursor: args.originalCursor,
      exhausted: false,
    };
  }
  return {
    paginationCursor: args.nextCursor,
    exhausted: !args.nextCursor,
  };
}

function minEligible(values: number[]): number {
  let out = 0;
  for (const value of values) {
    if (value <= 0) continue;
    if (out === 0 || value < out) out = value;
  }
  return out;
}

function unitIsExhausted(unit: ProviderQueryUnitStateRow): boolean {
  return unit.exhausted === 1;
}

function countryIsExhausted(country: ProviderCountryStateRow): boolean {
  return country.exhausted === 1;
}

function unitScheduleSortValues(
  unit: ProviderQueryUnitStateRow,
  schedules: Map<string, ProviderUnitScheduleStateRow>,
  unitOrder: Map<string, number>,
): { pickCount: number; lastPickedAt: number; order: number } {
  const row = schedules.get(unit.unit_id);
  return {
    pickCount: row?.pick_count ?? 0,
    lastPickedAt: row?.last_picked_at ?? 0,
    order: unitOrder.get(unit.unit_id) ?? Number.MAX_SAFE_INTEGER,
  };
}

function chooseLeastUsedUnit(
  units: ProviderQueryUnitStateRow[],
  now: number,
  schedules: Map<string, ProviderUnitScheduleStateRow>,
  unitOrder: Map<string, number>,
): { unit: ProviderQueryUnitStateRow | null; nextEligibleAt: number; hasActive: boolean } {
  if (!units.length) {
    return { unit: null, nextEligibleAt: 0, hasActive: false };
  }

  let nextEligibleAt = 0;
  let hasActive = false;
  const candidates: ProviderQueryUnitStateRow[] = [];
  for (const unit of units) {
    if (unitIsExhausted(unit)) continue;
    hasActive = true;
    if (unit.next_eligible_at > now) {
      nextEligibleAt = minEligible([nextEligibleAt, unit.next_eligible_at]);
      continue;
    }
    candidates.push(unit);
  }

  if (!candidates.length) {
    return { unit: null, nextEligibleAt, hasActive };
  }

  candidates.sort((a, b) => {
    const av = unitScheduleSortValues(a, schedules, unitOrder);
    const bv = unitScheduleSortValues(b, schedules, unitOrder);
    return (
      av.pickCount - bv.pickCount ||
      av.lastPickedAt - bv.lastPickedAt ||
      av.order - bv.order ||
      a.unit_id.localeCompare(b.unit_id)
    );
  });

  return { unit: candidates[0]!, nextEligibleAt: 0, hasActive };
}

function pickUnitForCountryFair(
  units: ProviderQueryUnitStateRow[],
  now: number,
  schedules: Map<string, ProviderUnitScheduleStateRow>,
  unitOrder: Map<string, number>,
): {
  unit: ProviderQueryUnitStateRow | null;
  tier: 1 | 2;
  nextEligibleAt: number;
  countryExhausted: boolean;
} {
  const hasAnyActive = units.some((unit) => !unitIsExhausted(unit));
  if (!hasAnyActive) {
    return {
      unit: null,
      tier: 1,
      nextEligibleAt: 0,
      countryExhausted: true,
    };
  }

  const picked = chooseLeastUsedUnit(units, now, schedules, unitOrder);
  if (picked.unit) {
    return {
      unit: picked.unit,
      tier: 1,
      nextEligibleAt: 0,
      countryExhausted: false,
    };
  }

  return {
    unit: null,
    tier: 1,
    nextEligibleAt: picked.nextEligibleAt,
    countryExhausted: false,
  };
}

function countryScanDistance(index: number, cursor: number, total: number): number {
  if (total <= 0) return 0;
  return (index - cursor + total) % total;
}

function compareCountryCandidates(
  a: { country: ProviderCountryStateRow; countryIndex: number },
  b: { country: ProviderCountryStateRow; countryIndex: number },
  cursor: number,
  totalCountries: number,
): number {
  return (
    a.country.schedule_pos - b.country.schedule_pos ||
    countryScanDistance(a.countryIndex, cursor, totalCountries) -
      countryScanDistance(b.countryIndex, cursor, totalCountries) ||
    a.country.country_key.localeCompare(b.country.country_key)
  );
}

function pickCountryForProviderFair(
  countries: readonly ProviderCountryPlan[],
  countryMap: Map<string, ProviderCountryStateRow>,
  unitsByCountry: Map<string, ProviderQueryUnitStateRow[]>,
  now: number,
  cursor: number,
  unitSchedules: Map<string, ProviderUnitScheduleStateRow>,
  unitOrder: Map<string, number>,
):
  | {
      country: ProviderCountryStateRow;
      countryIndex: number;
      picked: {
        unit: ProviderQueryUnitStateRow | null;
        tier: 1 | 2;
        nextEligibleAt: number;
        countryExhausted: boolean;
      };
    }
  | null {
  let selectedActive:
    | {
        country: ProviderCountryStateRow;
        countryIndex: number;
        picked: {
          unit: ProviderQueryUnitStateRow | null;
          tier: 1 | 2;
          nextEligibleAt: number;
          countryExhausted: boolean;
        };
      }
    | null = null;
  let selectedExhausted:
    | {
        country: ProviderCountryStateRow;
        countryIndex: number;
        picked: {
          unit: ProviderQueryUnitStateRow | null;
          tier: 1 | 2;
          nextEligibleAt: number;
          countryExhausted: boolean;
        };
      }
    | null = null;

  for (let step = 0; step < countries.length; step++) {
    const idx = (cursor + step) % countries.length;
    const country = countryMap.get(countries[idx]!.key);
    if (!country || countryIsExhausted(country)) continue;
    if (country.next_eligible_at > now) continue;
    const unitRows = unitsByCountry.get(country.country_key) ?? [];
    const picked = pickUnitForCountryFair(unitRows, now, unitSchedules, unitOrder);
    const candidate = { country, countryIndex: idx, picked };

    if (picked.unit) {
      if (
        !selectedActive ||
        compareCountryCandidates(candidate, selectedActive, cursor, countries.length) < 0
      ) {
        selectedActive = candidate;
      }
      continue;
    }

    if (
      picked.countryExhausted &&
      (!selectedExhausted ||
        compareCountryCandidates(candidate, selectedExhausted, cursor, countries.length) < 0)
    ) {
      selectedExhausted = candidate;
    }
  }

  return selectedActive ?? selectedExhausted;
}

function allCountriesExhausted(countries: ProviderCountryStateRow[]): boolean {
  return countries.length > 0 && countries.every(countryIsExhausted);
}

function providerNextEligibleAt(
  countries: ProviderCountryStateRow[],
  unitsByCountry: Map<string, ProviderQueryUnitStateRow[]>,
  now: number,
): number {
  const values: number[] = [];
  for (const country of countries) {
    if (countryIsExhausted(country)) continue;
    if (country.next_eligible_at > now) values.push(country.next_eligible_at);
    for (const unit of unitsByCountry.get(country.country_key) ?? []) {
      if (unitIsExhausted(unit)) continue;
      if (unit.next_eligible_at > now) values.push(unit.next_eligible_at);
    }
  }
  return minEligible(values);
}

function doneForCycleResult(
  error: PlannedSearchDoneForCycleError,
  meta: Record<string, unknown>,
  jobs: NormalizedJob[] = [],
): ProviderChunkResult {
  return {
    jobs,
    more: false,
    doneForCycle: true,
    nextEligibleAt: error.nextEligibleAt,
    meta: {
      reason: "provider_request_cap",
      ...meta,
      ...error.meta,
    },
  };
}

function plannerContextMeta(ctx: PlannedSearchContext): Record<string, unknown> {
  return {
    country: ctx.country.fullName,
    countryKey: ctx.country.key,
    query: ctx.queryUnit.queryValue,
    tier: ctx.queryUnit.tier,
  };
}

async function hydrateRows<TSearchRow, TDetail>(
  opts: PlannedSearchOptions<TSearchRow, TDetail>,
  ctx: PlannedSearchContext,
  rows: TSearchRow[],
  pageIngestionRequestParams?: Record<string, string | number | boolean>,
): Promise<{ jobs: NormalizedJob[]; doneForCycleError: PlannedSearchDoneForCycleError | null }> {
  const out: NormalizedJob[] = [];
  for (const row of rows.slice(0, Math.max(0, opts.maxDetailFetches))) {
    const id = opts.rowId(row)?.trim();
    if (!id) continue;

    let detail: TDetail | null = null;
    if (opts.fetchDetail) {
      try {
        detail = await opts.fetchDetail({ ...ctx, row, id });
      } catch (error) {
        if (error instanceof PlannedSearchDoneForCycleError) {
          return { jobs: out, doneForCycleError: error };
        }
        if (error instanceof PlannedSearchBackoffError) {
          throw error;
        }
        const msg = error instanceof Error ? error.message : String(error);
        await log.low(
          opts.env,
          opts.providerId,
          "Detail fetch failed; skipping row",
          {
            country: ctx.country.fullName,
            query: ctx.queryUnit.queryValue,
            id,
            error: msg.slice(0, 300),
          },
          {
            category: "vendor",
            eventType: "detail_fetch_skipped",
            providerId: opts.providerId,
            phase: "hydrateRows",
            statusKind: "degraded",
          },
        );
        continue;
      }
    }

    const merged = opts.merge(row, detail, ctx);
    const finalized = finalizeNormalizedJob(merged, {
      country: ctx.country.fullName,
      location: ctx.country.fullName,
      isRemote: opts.defaultIsRemote,
      countries: opts.countries,
    });
    if (!finalized) continue;
    const searchQuery = finalized.searchQuery?.trim() || ctx.queryUnit.queryValue.trim() || undefined;
    const withSearchMeta: NormalizedJob = {
      ...finalized,
      searchQuery,
      searchTier: finalized.searchTier ?? ctx.queryUnit.tier,
      searchCountryKey: finalized.searchCountryKey ?? ctx.country.key,
      searchCountryLabel: finalized.searchCountryLabel ?? ctx.country.fullName,
    };
    const fromMerge = merged?.ingestionRequestParams;
    const combined = mergeRequestParamRecords(pageIngestionRequestParams, fromMerge);
    if (Object.keys(combined).length > 0) {
      out.push(assignWorkplaceTypeToJob({ ...withSearchMeta, ingestionRequestParams: combined }));
    } else {
      out.push(assignWorkplaceTypeToJob(withSearchMeta));
    }
  }
  return { jobs: out, doneForCycleError: null };
}

export async function runPlannedSearchProvider<TSearchRow, TDetail>(
  opts: PlannedSearchOptions<TSearchRow, TDetail>,
): Promise<ProviderChunkResult> {
  const now = Math.floor(Date.now() / 1000);
  const roleTiers = await getSearchRoleTiers(opts.env.DB, opts.userId);
  const queryUnits =
    opts.queryUnits && opts.queryUnits.length
      ? opts.queryUnits
      : opts.buildQueryUnits
        ? opts.buildQueryUnits(roleTiers)
        : buildSingleRoleQueryUnits(roleTiers);
  const countries = opts.countries;

  if (!countries.length || !queryUnits.length) {
    return {
      jobs: [],
      more: false,
      doneForCycle: true,
      nextEligibleAt: nextUtcMidnightUnix(now),
      meta: { reason: "no_countries_or_queries" },
    };
  }

  await ensureProviderPlanInitialized(
    opts.env.DB,
    opts.userId,
    opts.providerId,
    opts.cycleId,
    countries,
    queryUnits,
    now,
  );

  const scheduler = await loadProviderSchedulerState(opts.env.DB, opts.userId, opts.providerId);
  const countryStates = await listProviderCountryStates(opts.env.DB, opts.userId, opts.providerId);
  const unitStates = await listProviderQueryUnitStates(opts.env.DB, opts.userId, opts.providerId);
  const unitScheduleStates = await listProviderUnitScheduleStates(opts.env.DB, opts.userId, opts.providerId);
  const countryMap = new Map(countryStates.map((country) => [country.country_key, country]));
  const unitsByCountry = new Map<string, ProviderQueryUnitStateRow[]>();
  for (const unit of unitStates) {
    const arr = unitsByCountry.get(unit.country_key) ?? [];
    arr.push(unit);
    unitsByCountry.set(unit.country_key, arr);
  }
  const unitSchedules = new Map(unitScheduleStates.map((row) => [row.unit_id, row]));
  const unitOrder = new Map(queryUnits.map((unit, idx) => [unit.id, idx]));

  let cursor = scheduler?.country_cursor ?? 0;

  for (let attempt = 0; attempt < Math.max(1, opts.maxSearchAttemptsPerChunk); ) {
    const selected = pickCountryForProviderFair(
      countries,
      countryMap,
      unitsByCountry,
      now,
      cursor,
      unitSchedules,
      unitOrder,
    );
    const selectedCountry = selected?.country ?? null;
    let selectedCountryIndex = selected?.countryIndex ?? cursor % countries.length;
    let selectedPick = selected?.picked ?? null;

    if (!selectedCountry) {
      const nextEligibleAt = providerNextEligibleAt(countryStates, unitsByCountry, now);
      if (allCountriesExhausted(countryStates)) {
        observabilityLog(
          "debug",
          opts.providerId,
          "Planned-search provider exhausted for current cycle",
          {
            cycleId: opts.cycleId,
            countries: countries.length,
            queryUnits: queryUnits.length,
          },
          {
            category: "vendor",
            eventType: "planned_search_provider_exhausted",
            providerId: opts.providerId,
            cycleId: opts.cycleId,
            phase: "planner",
            statusKind: "sleeping",
          },
        );
        return {
          jobs: [],
          more: false,
          doneForCycle: true,
          nextEligibleAt: nextUtcMidnightUnix(now),
          meta: { reason: "provider_exhausted" },
        };
      }
      observabilityLog(
        "debug",
        opts.providerId,
        "Planned-search waiting for next eligible path",
        {
          cycleId: opts.cycleId,
          nextEligibleAt: nextEligibleAt || now + 60,
          countries: countries.length,
        },
        {
          category: "vendor",
          eventType: "planned_search_waiting",
          providerId: opts.providerId,
          cycleId: opts.cycleId,
          phase: "planner",
          statusKind: "paused",
        },
      );
      return {
        jobs: [],
        more: true,
        doneForCycle: false,
        nextEligibleAt: nextEligibleAt || now + 60,
        meta: { reason: "planner_cooldown" },
      };
    }

    cursor = (selectedCountryIndex + 1) % countries.length;
    await updateProviderCountryCursor(opts.env.DB, opts.userId, opts.providerId, cursor, now);

    const unitRows = unitsByCountry.get(selectedCountry.country_key) ?? [];
    const picked =
      selectedPick ?? pickUnitForCountryFair(unitRows, now, unitSchedules, unitOrder);

    if (picked.countryExhausted) {
      selectedCountry.exhausted = 1;
      await updateCountryState(
        opts.env.DB,
        opts.userId,
        opts.providerId,
        selectedCountry.country_key,
        { exhausted: true, nextEligibleAt: 0, lastError: null },
        now,
      );
      continue;
    }

    if (!picked.unit) {
      selectedCountry.next_eligible_at = picked.nextEligibleAt || now + 60;
      await updateCountryState(
        opts.env.DB,
        opts.userId,
        opts.providerId,
        selectedCountry.country_key,
        { nextEligibleAt: selectedCountry.next_eligible_at },
        now,
      );
      continue;
    }

    attempt += 1;
    selectedCountry.schedule_pos += 1;
    selectedCountry.next_eligible_at = 0;
    selectedCountry.last_error = null;
    await updateCountryState(
      opts.env.DB,
      opts.userId,
      opts.providerId,
      selectedCountry.country_key,
      {
        schedulePos: selectedCountry.schedule_pos,
        nextEligibleAt: 0,
        lastError: null,
      },
      now,
    );

    const planCountry = countries.find((country) => country.key === selectedCountry!.country_key)!;
    const ctx: PlannedSearchContext = {
      providerId: opts.providerId,
      cycleId: opts.cycleId,
      country: planCountry,
      queryUnit: queryUnits.find((unit) => unit.id === picked.unit!.unit_id)!,
      cursor: picked.unit.pagination_cursor,
    };
    observabilityLog(
      "debug",
      opts.providerId,
      "Planned-search path selected",
      {
        cycleId: opts.cycleId,
        attempt,
        country: planCountry.fullName,
        countryKey: planCountry.key,
        queryUnitId: picked.unit.unit_id,
        query: ctx.queryUnit.queryValue,
        tier: picked.tier,
        originalCursorPresent: ctx.cursor != null,
        countrySchedulePos: selectedCountry.schedule_pos,
      },
      {
        category: "vendor",
        eventType: "planned_search_path_selected",
        providerId: opts.providerId,
        cycleId: opts.cycleId,
        phase: "planner",
        statusKind: "running",
      },
    );

    let page: SearchPageResult<TSearchRow>;
    try {
      page = await opts.search(ctx);
    } catch (error) {
      if (error instanceof PlannedSearchDoneForCycleError) {
        return doneForCycleResult(error, plannerContextMeta(ctx));
      }
      const msg = error instanceof Error ? error.message : String(error);
      const retryAfter =
        error instanceof PlannedSearchBackoffError ? error.retryAfterSeconds : DEFAULT_ERROR_BACKOFF_SECONDS;
      picked.unit.next_eligible_at = now + retryAfter;
      picked.unit.consecutive_errors += 1;
      picked.unit.last_error = msg;
      await updateQueryUnitState(
        opts.env.DB,
        opts.userId,
        opts.providerId,
        selectedCountry.country_key,
        picked.unit.unit_id,
        {
          nextEligibleAt: picked.unit.next_eligible_at,
          consecutiveErrors: picked.unit.consecutive_errors,
          lastError: msg,
        },
        now,
      );
      await log.moderate(
        opts.env,
        opts.providerId,
        "Search attempt backed off",
        {
          ...plannerContextMeta(ctx),
          retryAfter,
          error: msg.slice(0, 400),
        },
        {
          category: "vendor",
          eventType: "search_backoff",
          providerId: opts.providerId,
          cycleId: opts.cycleId,
          phase: "search",
          statusKind: "degraded",
        },
      );
      return {
        jobs: [],
        more: true,
        doneForCycle: false,
        nextEligibleAt: now + retryAfter,
        meta: {
          reason: "search_backoff",
          ...plannerContextMeta(ctx),
        },
      };
    }

    const nextCursor = page.nextCursor ?? null;
    const originalCursor = picked.unit.pagination_cursor ?? null;
    observabilityLog(
      "debug",
      opts.providerId,
      "Planned-search page fetched",
      {
        ...plannerContextMeta(ctx),
        cycleId: opts.cycleId,
        rowsReturned: page.rows.length,
        originalCursorPresent: originalCursor != null,
        nextCursorPresent: nextCursor != null,
        pageMeta: page.meta ?? null,
      },
      {
        category: "vendor",
        eventType: "planned_search_page_fetched",
        providerId: opts.providerId,
        cycleId: opts.cycleId,
        phase: "search",
        statusKind: "ok",
      },
    );
    let commitPlan = resolvePlannerPaginationCommit({
      originalCursor,
      nextCursor,
      hydrationStoppedCycle: false,
    });
    let hydration: { jobs: NormalizedJob[]; doneForCycleError: PlannedSearchDoneForCycleError | null } = {
      jobs: [],
      doneForCycleError: null,
    };

    if (page.rows.length > 0) {
      try {
        hydration = await hydrateRows(opts, ctx, page.rows, page.ingestionRequestParams);
      } catch (error) {
        if (error instanceof PlannedSearchDoneForCycleError) {
          hydration = { jobs: [], doneForCycleError: error };
        } else {
          const msg = error instanceof Error ? error.message : String(error);
          const retryAfter =
            error instanceof PlannedSearchBackoffError ? error.retryAfterSeconds : DEFAULT_ERROR_BACKOFF_SECONDS;
          picked.unit.next_eligible_at = now + retryAfter;
          picked.unit.consecutive_errors += 1;
          picked.unit.last_error = msg;
          await updateQueryUnitState(
            opts.env.DB,
            opts.userId,
            opts.providerId,
            selectedCountry.country_key,
            picked.unit.unit_id,
            {
              nextEligibleAt: picked.unit.next_eligible_at,
              consecutiveErrors: picked.unit.consecutive_errors,
              lastError: msg,
            },
            now,
          );
          await log.moderate(
            opts.env,
            opts.providerId,
            "Detail hydration backed off",
            {
              ...plannerContextMeta(ctx),
              retryAfter,
              error: msg.slice(0, 400),
            },
            {
              category: "vendor",
              eventType: "detail_hydration_backoff",
              providerId: opts.providerId,
              cycleId: opts.cycleId,
              phase: "hydrateRows",
              statusKind: "degraded",
            },
          );
          return {
            jobs: [],
            more: true,
            doneForCycle: false,
            nextEligibleAt: now + retryAfter,
            meta: {
              reason: "detail_backoff",
              ...plannerContextMeta(ctx),
            },
          };
        }
      }
      if (hydration.doneForCycleError) {
        commitPlan = resolvePlannerPaginationCommit({
          originalCursor,
          nextCursor,
          hydrationStoppedCycle: true,
        });
      }
      observabilityLog(
        "debug",
        opts.providerId,
        "Planned-search hydration completed",
        {
          ...plannerContextMeta(ctx),
          cycleId: opts.cycleId,
          rowsReturned: page.rows.length,
          jobsBuilt: hydration.jobs.length,
          hydrationStoppedCycle: Boolean(hydration.doneForCycleError),
        },
        {
          category: "vendor",
          eventType: "planned_search_hydration_completed",
          providerId: opts.providerId,
          cycleId: opts.cycleId,
          phase: "hydrateRows",
          statusKind: hydration.doneForCycleError ? "degraded" : "ok",
        },
      );
    }

    await commitProviderUnitPickAndPagination(opts.env.DB, opts.userId, {
      providerId: opts.providerId,
      countryKey: selectedCountry.country_key,
      unitId: picked.unit.unit_id,
      tier: picked.tier,
      planHash: scheduler?.plan_hash ?? "",
      queryValue: ctx.queryUnit.queryValue,
      paginationCursor: commitPlan.paginationCursor,
      exhausted: commitPlan.exhausted,
      now,
    });
    observabilityLog(
      "debug",
      opts.providerId,
      "Planned-search cursor committed",
      {
        ...plannerContextMeta(ctx),
        cycleId: opts.cycleId,
        originalCursorPresent: originalCursor != null,
        nextCursorPresent: nextCursor != null,
        committedCursorPresent: commitPlan.paginationCursor != null,
        exhausted: commitPlan.exhausted,
        hydrationStoppedCycle: Boolean(hydration.doneForCycleError),
        jobsBuilt: hydration.jobs.length,
      },
      {
        category: "vendor",
        eventType: "planned_search_cursor_committed",
        providerId: opts.providerId,
        cycleId: opts.cycleId,
        phase: "planner_commit",
        statusKind: commitPlan.exhausted ? "sleeping" : "ok",
      },
    );

    picked.unit.consecutive_errors = 0;
    picked.unit.last_error = null;
    picked.unit.next_eligible_at = 0;
    picked.unit.pagination_cursor = commitPlan.paginationCursor;
    picked.unit.exhausted = commitPlan.exhausted ? 1 : 0;

    if (scheduler) {
      scheduler.tier1_pick_count += 1;
    }
    const scheduled = unitSchedules.get(picked.unit.unit_id);
    if (scheduled) {
      scheduled.pick_count += 1;
      scheduled.last_picked_at = now;
      scheduled.plan_hash = scheduler?.plan_hash ?? scheduled.plan_hash;
      scheduled.tier = picked.tier;
      scheduled.query_value = ctx.queryUnit.queryValue;
      scheduled.updated_at = now;
    } else {
      unitSchedules.set(picked.unit.unit_id, {
        provider_id: opts.providerId,
        unit_id: picked.unit.unit_id,
        plan_hash: scheduler?.plan_hash ?? "",
        tier: picked.tier,
        query_value: ctx.queryUnit.queryValue,
        pick_count: 1,
        last_picked_at: now,
        updated_at: now,
      });
    }

    if (unitRows.every((unit) => unitIsExhausted(unit))) {
      selectedCountry.exhausted = 1;
      await updateCountryState(
        opts.env.DB,
        opts.userId,
        opts.providerId,
        selectedCountry.country_key,
        { exhausted: true, nextEligibleAt: 0, lastError: null },
        now,
      );
    }

    if (page.rows.length === 0) {
      continue;
    }

    if (hydration.doneForCycleError) {
      return doneForCycleResult(
        hydration.doneForCycleError,
        {
          ...plannerContextMeta(ctx),
          nextCursor,
          ...(page.meta ?? {}),
        },
        hydration.jobs,
      );
    }
    const jobs = hydration.jobs;
    if (jobs.length > 0) {
      const doneForCycle = allCountriesExhausted(countryStates);
      return {
        jobs,
        more: !doneForCycle,
        doneForCycle,
        nextEligibleAt: doneForCycle ? nextUtcMidnightUnix(now) : now,
        meta: {
          ...plannerContextMeta(ctx),
          nextCursor,
          ...(page.meta ?? {}),
        },
      };
    }
  }

  const doneForCycle = allCountriesExhausted(countryStates);
  return {
    jobs: [],
    more: !doneForCycle,
    doneForCycle,
    nextEligibleAt: doneForCycle ? nextUtcMidnightUnix(now) : now,
    meta: { reason: "attempt_budget_exhausted" },
  };
}

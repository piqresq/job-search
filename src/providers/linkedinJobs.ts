import { DEFAULT_LINKEDIN_TITLE_FILTER } from "../config/linkedinTitleFilter";
import {
  DEFAULT_SEARCH_COUNTRIES,
  type SearchCountry,
} from "../config/searchCountries";
import {
  linkedinPathForPolicy,
  linkedinTypeFilterForPolicy,
  type SearchRuntimePolicy,
} from "../config/searchPolicy";
import {
  getLinkedinCountryDrained,
  getLinkedinCountryOffset,
  LINKEDIN_COUNTRY_UNITED_STATES,
  LINKEDIN_NON_US_COUNTRIES,
  resetLinkedinCountryCycle,
  setLinkedinCountryDrained,
  setLinkedinCountryOffset,
} from "../db/linkedinCountryOffset";
import {
  bumpLinkedinSweepId,
  getLinkedinFreezeUntil,
  getLinkedinRrStart,
  setLinkedinFreezeUntil,
  setLinkedinRrStart,
} from "../db/pipelineState";
import {
  getSearchCountries,
  getSearchRoleQueryCache,
  getSearchRuntimePolicy,
  isExtractionActive,
} from "../db/appSettings";
import { log } from "../logging/appLog";
import { parseRapidApiKeys } from "./rapidapiKeys";
import { includeEveryNCycles } from "./lib/cycleCadence";
import {
  normalizeCountryName,
  normalizeEmploymentType,
  normalizeSalaryCurrency,
} from "./lib/providerFieldSemantics";
import { rapidApiJsonRequest } from "./lib/rapidApiJson";
import { runPlannedSearchProvider } from "./lib/plannedSearch";
import { assignWorkplaceTypeToJob } from "./lib/workplaceTypeCanonical";
import type { NormalizedJob } from "../types/job";
import { parsePostedAtUnixSeconds } from "./postedAt";
import { rapidApiFetch } from "./rapidapiFetch";
import type { FetchJobsParams, JobSourceProvider, ProviderChunkResult } from "./types";
import { flatHttpGetRequestRecord } from "../lib/httpRequestParamsRecord";
import { nextUtcMidnightUnix } from "../lib/nextUtcMidnight";

const HOST = "linkedin-job-search-api.p.rapidapi.com";
/** Default: jobs indexed in the last 24h (not 6m/7d). Override with `LINKEDIN_JOBS_API_PATH`. */
export const LINKEDIN_JOBS_DEFAULT_PATH = "/active-jb-24h";

function pickString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function clampLimitNon6m(n: number): number {
  if (n < 10) return 10;
  if (n > 100) return 100;
  return n;
}

export type LinkedinJobsUrlOpts = {
  /** API path, e.g. `/active-jb-24h`. */
  apiPath: string;
  limit: number;
  offset: number;
  titleFilter?: string;
  locationFilter?: string;
  descriptionType?: "" | "text" | "html";
  /** Greater-than filter on `date_posted` (UTC). */
  dateFilter?: string;
  remote?: boolean;
  typeFilter?: string;
  /** When false, prefer non-agency companies (`agency=false`). */
  agency?: boolean;
  /** BETA: AI-enriched fields from description (salary, etc.). */
  includeAi?: boolean;
};

export function buildLinkedinJobsUrl(opts: LinkedinJobsUrlOpts): URL {
  const path = opts.apiPath.startsWith("/") ? opts.apiPath : `/${opts.apiPath}`;
  const url = new URL(`https://${HOST}${path}`);
  url.searchParams.set("limit", String(clampLimitNon6m(opts.limit)));
  url.searchParams.set("offset", String(Math.max(0, opts.offset)));
  if (opts.titleFilter?.trim()) {
    url.searchParams.set("title_filter", opts.titleFilter.trim());
  }
  if (opts.locationFilter?.trim()) {
    url.searchParams.set("location_filter", opts.locationFilter.trim());
  }
  const dt = opts.descriptionType ?? "text";
  if (dt) {
    url.searchParams.set("description_type", dt);
  }
  if (opts.dateFilter?.trim()) {
    url.searchParams.set("date_filter", opts.dateFilter.trim());
  }
  if (opts.typeFilter?.trim()) {
    url.searchParams.set("type_filter", opts.typeFilter.trim());
  }
  if (opts.remote === true) {
    url.searchParams.set("remote", "true");
  } else if (opts.remote === false) {
    url.searchParams.set("remote", "false");
  }
  if (opts.agency === true) {
    url.searchParams.set("agency", "true");
  } else if (opts.agency === false) {
    url.searchParams.set("agency", "false");
  }
  // Do not send `order`: vendor confirmed it triggers PostgREST `idc` errors on `/active-jb-24h`.
  // API default is newest-first; larger `offset` walks toward older rows within the slice.
  if (opts.includeAi !== false) {
    url.searchParams.set("include_ai", "true");
  }
  return url;
}

function salaryFromRaw(salaryRaw: unknown): {
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryLine?: string;
} {
  if (!salaryRaw || typeof salaryRaw !== "object") return {};
  const o = salaryRaw as Record<string, unknown>;
  const cur = pickString(o.currency);
  const val = o.value;
  if (!val || typeof val !== "object") return cur ? { salaryCurrency: cur } : {};
  const v = val as Record<string, unknown>;
  const minV = typeof v.minValue === "number" ? v.minValue : undefined;
  const maxV = typeof v.maxValue === "number" ? v.maxValue : undefined;
  const unit = pickString(v.unitText);
  const parts: string[] = [];
  if (minV != null || maxV != null) {
    parts.push(
      minV != null && maxV != null && minV !== maxV
        ? `${minV}–${maxV}`
        : String(minV ?? maxV),
    );
  }
  if (cur) parts.push(cur);
  if (unit) parts.push(unit);
  return {
    salaryMin: minV,
    salaryMax: maxV,
    salaryCurrency: cur,
    salaryLine: parts.length ? parts.join(" ") : undefined,
  };
}

function salaryFromAi(raw: Record<string, unknown>): {
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryLine?: string;
} {
  const cur = pickString(raw.ai_salary_currency);
  const unit = pickString(raw.ai_salary_unittext);
  const minV = typeof raw.ai_salary_minvalue === "number" ? raw.ai_salary_minvalue : undefined;
  const maxV = typeof raw.ai_salary_maxvalue === "number" ? raw.ai_salary_maxvalue : undefined;
  const single = typeof raw.ai_salary_value === "number" ? raw.ai_salary_value : undefined;
  const parts: string[] = [];
  if (minV != null || maxV != null) {
    parts.push(
      minV != null && maxV != null && minV !== maxV ? `${minV}–${maxV}` : String(minV ?? maxV),
    );
  } else if (single != null) {
    parts.push(String(single));
  }
  if (cur) parts.push(cur);
  if (unit) parts.push(unit);
  if (parts.length === 0 && !cur) return {};
  return {
    salaryMin: minV ?? maxV ?? single,
    salaryMax: maxV ?? minV ?? single,
    salaryCurrency: cur,
    salaryLine: parts.length ? parts.join(" ") : undefined,
  };
}

export function normalizeLinkedinActiveJbJob(
  raw: Record<string, unknown>,
  searchCountries: readonly SearchCountry[] = DEFAULT_SEARCH_COUNTRIES,
): NormalizedJob | null {
  const externalId = pickString(raw.id);
  const title = pickString(raw.title);
  const company = pickString(raw.organization);
  const jobUrl = pickString(raw.url);
  if (!externalId || !title || !company || !jobUrl) return null;

  const desc =
    pickString(raw.description_text) ??
    pickString(raw.description_html) ??
    "";
  const extApply = pickString(raw.external_apply_url);
  const applyUrl = extApply && extApply.length > 0 ? extApply : jobUrl;

  const locs = raw.locations_derived;
  const location =
    Array.isArray(locs) && locs.every((x) => typeof x === "string")
      ? (locs as string[]).join(" | ")
      : "";

  const rawCountries = raw.countries_derived;
  const country =
    Array.isArray(rawCountries) && typeof rawCountries[0] === "string"
      ? normalizeCountryName(rawCountries[0] as string, searchCountries)
      : undefined;

  const isRemote = Boolean(raw.remote_derived);

  const emp = raw.employment_type;
  const employmentType =
    Array.isArray(emp) && emp.every((x) => typeof x === "string")
      ? normalizeEmploymentType((emp as string[]).join(", "), country)
      : undefined;

  const fromStructured = salaryFromRaw(raw.salary_raw);
  const fromAi = salaryFromAi(raw);
  const hasStructured =
    typeof fromStructured.salaryMin === "number" ||
    typeof fromStructured.salaryMax === "number" ||
    (fromStructured.salaryLine && fromStructured.salaryLine.length > 0);
  const salaryMin = hasStructured ? fromStructured.salaryMin : fromAi.salaryMin;
  const salaryMax = hasStructured ? fromStructured.salaryMax : fromAi.salaryMax;
  const salaryCurrency = normalizeSalaryCurrency(
    hasStructured ? fromStructured.salaryCurrency : fromAi.salaryCurrency,
  );
  const salaryLine = hasStructured ? fromStructured.salaryLine : fromAi.salaryLine;

  const postedAtUnix = parsePostedAtUnixSeconds(raw);

  return {
    source: "linkedin_jobs",
    externalId,
    title,
    company,
    jobUrl,
    applyUrl,
    location,
    country,
    isRemote,
    description: desc,
    salaryRaw: salaryLine,
    salaryMin,
    salaryMax,
    salaryCurrency,
    employmentType,
    postedAtUnix,
    raw,
  };
}

function parseApiPath(policy: SearchRuntimePolicy): string {
  return linkedinPathForPolicy(policy);
}

function parseLimitDefault(env: Env): number {
  const raw = env.LINKEDIN_JOBS_LIMIT?.trim();
  if (!raw) return 100;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 100;
  return clampLimitNon6m(n);
}

function parseUsLimit(env: Env): number {
  const raw = env.LINKEDIN_US_JOBS_LIMIT?.trim();
  if (!raw) return 25;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 25;
  return clampLimitNon6m(n);
}

function parseUsEveryNRuns(env: Env): number {
  const raw = env.LINKEDIN_US_EVERY_N_RUNS?.trim();
  if (!raw) return 5;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 2) return 5;
  return Math.min(n, 100);
}

/** Max HTTP pages when `LINKEDIN_LOCATION_FILTER` pins a single country (legacy deep pagination). */
function parseMaxPagesPerRun(env: Env): number {
  const raw = env.LINKEDIN_MAX_PAGES_PER_RUN?.trim();
  if (!raw) return 15;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return 1;
  return Math.min(n, 50);
}

/** Max round-robin sweeps per pipeline invocation (each sweep = one page per active country). */
function parseMaxSweepsPerRun(env: Env): number {
  const raw = env.LINKEDIN_MAX_SWEEPS_PER_RUN?.trim();
  if (!raw) return 8;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return 1;
  return Math.min(n, 200);
}

/** Hard cap on LinkedIn HTTP calls per invocation (safety). */
function parseMaxApiCallsPerRun(env: Env): number {
  const raw = env.LINKEDIN_MAX_API_CALLS_PER_RUN?.trim();
  if (!raw) return 80;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return 1;
  return Math.min(n, 500);
}

function parseMsBetweenRequests(env: Env): number {
  const raw = env.LINKEDIN_MS_BETWEEN_REQUESTS?.trim();
  if (!raw) return 400;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) return 0;
  return Math.min(n, 10_000);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

function parseRemote(policy: SearchRuntimePolicy): boolean | undefined {
  return policy.remoteOnly;
}

/** When true (default), send `agency=false` (regular companies only per API docs). */
function parseCompanyOnlyAgency(env: Env): boolean | undefined {
  const v = env.LINKEDIN_JOBS_COMPANY_ONLY?.trim().toLowerCase();
  if (v === "false" || v === "0") return undefined;
  return false;
}

function parseIncludeAi(env: Env): boolean {
  const v = env.LINKEDIN_INCLUDE_AI?.trim().toLowerCase();
  if (v === "false" || v === "0") return false;
  return true;
}

function rotateCountries<T>(arr: readonly T[], start: number): T[] {
  if (arr.length === 0) return [];
  const s = ((start % arr.length) + arr.length) % arr.length;
  return [...arr.slice(s), ...arr.slice(0, s)];
}

/**
 * Whether this monotonic provider run id should append the United States to the country list.
 * Kept pure for tests; must match the condition used in {@link linkedinJobsProvider.fetchJobs}.
 */
export function includeUnitedStatesInLinkedinRun(runId: number, usEveryNRuns: number): boolean {
  const every = Math.max(2, usEveryNRuns);
  return runId % every === 0;
}

async function allNonUsCountriesDrained(db: D1Database): Promise<boolean> {
  for (const c of LINKEDIN_NON_US_COUNTRIES) {
    if (!(await getLinkedinCountryDrained(db, c))) return false;
  }
  return true;
}

async function hasAnyLinkedinWorkRemaining(db: D1Database): Promise<boolean> {
  for (const c of [...LINKEDIN_NON_US_COUNTRIES, LINKEDIN_COUNTRY_UNITED_STATES]) {
    if (!(await getLinkedinCountryDrained(db, c))) return true;
  }
  return false;
}

async function freezeLinkedinPoolAfterNonUsExhaustion(db: D1Database, now: number): Promise<boolean> {
  if (!(await allNonUsCountriesDrained(db))) return false;
  // Avoid burning credits on US-only results after the rest of the daily pool is already drained.
  await setLinkedinCountryDrained(db, LINKEDIN_COUNTRY_UNITED_STATES, true, now);
  await setLinkedinFreezeUntil(db, nextUtcMidnightUnix(now), now);
  await resetLinkedinCountryCycle(db, now);
  return true;
}

function nextLinkedinEligibleAt(now: number, env: Env): number {
  const delayMs = parseMsBetweenRequests(env);
  if (delayMs <= 0) return now;
  return now + Math.max(1, Math.ceil(delayMs / 1000));
}

export const linkedinJobsProvider: JobSourceProvider = {
  id: "linkedin_jobs",

  async fetchChunk(env: Env, params: FetchJobsParams): Promise<ProviderChunkResult> {
    if (!parseRapidApiKeys(env).length) {
      throw new Error("Missing RapidAPI keys: set RAPIDAPI_KEYS or RAPIDAPI_KEY");
    }
    if (!(await isExtractionActive(env))) {
      await log.info(env, "linkedin_jobs", "Extraction paused; no LinkedIn chunk scheduled");
      return { jobs: [], more: false, doneForCycle: false };
    }

    const [searchPolicy, searchCountries] = await Promise.all([
      getSearchRuntimePolicy(env.DB),
      getSearchCountries(env.DB),
    ]);
    const typeFilter = linkedinTypeFilterForPolicy(searchPolicy);
    const descType = env.LINKEDIN_JOBS_DESCRIPTION_TYPE?.trim().toLowerCase();
    const descriptionType: "" | "text" | "html" =
      descType === "html" ? "html" : descType === "none" ? "" : "text";
    const fixedLoc = env.LINKEDIN_LOCATION_FILTER?.trim();
    const cycleId = params.cycleId ?? `manual-${Date.now()}`;
    const queryCache = await getSearchRoleQueryCache(env.DB);
    const includeUsThisCycle = includeEveryNCycles(cycleId, parseUsEveryNRuns(env));
    const usCountry =
      searchCountries.find((country) => country.iso2 === "us") ??
      DEFAULT_SEARCH_COUNTRIES.find((country) => country.iso2 === "us")!;
    const nonUsCountries = searchCountries.filter((country) => country.iso2 !== usCountry.iso2);
    const countries = fixedLoc
      ? (() => {
          const match = searchCountries.filter((country) => country.fullName === fixedLoc);
          return match.length
            ? match
            : [{ key: fixedLoc.toLowerCase(), iso2: fixedLoc.toLowerCase(), fullName: fixedLoc }];
        })()
      : (includeUsThisCycle
          ? [...nonUsCountries, usCountry]
          : [...nonUsCountries]);
    const apiPath = parseApiPath(searchPolicy);
    const dateFilterOpt = env.LINKEDIN_DATE_FILTER?.trim();
    const includeAi = parseIncludeAi(env);
    const remote = parseRemote(searchPolicy);

    return runPlannedSearchProvider<Record<string, unknown>, null>({
      env,
      providerId: "linkedin_jobs",
      cycleId,
      countries,
      queryUnits: [
        { id: "tier1:bundle", tier: 1 as const, queryValue: queryCache.quotedOr.tier1 || DEFAULT_LINKEDIN_TITLE_FILTER },
        { id: "tier2:bundle", tier: 2 as const, queryValue: queryCache.quotedOr.tier2 || DEFAULT_LINKEDIN_TITLE_FILTER },
      ].filter((unit) => unit.queryValue.trim().length > 0),
      maxSearchAttemptsPerChunk: 3,
      maxDetailFetches: Math.max(parseLimitDefault(env), parseUsLimit(env)),
      defaultIsRemote: remote === true,
      search: async (ctx) => {
        const offset = Math.max(0, parseInt(ctx.cursor ?? "0", 10) || 0);
        const limit = ctx.country.iso2 === usCountry.iso2 ? parseUsLimit(env) : parseLimitDefault(env);
        const listUrl = buildLinkedinJobsUrl({
          apiPath,
          limit,
          offset,
          titleFilter: ctx.queryUnit.queryValue || DEFAULT_LINKEDIN_TITLE_FILTER,
          locationFilter: ctx.country.fullName,
          descriptionType,
          dateFilter: dateFilterOpt || undefined,
          remote,
          typeFilter: typeFilter || undefined,
          agency: parseCompanyOnlyAgency(env),
          includeAi,
        });
        const json = await rapidApiJsonRequest(
          env.DB,
          env,
          listUrl.toString(),
          HOST,
          "linkedin_jobs",
          ctx.cycleId,
          {
            searchQuery: ctx.queryUnit.queryValue,
            tier: ctx.queryUnit.tier,
            countryKey: ctx.country.key,
            countryLabel: ctx.country.fullName,
          },
        );
        if (!Array.isArray(json)) {
          throw new Error("LinkedIn jobs: expected JSON array response");
        }
        const rows = json.filter(
          (item): item is Record<string, unknown> => item !== null && typeof item === "object",
        );
        return {
          rows,
          nextCursor: rows.length < limit ? null : String(offset + limit),
          ingestionRequestParams: flatHttpGetRequestRecord(listUrl, { host: HOST }),
          meta: {
            country: ctx.country.fullName,
            offset,
            limit,
          },
        };
      },
      rowId: (row) => pickString(row.id),
      merge: (row, _detail, ctx) => {
        const n = normalizeLinkedinActiveJbJob(row, searchCountries);
        if (!n) return null;
        const q = ctx.queryUnit.queryValue.trim();
        return q ? { ...n, searchQuery: q } : n;
      },
    });
  },
};

async function fetchLinkedinSingleCountryChunk(
  env: Env,
  params: FetchJobsParams,
  titleFilter: string,
  locationFilter: string,
  descriptionType: "" | "text" | "html",
): Promise<ProviderChunkResult> {
  const db = env.DB;
  if (!parseRapidApiKeys(env).length) throw new Error("Missing RapidAPI keys");
  if (!(await isExtractionActive(env))) return { jobs: [], more: false, doneForCycle: false };

  const [searchCountries, searchPolicy] = await Promise.all([
    getSearchCountries(db),
    getSearchRuntimePolicy(db),
  ]);
  const typeFilter = linkedinTypeFilterForPolicy(searchPolicy);
  const now = Math.floor(Date.now() / 1000);
  const freezeUntil = await getLinkedinFreezeUntil(db);
  if (freezeUntil > now) {
    return {
      jobs: [],
      more: false,
      doneForCycle: true,
      nextEligibleAt: freezeUntil,
      meta: { reason: "linkedin_freeze_wait" },
    };
  }
  if (freezeUntil > 0 && freezeUntil <= now) {
    await setLinkedinFreezeUntil(db, 0, now);
  }
  const apiPath = parseApiPath(searchPolicy);
  const dateFilterOpt = env.LINKEDIN_DATE_FILTER?.trim();
  const includeAi = parseIncludeAi(env);

  const limit = parseLimitDefault(env);
  let offset = await getLinkedinCountryOffset(db, locationFilter);

  const baseOpts = {
    apiPath,
    limit,
    titleFilter: titleFilter || params.query?.trim() || undefined,
    locationFilter,
    descriptionType,
    dateFilter: dateFilterOpt || undefined,
    remote: parseRemote(searchPolicy),
    typeFilter: typeFilter || undefined,
    agency: parseCompanyOnlyAgency(env),
    includeAi,
  };

  const url = buildLinkedinJobsUrl({ ...baseOpts, offset });
  const listIngestion = flatHttpGetRequestRecord(url, { host: HOST });
  const res = await rapidApiFetch(db, env, url.toString(), HOST, HOST, undefined, {
    searchQuery: titleFilter || params.query?.trim() || undefined,
    countryKey: locationFilter.trim().toLowerCase(),
    countryLabel: locationFilter,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LinkedIn jobs HTTP ${res.status}: ${t.slice(0, 500)}`);
  }
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) {
    await log.moderate(
      env,
      "linkedin_jobs",
      "LinkedIn API returned non-array JSON (single-country mode)",
      {
        locationFilter,
        preview:
          typeof body === "object" && body !== null
            ? JSON.stringify(body).slice(0, 500)
            : String(body).slice(0, 200),
      },
      {
        category: "vendor",
        eventType: "malformed_response",
        providerId: "linkedin_jobs",
        phase: "fetchChunk",
        statusKind: "degraded",
      },
    );
    throw new Error("LinkedIn jobs: expected JSON array response");
  }

  const searchQueryForRows = (baseOpts.titleFilter ?? params.query?.trim() ?? "").trim();
  const out: NormalizedJob[] = [];
  for (const item of body) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const n = normalizeLinkedinActiveJbJob(row, searchCountries);
    if (!n) continue;
    const withQuery = searchQueryForRows ? { ...n, searchQuery: searchQueryForRows } : n;
    out.push(assignWorkplaceTypeToJob({ ...withQuery, ingestionRequestParams: listIngestion }));
  }

  if (body.length < limit) {
    await setLinkedinCountryOffset(db, locationFilter, 0, now);
    const resumeAt = nextUtcMidnightUnix(now);
    await setLinkedinFreezeUntil(db, resumeAt, now);
    return {
      jobs: out,
      more: false,
      doneForCycle: true,
      nextEligibleAt: resumeAt,
      meta: { reason: "linkedin_listings_exhausted", locationFilter, offset, limit },
    };
  }

  await setLinkedinCountryOffset(db, locationFilter, offset + limit, now);
  return {
    jobs: out,
    more: true,
    doneForCycle: false,
    nextEligibleAt: nextLinkedinEligibleAt(now, env),
    meta: { locationFilter, offset, limit },
  };
}

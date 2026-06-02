import { DEFAULT_SEARCH_COUNTRIES, type SearchCountry } from "../config/searchCountries";
import { getSearchCountries, getSearchRuntimePolicy, isExtractionActive } from "../db/appSettings";
import {
  getProviderLastCompletedSweepAt,
  getProviderUtcDayRequestCount,
  getProviderUtcMonthRequestCount,
  setProviderLastCompletedSweepAt,
  utcYmFromUnix,
  utcYmdFromUnix,
} from "../db/pipelineState";
import { flatHttpGetRequestRecord } from "../lib/httpRequestParamsRecord";
import { log } from "../logging/appLog";
import type { NormalizedJob } from "../types/job";
import { normalizeEmploymentType } from "./lib/providerFieldSemantics";
import { runPlannedSearchProvider, type SearchPageResult } from "./lib/plannedSearch";
import { rapidApiJsonRequest } from "./lib/rapidApiJson";
import { parseRapidApiKeys } from "./rapidapiKeys";
import type { FetchJobsParams, JobSourceProvider, ProviderChunkResult } from "./types";

export const REMOTE_JOBS_HOST = "remote-jobs1.p.rapidapi.com";
const REMOTE_JOBS_DEFAULT_PATH = "/jobs";
const REMOTE_JOBS_PROVIDER_ID = "remote_jobs" as const;
const DEFAULT_MIN_DAYS_BETWEEN_RUNS = 15;
const DEFAULT_SWEEP_REQUEST_CAP = 250;
const DEFAULT_MONTHLY_REQUEST_CAP = 500;

export type RemoteJobsCompany = {
  name?: string | null;
  slug?: string | null;
  website?: string | null;
  linkedinUrl?: string | null;
  linkedinSize?: string | null;
  linkedinType?: string | null;
  linkedinFounded?: string | null;
  linkedinTagline?: string | null;
  linkedinIndustry?: string | null;
  linkedinLocations?: string[] | null;
  linkedinDescription?: string | null;
  linkedinSpecialties?: string[] | null;
};

export type RemoteJobsRow = {
  id?: number | string;
  slug?: string | null;
  url?: string | null;
  title?: string | null;
  description?: string | null;
  datePosted?: string | null;
  dateCreated?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  dateDeleted?: string | null;
  skills?: string[] | null;
  categories?: string[] | null;
  employmentTypes?: string[] | null;
  locationTypes?: string[] | null;
  countries?: string[] | null;
  company?: RemoteJobsCompany | null;
};

type RemoteJobsEnvelope = {
  total_count?: number;
  data?: unknown;
  next_cursor?: number | string | null;
  has_more?: boolean;
};

function pickString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = raw ? parseInt(raw.trim(), 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clampLimit(raw: string | undefined): number {
  const n = parsePositiveInt(raw, 100);
  return Math.max(1, Math.min(100, n));
}

function parseUnixDate(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    const ms = Date.parse(value.trim());
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
  }
  return undefined;
}

function isRemoteLocationType(values: unknown): boolean {
  return Array.isArray(values) && values.some((v) => typeof v === "string" && v.trim().toLowerCase() === "remote");
}

function firstEmploymentType(row: RemoteJobsRow): string | undefined {
  const values = row.employmentTypes;
  return Array.isArray(values) ? pickString(values[0]) : undefined;
}

function countryLabelFromRow(row: RemoteJobsRow, ctxCountry: SearchCountry): string {
  const countries = Array.isArray(row.countries)
    ? row.countries.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
  if (!countries.length) return ctxCountry.fullName;
  const primary = countries[0]!.trim().toLowerCase();
  const known = DEFAULT_SEARCH_COUNTRIES.find((country) => country.iso2 === primary);
  return known?.fullName ?? primary.toUpperCase();
}

function parseEnvelope(json: unknown): SearchPageResult<RemoteJobsRow> {
  if (!json || typeof json !== "object") return { rows: [] };
  const envelope = json as RemoteJobsEnvelope;
  const rows = Array.isArray(envelope.data)
    ? envelope.data.filter((row): row is RemoteJobsRow => row !== null && typeof row === "object")
    : [];
  return {
    rows,
    nextCursor: envelope.has_more && envelope.next_cursor != null ? String(envelope.next_cursor) : null,
    meta: {
      totalCount: typeof envelope.total_count === "number" ? envelope.total_count : undefined,
      hasMore: Boolean(envelope.has_more),
      nextCursor: envelope.next_cursor ?? null,
    },
  };
}

export function buildRemoteJobsUrl(opts: {
  titleSearch?: string;
  country?: string;
  employmentType?: string;
  cursor?: string | null;
  limit?: number;
  includeCompany?: boolean;
  includeTotalCount?: boolean;
  apiPath?: string;
}): URL {
  const apiPath = (opts.apiPath ?? REMOTE_JOBS_DEFAULT_PATH).trim() || REMOTE_JOBS_DEFAULT_PATH;
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  const url = new URL(`https://${REMOTE_JOBS_HOST}${path}`);
  if (opts.titleSearch?.trim()) url.searchParams.set("title_search", opts.titleSearch.trim());
  if (opts.country?.trim()) url.searchParams.set("country", opts.country.trim().toLowerCase());
  if (opts.employmentType?.trim()) url.searchParams.set("employment_type", opts.employmentType.trim().toLowerCase());
  if (opts.cursor?.trim()) url.searchParams.set("cursor", opts.cursor.trim());
  if (typeof opts.limit === "number" && Number.isFinite(opts.limit)) {
    url.searchParams.set("limit", String(Math.max(1, Math.min(100, Math.floor(opts.limit)))));
  }
  if (opts.includeCompany) url.searchParams.set("include_company", "true");
  if (opts.includeTotalCount) url.searchParams.set("include_total_count", "true");
  return url;
}

export function normalizeRemoteJobsRow(
  row: RemoteJobsRow,
  opts: {
    defaultCountry: SearchCountry;
    searchQuery: string;
    defaultIsRemote: boolean;
  },
): NormalizedJob | null {
  const externalId =
    typeof row.id === "number" && Number.isFinite(row.id)
      ? String(row.id)
      : pickString(row.id) ?? pickString(row.slug);
  if (!externalId) return null;

  const url = pickString(row.url) ?? "";
  const title = pickString(row.title) ?? "";
  const company = pickString(row.company?.name) ?? "";
  const description = pickString(row.description) ?? "";
  const country = countryLabelFromRow(row, opts.defaultCountry);
  const postedAtUnix = parseUnixDate(row.datePosted, row.dateCreated, row.createdAt, row.created_at);
  const employmentType = normalizeEmploymentType(firstEmploymentType(row) ?? "fulltime", opts.defaultCountry.iso2) ?? "Fulltime";
  const isRemote = isRemoteLocationType(row.locationTypes) || opts.defaultIsRemote;

  return {
    source: REMOTE_JOBS_PROVIDER_ID,
    externalId,
    title,
    company,
    jobUrl: url,
    applyUrl: url,
    location: country,
    country,
    isRemote,
    description,
    salaryRaw: undefined,
    salaryMin: undefined,
    salaryMax: undefined,
    salaryCurrency: undefined,
    employmentType,
    workplaceType: isRemote ? "Remote" : undefined,
    postedAtUnix,
    searchQuery: opts.searchQuery.trim() || undefined,
    raw: {
      row,
      company: row.company ?? null,
      categories: row.categories ?? null,
      skills: row.skills ?? null,
      locationTypes: row.locationTypes ?? null,
      countries: row.countries ?? null,
    },
  };
}

function minDaysBetweenRuns(env: Env): number {
  return parsePositiveInt(env.REMOTE_JOBS_MIN_DAYS_BETWEEN_RUNS, DEFAULT_MIN_DAYS_BETWEEN_RUNS);
}

function sweepRequestCap(env: Env): number {
  return parsePositiveInt(env.REMOTE_JOBS_MAX_API_CALLS_PER_RUN, DEFAULT_SWEEP_REQUEST_CAP);
}

function monthlyRequestCap(env: Env): number {
  return parsePositiveInt(env.REMOTE_JOBS_MAX_API_CALLS_PER_MONTH, DEFAULT_MONTHLY_REQUEST_CAP);
}

function monthlyResetUnix(now: number): number {
  const d = new Date(now * 1000);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0) / 1000);
}

async function guardRemoteJobsCadence(env: Env, userId: string, now: number): Promise<ProviderChunkResult | null> {
  const lastCompleted = await getProviderLastCompletedSweepAt(env.DB, userId, REMOTE_JOBS_PROVIDER_ID);
  const minInterval = minDaysBetweenRuns(env) * 86400;
  if (lastCompleted > 0 && now < lastCompleted + minInterval) {
    const nextEligibleAt = lastCompleted + minInterval;
    const meta = {
      reason: "remote_jobs_cadence_wait",
      lastCompletedAt: lastCompleted,
      minDaysBetweenRuns: minDaysBetweenRuns(env),
      nextEligibleAt,
    };
    return {
      jobs: [],
      more: false,
      doneForCycle: true,
      nextEligibleAt,
      meta,
    };
  }
  return null;
}

async function guardRemoteJobsBudgets(env: Env, userId: string, now: number): Promise<ProviderChunkResult | null> {
  const dailyUsed = await getProviderUtcDayRequestCount(
    env.DB,
    userId,
    REMOTE_JOBS_PROVIDER_ID,
    utcYmdFromUnix(now),
  );
  const maxSweep = sweepRequestCap(env);
  if (maxSweep > 0 && dailyUsed >= maxSweep) {
    const nextEligibleAt = now + minDaysBetweenRuns(env) * 86400;
    await setProviderLastCompletedSweepAt(env.DB, userId, REMOTE_JOBS_PROVIDER_ID, now, now);
    const meta = {
      reason: "remote_jobs_sweep_request_cap",
      requestCap: maxSweep,
      requestsUsed: dailyUsed,
      remoteJobsCompletedAt: now,
      nextEligibleAt,
      minDaysBetweenRuns: minDaysBetweenRuns(env),
    };
    await log.info(env, REMOTE_JOBS_PROVIDER_ID, "Remote Jobs sweep request cap reached", meta);
    return {
      jobs: [],
      more: false,
      doneForCycle: true,
      nextEligibleAt,
      meta,
    };
  }

  const monthlyUsed = await getProviderUtcMonthRequestCount(
    env.DB,
    userId,
    REMOTE_JOBS_PROVIDER_ID,
    utcYmFromUnix(now),
  );
  const maxMonth = monthlyRequestCap(env);
  if (maxMonth > 0 && monthlyUsed >= maxMonth) {
    const nextEligibleAt = monthlyResetUnix(now);
    const meta = {
      reason: "remote_jobs_monthly_request_cap",
      requestCap: maxMonth,
      requestsUsed: monthlyUsed,
      utcMonth: utcYmFromUnix(now),
      nextEligibleAt,
    };
    await log.info(env, REMOTE_JOBS_PROVIDER_ID, "Remote Jobs monthly request cap reached", meta);
    return {
      jobs: [],
      more: false,
      doneForCycle: true,
      nextEligibleAt,
      meta,
    };
  }
  return null;
}

async function markCompletedIfExhausted(env: Env, userId: string, result: ProviderChunkResult): Promise<ProviderChunkResult> {
  if (!result.doneForCycle) return result;
  const reason = typeof result.meta?.reason === "string" ? result.meta.reason : "";
  if (reason === "remote_jobs_cadence_wait") return result;
  if (reason === "remote_jobs_sweep_request_cap") return result;
  // Monthly cap uses calendar-month nextEligibleAt from guardRemoteJobsBudgets / rapidapiFetch.
  if (reason.includes("monthly")) return result;
  const now = Math.floor(Date.now() / 1000);
  const nextEligibleAt = now + minDaysBetweenRuns(env) * 86400;
  await setProviderLastCompletedSweepAt(env.DB, userId, REMOTE_JOBS_PROVIDER_ID, now, now);
  const meta = {
    ...(result.meta ?? {}),
    remoteJobsCompletedAt: now,
    minDaysBetweenRuns: minDaysBetweenRuns(env),
    nextEligibleAt,
  };
  await log.info(env, REMOTE_JOBS_PROVIDER_ID, "Remote Jobs sweep completed; rolling cooldown started", meta);
  return {
    ...result,
    nextEligibleAt,
    meta,
  };
}

export const remoteJobsProvider: JobSourceProvider = {
  id: REMOTE_JOBS_PROVIDER_ID,

  async fetchChunk(env: Env, params: FetchJobsParams) {
    if (!parseRapidApiKeys(env).length) {
      throw new Error("Missing RapidAPI keys: set RAPIDAPI_KEYS or RAPIDAPI_KEY for Remote Jobs");
    }
    const userId = params.userId;
    if (!(await isExtractionActive(env, userId))) {
      return { jobs: [], more: false, doneForCycle: false };
    }

    const now = Math.floor(Date.now() / 1000);
    const cadence = await guardRemoteJobsCadence(env, userId, now);
    if (cadence) {
      await log.info(env, REMOTE_JOBS_PROVIDER_ID, "Remote Jobs cadence gate active", cadence.meta);
      return cadence;
    }
    const budget = await guardRemoteJobsBudgets(env, userId, now);
    if (budget) return budget;

    const [searchCountries, searchPolicy] = await Promise.all([
      getSearchCountries(env.DB, userId),
      getSearchRuntimePolicy(env.DB, userId),
    ]);
    const cycleId = params.cycleId ?? `manual-${Date.now()}`;
    const pageSize = clampLimit(env.REMOTE_JOBS_MAX_JOBS_PER_CHUNK);
    const apiPath = env.REMOTE_JOBS_API_PATH?.trim() || REMOTE_JOBS_DEFAULT_PATH;

    const result = await runPlannedSearchProvider<RemoteJobsRow, null>({
      env,
      userId,
      providerId: REMOTE_JOBS_PROVIDER_ID,
      cycleId,
      countries: searchCountries,
      maxSearchAttemptsPerChunk: 4,
      maxDetailFetches: pageSize,
      defaultIsRemote: searchPolicy.remoteOnly,
      search: async (ctx) => {
        const searchUrl = buildRemoteJobsUrl({
          apiPath,
          titleSearch: ctx.queryUnit.queryValue,
          country: ctx.country.iso2,
          employmentType: "fulltime",
          cursor: ctx.cursor,
          limit: pageSize,
          includeCompany: true,
          includeTotalCount: false,
        });
        const json = await rapidApiJsonRequest(
          env.DB,
          env,
          userId,
          searchUrl.toString(),
          REMOTE_JOBS_HOST,
          REMOTE_JOBS_PROVIDER_ID,
          ctx.cycleId,
          {
            searchQuery: ctx.queryUnit.queryValue,
            tier: ctx.queryUnit.tier,
            countryKey: ctx.country.key,
            countryLabel: ctx.country.fullName,
          },
        );
        const envelope = parseEnvelope(json);
        return {
          ...envelope,
          ingestionRequestParams: flatHttpGetRequestRecord(searchUrl, {
            host: REMOTE_JOBS_HOST,
            keyPrefix: "search_",
          }),
        };
      },
      rowId: (row) => {
        if (typeof row.id === "number" && Number.isFinite(row.id)) return String(row.id);
        return pickString(row.id) ?? pickString(row.slug);
      },
      merge: (row, _detail, ctx) =>
        normalizeRemoteJobsRow(row, {
          defaultCountry: ctx.country,
          searchQuery: ctx.queryUnit.queryValue,
          defaultIsRemote: searchPolicy.remoteOnly,
        }),
    });

    return markCompletedIfExhausted(env, userId, result);
  },
};

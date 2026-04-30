/**
 * Pat92 “Jobs API” on RapidAPI (`jobs-api14.p.rapidapi.com`): LinkedIn `/v2/linkedin/search`
 * then `/v2/linkedin/get?id=` per row. See `.cursor/rules/api-endpoint-vendors.md` Vendor 3.
 */
import {
  DEFAULT_SEARCH_COUNTRIES,
  type SearchCountry,
} from "../config/searchCountries";
import {
  DEFAULT_SEARCH_RUNTIME_POLICY,
  jobsApiDatePostedForPolicy,
  jobsApiEmploymentTypesForPolicy,
  jobsApiWorkplaceTypesForPolicy,
} from "../config/searchPolicy";
import {
  getSearchCountries,
  getSearchRuntimePolicy,
  isExtractionActive,
} from "../db/appSettings";
import type { NormalizedJob } from "../types/job";
import { includeEveryNCycles } from "./lib/cycleCadence";
import { normalizeEmploymentType } from "./lib/providerFieldSemantics";
import { rapidApiJsonRequest } from "./lib/rapidApiJson";
import { runPlannedSearchProvider, type SearchPageResult } from "./lib/plannedSearch";
import { parsePostedAtUnixSeconds } from "./postedAt";
import { flatHttpGetRequestRecord } from "../lib/httpRequestParamsRecord";
import { parseRapidApiKeys } from "./rapidapiKeys";
import type { FetchJobsParams, JobSourceProvider } from "./types";

export const JOBS_API_HOST = "jobs-api14.p.rapidapi.com";

export type JobsApiSearchRow = {
  id?: string;
  companyName?: string;
  title?: string;
  linkedinUrl?: string;
  location?: string;
  datePosted?: string;
  postedTimeAgo?: string;
};

function pickString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function datePostedEnum(env: Env): string {
  void env;
  return jobsApiDatePostedForPolicy(DEFAULT_SEARCH_RUNTIME_POLICY);
}

function parseUsEveryN(env: Env): number {
  const raw = env.JOBS_API_US_EVERY_N_RUNS?.trim();
  const n = raw ? parseInt(raw, 10) : 5;
  return Number.isFinite(n) && n >= 2 ? n : 5;
}

/** Default `remote` only — aligns with app-wide remote-first job search. Override via `JOBS_API_WORKPLACE_TYPES`. */
function workplaceTypesParam(env: Env): string {
  void env;
  return jobsApiWorkplaceTypesForPolicy(DEFAULT_SEARCH_RUNTIME_POLICY);
}

function employmentTypesParam(env: Env): string {
  void env;
  return jobsApiEmploymentTypesForPolicy(DEFAULT_SEARCH_RUNTIME_POLICY);
}

function isRemoteOnlySearch(workplaceTypes: string): boolean {
  const parts = workplaceTypes
    .split(";")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return parts.length === 1 && parts[0] === "remote";
}

/**
 * Build LinkedIn search URL on Jobs API (v2).
 * @param location — full country/region name for `location` (e.g. "United Kingdom"), not ISO.
 */
export function buildJobsApiSearchUrl(opts: {
  query?: string;
  location?: string;
  datePosted?: string;
  workplaceTypes?: string;
  employmentTypes?: string;
  token?: string;
  /** Default `/v2/linkedin/search`. */
  searchPath?: string;
}): URL {
  const path = (opts.searchPath ?? "/v2/linkedin/search").trim() || "/v2/linkedin/search";
  const pathSeg = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`https://${JOBS_API_HOST}${pathSeg}`);
  const token = opts.token?.trim();
  if (token) {
    url.searchParams.set("token", token);
    return url;
  }
  if (opts.query?.trim()) url.searchParams.set("query", opts.query.trim());
  if (opts.location?.trim()) url.searchParams.set("location", opts.location.trim());
  if (opts.datePosted?.trim()) url.searchParams.set("datePosted", opts.datePosted.trim());
  if (opts.workplaceTypes?.trim()) url.searchParams.set("workplaceTypes", opts.workplaceTypes.trim());
  if (opts.employmentTypes?.trim()) url.searchParams.set("employmentTypes", opts.employmentTypes.trim());
  return url;
}

export function buildJobsApiGetUrl(id: string): URL {
  const url = new URL(`https://${JOBS_API_HOST}/v2/linkedin/get`);
  url.searchParams.set("id", id.trim());
  return url;
}

function parseSearchEnvelope(json: unknown): SearchPageResult<JobsApiSearchRow> {
  if (!json || typeof json !== "object") return { rows: [] };
  const data = (json as { data?: unknown }).data;
  const rows = Array.isArray(data)
    ? data.filter((x): x is JobsApiSearchRow => x !== null && typeof x === "object")
    : [];
  const meta = (json as { meta?: unknown }).meta;
  const nextTokenFromMeta =
    meta && typeof meta === "object" && typeof (meta as { nextToken?: unknown }).nextToken === "string"
      ? ((meta as { nextToken?: string }).nextToken ?? null)
      : null;
  // No rows ⇒ no pagination for this unit (ignore meta.nextToken).
  const nextCursor = rows.length > 0 ? nextTokenFromMeta : null;
  return { rows, nextCursor };
}

function parseDetailEnvelope(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  const d = (json as { data?: unknown }).data;
  if (d && typeof d === "object" && !Array.isArray(d)) {
    return d as Record<string, unknown>;
  }
  return null;
}

/** Posted date from search row `YYYY-MM-DD` → unix (UTC noon). */
export function datePostedYmdToUnix(s: string | undefined): number | undefined {
  if (!s || typeof s !== "string") return undefined;
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return undefined;
  const [ys, ms, ds] = t.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return undefined;
  return Math.floor(Date.UTC(y, m - 1, d, 12, 0, 0) / 1000);
}

/**
 * Merge search list row + optional detail payload into `NormalizedJob`.
 * Detail carries `description` and richer fields for hard filters + OpenAI scoring.
 */
export function mergeJobsApiPat92(
  search: JobsApiSearchRow,
  detail: Record<string, unknown> | null,
  defaultIsRemote = DEFAULT_SEARCH_RUNTIME_POLICY.remoteOnly,
  /** ISO2 from search country (planned search context); improves employment-type disambiguation. */
  employmentCountryHint?: string,
): NormalizedJob | null {
  const externalId = pickString(search.id) ?? pickString(detail?.id);
  if (!externalId) return null;

  const title = pickString(detail?.title) ?? pickString(search.title) ?? "";
  const company = pickString(detail?.companyName) ?? pickString(search.companyName) ?? "";
  const jobUrl =
    pickString(detail?.linkedinUrl) ?? pickString(search.linkedinUrl) ?? "";
  const location = pickString(detail?.location) ?? pickString(search.location) ?? "";
  const description = pickString(detail?.description) ?? "";

  const postedFromSearch = datePostedYmdToUnix(pickString(search.datePosted));
  const postedFromDetail = parsePostedAtUnixSeconds(detail ?? {});
  const postedAtUnix = postedFromDetail ?? postedFromSearch;

  const employmentType =
    normalizeEmploymentType(pickString(detail?.employmentType), employmentCountryHint) ?? "Fulltime";

  const raw: Record<string, unknown> = {
    search,
    detail,
  };

  return {
    source: "jobs_api",
    externalId,
    title,
    company,
    jobUrl,
    applyUrl: jobUrl,
    location,
    country: undefined,
    isRemote: defaultIsRemote,
    description,
    salaryRaw: undefined,
    salaryMin: undefined,
    salaryMax: undefined,
    salaryCurrency: undefined,
    employmentType,
    postedAtUnix,
    raw,
  };
}

export const jobsApiProvider: JobSourceProvider = {
  id: "jobs_api",

  async fetchChunk(env: Env, params: FetchJobsParams) {
    if (!parseRapidApiKeys(env).length) {
      throw new Error("Missing RapidAPI keys: set RAPIDAPI_KEYS or RAPIDAPI_KEY for Jobs API");
    }
    if (!(await isExtractionActive(env))) {
      return { jobs: [], more: false, doneForCycle: false };
    }

    const [searchCountries, searchPolicy] = await Promise.all([
      getSearchCountries(env.DB),
      getSearchRuntimePolicy(env.DB),
    ]);
    const datePosted = jobsApiDatePostedForPolicy(searchPolicy);
    const wp = jobsApiWorkplaceTypesForPolicy(searchPolicy);
    const emp = jobsApiEmploymentTypesForPolicy(searchPolicy);
    const cycleId = params.cycleId ?? `manual-${Date.now()}`;
    const usCountry =
      searchCountries.find((country) => country.iso2 === "us") ??
      DEFAULT_SEARCH_COUNTRIES.find((country) => country.iso2 === "us")!;
    const nonUsCountries = searchCountries.filter((country) => country.iso2 !== usCountry.iso2);
    const countries = includeEveryNCycles(cycleId, parseUsEveryN(env))
      ? [...nonUsCountries, usCountry]
      : [...nonUsCountries];

    const pageSize = Math.min(
      25,
      Math.max(1, parseInt(env.JOBS_API_MAX_JOBS_PER_CHUNK?.trim() || "15", 10) || 15),
    );

    return runPlannedSearchProvider<JobsApiSearchRow, Record<string, unknown> | null>({
      env,
      providerId: "jobs_api",
      cycleId,
      countries,
      buildQueryUnits: undefined,
      maxSearchAttemptsPerChunk: 4,
      maxDetailFetches: pageSize,
      defaultIsRemote: searchPolicy.remoteOnly && isRemoteOnlySearch(wp),
      search: async (ctx) => {
        const searchUrl = buildJobsApiSearchUrl({
          searchPath: "/v2/linkedin/search",
          query: ctx.queryUnit.queryValue,
          location: ctx.country.fullName,
          datePosted,
          workplaceTypes: wp,
          employmentTypes: emp,
          token: ctx.cursor ?? undefined,
        });
        const json = await rapidApiJsonRequest(
          env.DB,
          env,
          searchUrl.toString(),
          JOBS_API_HOST,
          "jobs_api",
          ctx.cycleId,
          {
            searchQuery: ctx.queryUnit.queryValue,
            tier: ctx.queryUnit.tier,
            countryKey: ctx.country.key,
            countryLabel: ctx.country.fullName,
          },
        );
        const envelope = parseSearchEnvelope(json);
        return {
          ...envelope,
          ingestionRequestParams: flatHttpGetRequestRecord(searchUrl, {
            host: JOBS_API_HOST,
            keyPrefix: "search_",
          }),
        };
      },
      rowId: (row) => pickString(row.id),
      fetchDetail: async (ctx) => {
        const json = await rapidApiJsonRequest(
          env.DB,
          env,
          buildJobsApiGetUrl(ctx.id).toString(),
          JOBS_API_HOST,
          "jobs_api",
          ctx.cycleId,
          {
            searchQuery: ctx.queryUnit.queryValue,
            tier: ctx.queryUnit.tier,
            countryKey: ctx.country.key,
            countryLabel: ctx.country.fullName,
          },
        );
        return parseDetailEnvelope(json);
      },
      merge: (row, detail, ctx) => {
        const n = mergeJobsApiPat92(row, detail, searchPolicy.remoteOnly, ctx.country.iso2);
        if (!n) return null;
        const q = ctx.queryUnit.queryValue.trim();
        const base = q ? { ...n, searchQuery: q } : n;
        const detailUrl = buildJobsApiGetUrl(base.externalId);
        return {
          ...base,
          ingestionRequestParams: flatHttpGetRequestRecord(detailUrl, {
            host: JOBS_API_HOST,
            keyPrefix: "detail_",
          }),
        };
      },
    });
  },
};

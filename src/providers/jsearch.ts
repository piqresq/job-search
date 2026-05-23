import {
  getSearchCountries,
  getSearchRuntimePolicy,
  isExtractionActive,
} from "../db/appSettings";
import {
  DEFAULT_SEARCH_COUNTRIES,
  SEARCH_COUNTRIES_NON_US,
  type SearchCountry,
} from "../config/searchCountries";
import {
  DEFAULT_SEARCH_RUNTIME_POLICY,
  jsearchDatePostedForPolicy,
  jsearchEmploymentTypesForPolicy,
} from "../config/searchPolicy";
import type { NormalizedJob } from "../types/job";
import { rapidApiJsonRequest } from "./lib/rapidApiJson";
import { runPlannedSearchProvider } from "./lib/plannedSearch";
import {
  normalizeCountryName,
  normalizeEmploymentType,
  normalizeSalaryCurrency,
} from "./lib/providerFieldSemantics";
import { parsePostedAtUnixSeconds } from "./postedAt";
import type { FetchJobsParams, JobSourceProvider, ProviderChunkResult } from "./types";
import { flatHttpGetRequestRecord } from "../lib/httpRequestParamsRecord";
import { pickJsearchApplyUrl, pickJsearchJobUrl } from "./jsearchLinks";
import { parseRapidApiKeys } from "./rapidapiKeys";
import { rapidApiFetchFirstKey } from "./rapidapiFetch";

const HOST = "jsearch.p.rapidapi.com";
const SEARCH_PATH = "/search";

/** Shared country source of truth as ISO codes for JSearch `country`. */
export const JSEARCH_EU_COUNTRY_CODES = SEARCH_COUNTRIES_NON_US.map((country) => country.iso2);

export type JsearchSearchSlice = {
  country: string;
  employment_types: string;
};

export type JsearchDiagnostics = {
  ok: boolean;
  httpStatus: number;
  requestUrl: string;
  query: string;
  page: number;
  work_from_home: boolean;
  date_posted: string;
  country: string;
  employment_types: string;
  body: unknown;
  error?: string;
};

export type JsearchDiagnosticsOverrides = {
  country?: string;
  employment_types?: string;
  date_posted?: string;
};

/** Random non-US shared-country ISO code for JSearch diagnostics. */
export function pickEuCountry(): string {
  const i = Math.floor(Math.random() * JSEARCH_EU_COUNTRY_CODES.length);
  return JSEARCH_EU_COUNTRY_CODES[i] ?? "gb";
}

function pickEuCountryFromCountries(countries: readonly SearchCountry[]): string {
  const nonUs = countries.filter((country) => country.iso2 !== "us");
  const pool = nonUs.length ? nonUs : SEARCH_COUNTRIES_NON_US;
  const i = Math.floor(Math.random() * pool.length);
  return pool[i]?.iso2 ?? "gb";
}

/** JSearch `employment_types`: FULLTIME (default) or PARTTIME — set via `JSEARCH_EMPLOYMENT_TYPES`. */
export function resolveJsearchEmploymentTypes(env: Env): "FULLTIME" | "PARTTIME" {
  void env;
  return jsearchEmploymentTypesForPolicy(DEFAULT_SEARCH_RUNTIME_POLICY);
}

function parseEmploymentOverride(raw: string | undefined, env: Env): "FULLTIME" | "PARTTIME" {
  const v = raw?.trim().toUpperCase();
  if (v === "PARTTIME") return "PARTTIME";
  if (v === "FULLTIME") return "FULLTIME";
  return resolveJsearchEmploymentTypes(env);
}

/**
 * Legacy diagnostics helper: 4/5 non-US shared countries, 1/5 US.
 * We do not send JSearch `language=` (API default per country).
 * Employment: {@link resolveJsearchEmploymentTypes} (default FULLTIME).
 */
export function jsearchSliceFromSequences(
  geoSeq: number,
  employment_types: "FULLTIME" | "PARTTIME",
): JsearchSearchSlice {
  const country = geoSeq % 5 < 4 ? pickEuCountry() : "us";
  return { country, employment_types };
}

/** Random non-US/US shared-country slice for /test-jsearch only (does not advance D1 counters). */
export async function sampleJsearchSearchSlice(env: Env, userId: string): Promise<JsearchSearchSlice> {
  const [countries, policy] = await Promise.all([
    getSearchCountries(env.DB, userId),
    getSearchRuntimePolicy(env.DB, userId),
  ]);
  const country = Math.random() < 0.8 ? pickEuCountryFromCountries(countries) : "us";
  return { country, employment_types: jsearchEmploymentTypesForPolicy(policy) };
}

export function buildJsearchUrl(opts: {
  query: string;
  page: number;
  numPages: number;
  country: string;
  employmentTypes: string;
  datePosted: string;
  /** Default true (matches Worker). Set false for local tests when the API returns no rows with remote-only. */
  workFromHome?: boolean;
  /** Path segment on `jsearch.p.rapidapi.com`, e.g. `/search` (default). */
  apiPath?: string;
}): URL {
  const raw = (opts.apiPath ?? "").trim();
  const path = raw ? (raw.startsWith("/") ? raw : `/${raw}`) : SEARCH_PATH;
  const url = new URL(`https://${HOST}${path}`);
  url.searchParams.set("query", opts.query);
  url.searchParams.set("page", String(opts.page));
  url.searchParams.set("num_pages", String(opts.numPages));
  url.searchParams.set("work_from_home", opts.workFromHome === false ? "false" : "true");
  url.searchParams.set("date_posted", opts.datePosted);
  url.searchParams.set("country", opts.country);
  url.searchParams.set("employment_types", opts.employmentTypes);
  return url;
}

/** Raw JSearch /search call for debugging. Random slice unless overrides set (does not bump rotation). */
export async function fetchJsearchDiagnostics(
  env: Env,
  userId: string,
  query: string,
  page = 1,
  overrides?: JsearchDiagnosticsOverrides,
): Promise<JsearchDiagnostics> {
  if (!parseRapidApiKeys(env).length) {
    return {
      ok: false,
      httpStatus: 0,
      requestUrl: "",
      query,
      page,
      work_from_home: true,
      date_posted: overrides?.date_posted ?? "month",
      country: "",
      employment_types: "",
      body: null,
      error: "Missing RAPIDAPI_KEYS or RAPIDAPI_KEY",
    };
  }

  const slice = overrides?.country
    ? {
        country: overrides.country.trim(),
        employment_types: parseEmploymentOverride(overrides.employment_types, env),
      }
    : await sampleJsearchSearchSlice(env, userId);

  const datePosted = overrides?.date_posted ?? "month";

  const url = buildJsearchUrl({
    query,
    page,
    numPages: 1,
    country: slice.country,
    employmentTypes: slice.employment_types,
    datePosted,
  });

  const res = await rapidApiFetchFirstKey(env, url.toString(), HOST);

  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = { _parseError: true, textPreview: text.slice(0, 800) };
  }

  return {
    ok: res.ok,
    httpStatus: res.status,
    requestUrl: url.toString(),
    query,
    page,
    work_from_home: true,
    date_posted: datePosted,
    country: slice.country,
    employment_types: slice.employment_types,
    body,
  };
}

type JSearchJob = {
  job_id?: string;
  job_title?: string;
  employer_name?: string;
  job_description?: string;
  job_apply_link?: string;
  job_google_link?: string;
  apply_options?: unknown;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_is_remote?: boolean;
  job_employment_type?: string;
  job_min_salary?: number;
  job_max_salary?: number;
  job_salary?: string;
  job_salary_currency?: string;
  /** If present, Unix seconds (vendor may use ms — handled in postedAt parser). */
  job_posted_at_timestamp?: number;
  job_posted_at_datetime_utc?: string;
  [key: string]: unknown;
};

type JSearchResponse = {
  data?: JSearchJob[];
};

function pickString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Normalize a single JSearch `data[]` element (for tests / tooling). */
export function normalizeJsearchApiJob(raw: Record<string, unknown>): NormalizedJob | null {
  return normalizeOne(raw as JSearchJob);
}

function findCountryByIso2(
  countries: readonly SearchCountry[],
  iso2: string | undefined,
): SearchCountry | undefined {
  const key = pickString(iso2)?.toLowerCase();
  if (!key) return undefined;
  return countries.find((country) => country.iso2 === key);
}

function normalizeOne(
  raw: JSearchJob,
  countries: readonly SearchCountry[] = DEFAULT_SEARCH_COUNTRIES,
  defaultEmploymentType = jsearchEmploymentTypesForPolicy(DEFAULT_SEARCH_RUNTIME_POLICY),
): NormalizedJob | null {
  const externalId = pickString(raw.job_id);
  const title = pickString(raw.job_title);
  const company = pickString(raw.employer_name);
  const applyUrl = pickJsearchApplyUrl(raw);
  const description = pickString(raw.job_description) ?? "";

  if (!externalId || !title || !company) return null;

  const jobUrl = pickJsearchJobUrl(raw) ?? "";
  const location = [raw.job_city, raw.job_state, raw.job_country]
    .map((x) => (typeof x === "string" ? x : ""))
    .filter(Boolean)
    .join(", ");

  const isRemote = Boolean(raw.job_is_remote);

  const salaryMin = typeof raw.job_min_salary === "number" ? raw.job_min_salary : undefined;
  const salaryMax = typeof raw.job_max_salary === "number" ? raw.job_max_salary : undefined;
  const salaryRaw = pickString(raw.job_salary);
  const salaryCurrency = normalizeSalaryCurrency(pickString(raw.job_salary_currency));

  const postedAtUnix = parsePostedAtUnixSeconds(raw as Record<string, unknown>);

  const mappedCountry = findCountryByIso2(countries, pickString(raw.job_country));
  return {
    source: "jsearch",
    externalId,
    title,
    company,
    jobUrl,
    applyUrl: applyUrl ?? "",
    location,
    country: mappedCountry?.fullName ?? normalizeCountryName(pickString(raw.job_country), countries),
    isRemote,
    description,
    salaryRaw,
    salaryMin,
    salaryMax,
    salaryCurrency,
    employmentType:
      normalizeEmploymentType(pickString(raw.job_employment_type), mappedCountry?.iso2 ?? pickString(raw.job_country)) ??
      normalizeEmploymentType(defaultEmploymentType, mappedCountry?.iso2 ?? pickString(raw.job_country)) ??
      "Fulltime",
    postedAtUnix,
    raw: raw as Record<string, unknown>,
  };
}

async function fetchJsearchSingle(
  env: Env,
  userId: string,
  opts: {
    query: string;
    searchQueryVariant: string;
    searchTier: 1 | 2;
    countryLabel: string;
    page: number;
    numPages: number;
    cycleId?: string;
    slice: JsearchSearchSlice;
    datePosted: string;
  },
): Promise<{ body: JSearchResponse; requestUrl: URL }> {
  const requestUrl = buildJsearchUrl({
    query: opts.query,
    page: opts.page,
    numPages: opts.numPages,
    country: opts.slice.country,
    employmentTypes: opts.slice.employment_types,
    datePosted: opts.datePosted,
  });

  const body = (await rapidApiJsonRequest(
    env.DB,
    env,
    userId,
    requestUrl.toString(),
    HOST,
    "jsearch",
    opts.cycleId,
    {
      searchQuery: opts.searchQueryVariant,
      tier: opts.searchTier,
      countryKey: opts.slice.country,
      countryLabel: opts.countryLabel,
    },
  )) as JSearchResponse;
  return { body, requestUrl };
}

export const jsearchProvider: JobSourceProvider = {
  id: "jsearch",

  async fetchChunk(env: Env, params: FetchJobsParams): Promise<ProviderChunkResult> {
    if (!parseRapidApiKeys(env).length) {
      throw new Error("Missing RapidAPI keys: set RAPIDAPI_KEYS or RAPIDAPI_KEY for JSearch");
    }
    const userId = params.userId;
    if (!(await isExtractionActive(env, userId))) {
      return { jobs: [], more: false, doneForCycle: false };
    }
    const [searchCountries, searchPolicy] = await Promise.all([
      getSearchCountries(env.DB, userId),
      getSearchRuntimePolicy(env.DB, userId),
    ]);
    const datePosted = jsearchDatePostedForPolicy(searchPolicy);
    const employment_types = jsearchEmploymentTypesForPolicy(searchPolicy);
    return runPlannedSearchProvider<Record<string, unknown>, null>({
      env,
      userId,
      providerId: "jsearch",
      cycleId: params.cycleId ?? `manual-${Date.now()}`,
      countries: [...searchCountries],
      maxSearchAttemptsPerChunk: 4,
      maxDetailFetches: Math.max(1, params.pageSize ?? 15),
      defaultIsRemote: searchPolicy.remoteOnly,
      search: async (ctx) => {
        const page = Math.max(1, parseInt(ctx.cursor ?? "1", 10) || 1);
        const { body, requestUrl } = await fetchJsearchSingle(env, userId, {
          query: `${ctx.queryUnit.queryValue} in ${ctx.country.fullName}`,
          searchQueryVariant: ctx.queryUnit.queryValue,
          searchTier: ctx.queryUnit.tier,
          countryLabel: ctx.country.fullName,
          page,
          numPages: 1,
          cycleId: ctx.cycleId,
          slice: {
            country: ctx.country.iso2,
            employment_types,
          },
          datePosted,
        });
        const rows = (body.data ?? []).filter(
          (item): item is Record<string, unknown> => item !== null && typeof item === "object",
        );
        return {
          rows,
          nextCursor: rows.length > 0 ? String(page + 1) : null,
          ingestionRequestParams: flatHttpGetRequestRecord(requestUrl, { host: HOST }),
          meta: {
            country: ctx.country.fullName,
            employment_types,
            date_posted: datePosted,
            page,
          },
        };
      },
      rowId: (row) => pickString(row.job_id),
      merge: (row, _detail, ctx) => {
        const n = normalizeOne(row as JSearchJob, searchCountries, employment_types);
        if (!n) return null;
        const q = ctx.queryUnit.queryValue.trim();
        return q ? { ...n, searchQuery: q } : n;
      },
    });
  },
};

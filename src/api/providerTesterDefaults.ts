import { DEFAULT_LINKEDIN_TITLE_FILTER } from "../config/linkedinTitleFilter";
import { DEFAULT_SEARCH_COUNTRIES } from "../config/searchCountries";
import {
  jobsApiDatePostedForPolicy,
  jobsApiEmploymentTypesForPolicy,
  jobsApiWorkplaceTypesForPolicy,
  jsearchDatePostedForPolicy,
  jsearchEmploymentTypesForPolicy,
  linkedinTypeFilterForPolicy,
} from "../config/searchPolicy";
import {
  getSearchCountries,
  getSearchRoleQueryCache,
  getSearchRuntimePolicy,
} from "../db/appSettings";
import { BOOTSTRAP_ADMIN_ID } from "../db/users";
import { LINKEDIN_JOBS_DEFAULT_PATH } from "../providers/linkedinJobs";

function parseApiPath(env: Env): string {
  const raw = env.LINKEDIN_JOBS_API_PATH?.trim();
  if (!raw) return LINKEDIN_JOBS_DEFAULT_PATH;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function clampLimitNon6m(n: number): number {
  if (n < 10) return 10;
  if (n > 100) return 100;
  return n;
}

function parseLimitDefault(env: Env): number {
  const raw = env.LINKEDIN_JOBS_LIMIT?.trim();
  if (!raw) return 100;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 100;
  return clampLimitNon6m(n);
}

function parseRemoteString(env: Env): "true" | "false" {
  void env;
  return "true";
}

/** Matches parseCompanyOnlyAgency + Python agency combo: false → agency=false; omit agency param → "omit". */
function parseAgencyString(env: Env): "false" | "omit" {
  const v = env.LINKEDIN_JOBS_COMPANY_ONLY?.trim().toLowerCase();
  if (v === "false" || v === "0") return "omit";
  return "false";
}

function parseIncludeAi(env: Env): boolean {
  const v = env.LINKEDIN_INCLUDE_AI?.trim().toLowerCase();
  if (v === "false" || v === "0") return false;
  return true;
}

function resolveJsearchEmploymentTypes(env: Env): "FULLTIME" | "PARTTIME" {
  void env;
  return "FULLTIME";
}

function parseJsearchApiPath(env: Env): string {
  const raw = env.JSEARCH_API_PATH?.trim();
  if (!raw) return "/search";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

/**
 * Non-secret defaults for the local RapidAPI tester (`scripts/linkedin_api_tester.py`).
 * Mirrors wrangler vars + the same fallbacks as `linkedinJobs` / `jsearch` providers.
 */
function combineRoleQueries(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" OR ");
}

export async function getProviderTesterDefaults(env: Env): Promise<{
  linkedin: {
    api_path: string;
    limit: number;
    offset: number;
    title_filter: string;
    location_filter: string;
    description_type: "none" | "text" | "html";
    date_filter: string;
    type_filter: string;
    remote: "true" | "false";
    agency: "false" | "omit";
    include_ai: boolean;
  };
  jsearch: {
    api_path: string;
    query: string;
    page: number;
    num_pages: number;
    country: string;
    employment_types: "FULLTIME" | "PARTTIME";
    date_posted: string;
    work_from_home: boolean;
  };
  jobs_api: {
    api_path: string;
    query: string;
    location: string;
    date_posted: string;
    workplace_types: string;
    employment_types: string;
  };
  remote_jobs: {
    api_path: string;
    title_search: string;
    country: string;
    employment_type: string;
    limit: number;
    include_company: boolean;
    include_total_count: boolean;
  };
  publicBaseUrl: string;
}> {
  const descRaw = env.LINKEDIN_JOBS_DESCRIPTION_TYPE?.trim().toLowerCase();
  const descriptionType: "none" | "text" | "html" =
    descRaw === "html" ? "html" : descRaw === "none" ? "none" : "text";
  const [searchCountries, searchPolicy, queryCache] = await Promise.all([
    getSearchCountries(env.DB, BOOTSTRAP_ADMIN_ID),
    getSearchRuntimePolicy(env.DB, BOOTSTRAP_ADMIN_ID),
    getSearchRoleQueryCache(env.DB, BOOTSTRAP_ADMIN_ID),
  ]);
  const primaryCountry = searchCountries[0] ?? DEFAULT_SEARCH_COUNTRIES[0]!;

  const titleFilter =
    env.LINKEDIN_TITLE_FILTER?.trim() ||
    queryCache.quotedOr.tier1 ||
    DEFAULT_LINKEDIN_TITLE_FILTER;
  const locationFilter = env.LINKEDIN_LOCATION_FILTER?.trim() || primaryCountry.fullName;

  return {
    linkedin: {
      api_path: parseApiPath(env),
      limit: parseLimitDefault(env),
      offset: 0,
      title_filter: titleFilter,
      location_filter: locationFilter,
      description_type: descriptionType,
      date_filter: env.LINKEDIN_DATE_FILTER?.trim() ?? "",
      type_filter: linkedinTypeFilterForPolicy(searchPolicy),
      remote: searchPolicy.remoteOnly ? "true" : "false",
      agency: parseAgencyString(env),
      include_ai: parseIncludeAi(env),
    },
    jsearch: {
      api_path: parseJsearchApiPath(env),
      query: env.JSEARCH_QUERY?.trim() || "",
      page: 1,
      num_pages: 1,
      country: primaryCountry.iso2,
      employment_types: jsearchEmploymentTypesForPolicy(searchPolicy),
      date_posted: jsearchDatePostedForPolicy(searchPolicy),
      work_from_home: searchPolicy.remoteOnly,
    },
    jobs_api: {
      api_path: "/v2/linkedin/search",
      query: env.JOBS_API_QUERY?.trim() || "Customer Care",
      location: primaryCountry.fullName,
      date_posted: jobsApiDatePostedForPolicy(searchPolicy),
      workplace_types: jobsApiWorkplaceTypesForPolicy(searchPolicy),
      employment_types: jobsApiEmploymentTypesForPolicy(searchPolicy),
    },
    remote_jobs: {
      api_path: env.REMOTE_JOBS_API_PATH?.trim() || "/jobs",
      title_search: env.REMOTE_JOBS_QUERY?.trim() || queryCache.quotedOr.tier1 || "Customer Success",
      country: primaryCountry.iso2,
      employment_type: jobsApiEmploymentTypesForPolicy(searchPolicy),
      limit: Math.max(1, Math.min(100, parseInt(env.REMOTE_JOBS_MAX_JOBS_PER_CHUNK?.trim() || "100", 10) || 100)),
      include_company: true,
      include_total_count: false,
    },
    publicBaseUrl: env.PUBLIC_BASE_URL?.trim() ?? "",
  };
}

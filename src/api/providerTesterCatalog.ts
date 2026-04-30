import { getProviderTesterDefaults } from "./providerTesterDefaults";
import type { JobSourceId } from "../types/job";

export type ProviderTesterFieldJson =
  | { key: string; label: string; kind: "string" }
  | { key: string; label: string; kind: "multiline"; height?: number }
  | { key: string; label: string; kind: "int"; min?: number; max?: number }
  | { key: string; label: string; kind: "bool"; checkboxLabel?: string }
  | { key: string; label: string; kind: "enum"; options: string[] };

export type ProviderTesterProviderJson = {
  id: JobSourceId;
  label: string;
  /** Shown in the request panel subtitle */
  requestSource: string;
  rapidApiHost: string;
  /** Which normalizer the desktop tester uses for the Extracted panel */
  extractor: "linkedin_jobs" | "jsearch" | "jobs_api";
  jobsArrayPath: "root" | "data";
  fields: ProviderTesterFieldJson[];
  defaults: Record<string, unknown>;
};

/**
 * Editable REST path segment (Fantastic Jobs `api_path`, JSearch `/search`, etc.).
 * Use as the first field for each synced provider in this catalog.
 */
export const SYNCED_PROVIDER_API_PATH_FIELD: ProviderTesterFieldJson = {
  key: "api_path",
  label: "api_path",
  kind: "string",
};

const LINKEDIN_FIELDS: ProviderTesterFieldJson[] = [
  SYNCED_PROVIDER_API_PATH_FIELD,
  { key: "limit", label: "limit", kind: "int", min: 10, max: 100 },
  { key: "offset", label: "offset", kind: "int", min: 0, max: 1_000_000 },
  {
    key: "description_type",
    label: "description_type",
    kind: "enum",
    options: ["none", "text", "html"],
  },
  { key: "remote", label: "remote", kind: "enum", options: ["true", "false", "omit"] },
  { key: "agency", label: "agency", kind: "enum", options: ["false", "true", "omit"] },
  {
    key: "include_ai",
    label: "include_ai",
    kind: "bool",
    checkboxLabel: "include_ai=true (omit when unchecked; matches LINKEDIN_INCLUDE_AI=false)",
  },
  { key: "date_filter", label: "date_filter (optional)", kind: "string" },
  { key: "type_filter", label: "type_filter", kind: "string" },
  { key: "title_filter", label: "title_filter", kind: "multiline", height: 4 },
  { key: "location_filter", label: "location_filter", kind: "string" },
];

const JSEARCH_FIELDS: ProviderTesterFieldJson[] = [
  {
    key: "api_path",
    label: "api_path (path only, e.g. /search — host is fixed in build-url)",
    kind: "string",
  },
  { key: "query", label: "query", kind: "string" },
  { key: "page", label: "page", kind: "int", min: 1, max: 100 },
  { key: "num_pages", label: "num_pages", kind: "int", min: 1, max: 20 },
  { key: "country", label: "country (ISO, e.g. de, us)", kind: "string" },
  {
    key: "employment_types",
    label: "employment_types",
    kind: "enum",
    options: ["FULLTIME", "PARTTIME"],
  },
  { key: "date_posted", label: "date_posted", kind: "string" },
  {
    key: "work_from_home",
    label: "work_from_home",
    kind: "bool",
    checkboxLabel:
      "work_from_home (default true in Worker; set false to match buildJsearchUrl workFromHome=false)",
  },
];

const JOBS_API_FIELDS: ProviderTesterFieldJson[] = [
  {
    key: "api_path",
    label: "api_path (search path; default /v2/linkedin/search)",
    kind: "string",
  },
  { key: "query", label: "query", kind: "string" },
  { key: "location", label: "location (country/region name)", kind: "string" },
  { key: "date_posted", label: "date_posted (month|week|day)", kind: "string" },
  {
    key: "workplace_types",
    label: "workplace_types (e.g. remote or remote;hybrid;onSite)",
    kind: "string",
  },
  {
    key: "employment_types",
    label: "employment_types (semicolon-separated)",
    kind: "string",
  },
];

/**
 * Full schema + defaults for the RapidAPI desktop tester (`scripts/linkedin_api_tester.py`).
 * Add a new row here when a new `JobSourceId` ships — no Python field list to update.
 * Start each synced provider’s `fields` with {@link SYNCED_PROVIDER_API_PATH_FIELD} unless the API has no path segment.
 */
export async function getProviderTesterCatalog(env: Env): Promise<{
  publicBaseUrl: string;
  providers: ProviderTesterProviderJson[];
}> {
  const d = await getProviderTesterDefaults(env);
  return {
    publicBaseUrl: d.publicBaseUrl,
    providers: [
      {
        id: "linkedin_jobs",
        label: "LinkedIn (Fantastic Jobs)",
        requestSource: "linkedinJobs.ts / buildLinkedinJobsUrl",
        rapidApiHost: "linkedin-job-search-api.p.rapidapi.com",
        extractor: "linkedin_jobs",
        jobsArrayPath: "root",
        fields: LINKEDIN_FIELDS,
        defaults: d.linkedin as Record<string, unknown>,
      },
      {
        id: "jsearch",
        label: "JSearch",
        requestSource: "jsearch.ts / buildJsearchUrl",
        rapidApiHost: "jsearch.p.rapidapi.com",
        extractor: "jsearch",
        jobsArrayPath: "data",
        fields: JSEARCH_FIELDS,
        defaults: d.jsearch as Record<string, unknown>,
      },
      {
        id: "jobs_api",
        label: "Jobs API (Pat92 — LinkedIn search)",
        requestSource: "jobsApi.ts / buildJobsApiSearchUrl",
        rapidApiHost: "jobs-api14.p.rapidapi.com",
        extractor: "jobs_api",
        jobsArrayPath: "data",
        fields: JOBS_API_FIELDS,
        defaults: d.jobs_api as Record<string, unknown>,
      },
    ],
  };
}

import { buildJobsApiSearchUrl } from "../providers/jobsApi";
import { buildJsearchUrl } from "../providers/jsearch";
import { buildLinkedinJobsUrl } from "../providers/linkedinJobs";
import { buildRemoteJobsUrl, REMOTE_JOBS_HOST } from "../providers/remoteJobs";
import type { JobSourceId } from "../types/job";

function pickString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * Build the same RapidAPI GET URL as the pipeline (`buildLinkedinJobsUrl` / `buildJsearchUrl`).
 * Used by `scripts/linkedin_api_tester.py` so URL rules live only in TypeScript.
 */
export function buildProviderTesterUrl(
  providerId: JobSourceId,
  params: Record<string, unknown>,
): { ok: true; url: string; rapidApiHost: string } | { ok: false; error: string } {
  if (providerId === "linkedin_jobs") {
    const p = params;
    const apiPath = String(p.api_path ?? "/active-jb-24h");
    const limit = Number(p.limit);
    const offset = Number(p.offset);
    const descRaw = String(p.description_type ?? "text").toLowerCase();
    const descriptionType: "" | "text" | "html" =
      descRaw === "none" ? "" : descRaw === "html" ? "html" : "text";
    const remoteStr = String(p.remote ?? "omit").toLowerCase();
    const remote: boolean | undefined =
      remoteStr === "true" ? true : remoteStr === "false" ? false : undefined;
    const agencyStr = String(p.agency ?? "omit").toLowerCase();
    const agency: boolean | undefined =
      agencyStr === "true" ? true : agencyStr === "false" ? false : undefined;

    const url = buildLinkedinJobsUrl({
      apiPath,
      limit: Number.isFinite(limit) ? limit : 100,
      offset: Number.isFinite(offset) ? offset : 0,
      titleFilter: pickString(p.title_filter),
      locationFilter: pickString(p.location_filter),
      descriptionType,
      dateFilter: pickString(p.date_filter),
      typeFilter: pickString(p.type_filter),
      remote,
      agency,
      includeAi: Boolean(p.include_ai),
    });
    return { ok: true, url: url.toString(), rapidApiHost: "linkedin-job-search-api.p.rapidapi.com" };
  }

  if (providerId === "jsearch") {
    const p = params;
    const page = Math.max(1, Number(p.page) || 1);
    const numPagesRaw = Number(p.num_pages);
    const numPages = Number.isFinite(numPagesRaw)
      ? Math.max(1, Math.min(20, numPagesRaw))
      : 1;
    const apiPathRaw = String(p.api_path ?? "/search").trim();
    const url = buildJsearchUrl({
      apiPath: apiPathRaw || undefined,
      query: String(p.query ?? ""),
      page,
      numPages,
      country: String(p.country ?? "us").trim().toLowerCase(),
      employmentTypes: String(p.employment_types ?? "FULLTIME").trim().toUpperCase(),
      datePosted: String(p.date_posted ?? "month").trim(),
      workFromHome: p.work_from_home !== false,
    });
    return { ok: true, url: url.toString(), rapidApiHost: "jsearch.p.rapidapi.com" };
  }

  if (providerId === "jobs_api") {
    const p = params;
    const apiPath = String(p.api_path ?? "/v2/linkedin/search").trim();
    const emp = String(p.employment_types ?? "").trim();
    const url = buildJobsApiSearchUrl({
      searchPath: apiPath,
      query: String(p.query ?? ""),
      location: String(p.location ?? "United Kingdom"),
      datePosted: String(p.date_posted ?? "month"),
      workplaceTypes: String(p.workplace_types ?? "remote"),
      employmentTypes: emp || "contractor;fulltime;parttime;intern;temporary",
    });
    return { ok: true, url: url.toString(), rapidApiHost: "jobs-api14.p.rapidapi.com" };
  }

  if (providerId === "remote_jobs") {
    const p = params;
    const limitRaw = Number(p.limit);
    const url = buildRemoteJobsUrl({
      apiPath: String(p.api_path ?? "/jobs"),
      titleSearch: String(p.title_search ?? ""),
      country: String(p.country ?? "us"),
      employmentType: String(p.employment_type ?? "fulltime"),
      cursor: pickString(p.cursor),
      limit: Number.isFinite(limitRaw) ? limitRaw : 100,
      includeCompany: p.include_company !== false,
      includeTotalCount: p.include_total_count === true,
    });
    return { ok: true, url: url.toString(), rapidApiHost: REMOTE_JOBS_HOST };
  }

  return { ok: false, error: `Unknown provider: ${providerId}` };
}

import {
  backfillSalaryEurCacheBatch,
  countJobsMissingSalaryEurCache,
  getJob,
  getJobCompany,
  bulkAcceptActiveJobs,
  bulkDenyActiveJobs,
  bulkRestoreJobs,
  type DashboardJobListCursor,
  defaultDashboardJobListPrefs,
  deleteJobsByIdsWithR2Cleanup,
  type DashboardJobListPrefs,
  type DashboardJobListTab,
  getFavoriteJobIdsSet,
  getJobR2Keys,
  invalidateDashboardListMemoCaches,
  queryDashboardJobListIds,
  queryDashboardJobListPage,
  loadNormalizedJob,
  loadScoringResult,
  saveGeneratedDrafts,
  restoreDashboardJobToActive,
  restoreFilteredJobToActive,
  setDashboardDecision,
  setJobFavorite,
} from "../db/jobs";
import { fetchUsdGbpToEurRates } from "../pipeline/hardFilters";
import { rescoreJobBypassingHardFilters, retryFailedJobProcessing } from "../pipeline/debugAiRescore";
import { generateTailoredDrafts } from "../pipeline/generateDrafts";
import { getCvExtractionFromDb, setCvExtractionCache } from "../db/cvCache";
import { extractCvFromDocxArrayBuffer } from "../profile/extractCvFromDocx";
import { getCvCacheStatus } from "../profile/cvSource";
import { sanitizeCvTextForAiScoring } from "../profile/cvSanitizeForScoring";
import { DOCX_MIME, htmlToDocxArrayBuffer, textToDocxArrayBuffer } from "./buildDocx";
import { buildSearchPathExhaustionPayload } from "./searchPathExhaustion";
import { buildStatisticsPayload } from "./statistics";
import {
  buildIngestionFactsFromNormalizedJson,
  buildRawApiFieldsFromNormalizedJson,
  hasStoredApiRawFields,
  hasStoredIngestionRequestParams,
} from "./ingestionFacts";
import { DEFAULT_SEARCH_COUNTRIES, normalizeSearchCountries } from "../config/searchCountries";
import { listingLogoFromUrls } from "./listingLogo";
import {
  getApiExtractionEnabled,
  getDashboardAiDebugRescoreEnabled,
  getDashboardShowJobApiRaw,
  getDashboardShowJobPipelineParams,
  getEnabledJobSourceIdsFromDb,
  getPipelineFetchAllowed,
  getSearchCountries,
  getSearchRoleTiers,
  getSearchRuntimePolicy,
  getVerboseLoggingEnabled,
  getProviderRequestCapOverrides,
  getResolvedProviderDailyRequestCap,
  isPipelineHardKillActive,
  patchProviderRequestCapOverrides,
  setApiExtractionEnabled,
  setDashboardAiDebugRescoreEnabled,
  setDashboardShowJobApiRaw,
  setDashboardShowJobPipelineParams,
  setEnabledJobSourceIds,
  setSearchCountries,
  setSearchRoleTiers,
  setStoredOpenAiDraftInstruction,
  setStoredOpenAiScoringPolicyInstruction,
  setVerboseLoggingEnabled,
} from "../db/appSettings";
import {
  getAiInstructionsForEditor,
  resetOpenAiInstructionsToDefaults,
  validateDraftInstructionForSave,
  validateScoringInstructionForSave,
} from "../pipeline/aiInstructions";
import { getRegisteredProviderIds } from "../providers";
import type { JobSourceId, NormalizedJob } from "../types/job";
import { resolveWorkplaceType } from "../providers/lib/workplaceTypeCanonical";
import {
  appendAiInstructionRevision,
  aiInstructionSnapshotsEqual,
  deleteAiInstructionRevision,
  getAiInstructionRevisionById,
  listAiInstructionRevisions,
  revertAiInstructionsToRevision,
  updateAiInstructionRevisionNote,
  validateRevisionNoteForSave,
} from "../db/aiInstructionRevisions";
import {
  appendSearchRoleRevision,
  deleteSearchRoleRevision,
  getSearchRoleRevisionById,
  listSearchRoleRevisions,
  revertSearchRolesToRevision,
  searchRoleTiersEqual,
  tiersFromRevisionRow,
  updateSearchRoleRevisionNote,
} from "../db/searchRoleRevisions";
import { DEFAULT_SEARCH_ROLE_TIERS, normalizeSearchRoleTiers } from "../config/searchRoles";
import {
  deleteAllAppLogs,
  deleteOperationalAppLogs,
  deleteOperationalIncidentGroup,
  listAppLogs,
  listOperationalAppLogs,
  type AppLogRow,
} from "../db/appLogs";
import {
  clearAllProviderUtcDayRequestCountsForUtcDate,
  getLinkedinFreezeUntil,
  getProviderUtcDayRequestCount,
  utcYmdFromUnix,
} from "../db/pipelineState";
import { log } from "../logging/appLog";
import {
  clearExhaustPause,
  clearRequestCapPauseForProviders,
  getCoordinatorStatus,
  startOrResumeCoordinator,
} from "../orchestration/client";
import { getOperationalHoursState } from "../orchestration/operationalHours";
import {
  authenticateUser,
  clearSessionCookie,
  createSessionCookie,
  requireDashboardSession,
} from "./session";
import {
  createUser,
  getUserById,
  getUserProviderCaps,
  listUsers,
  normalizeUsername,
  setUserProviderCaps,
  setUserRole,
  setUserStatus,
  syncNewUserTemplateFromAdmin,
  updatePassword,
  USER_SETTINGS_TEMPLATE_KEYS,
} from "../db/users";
import {
  getGlobalNewUserTemplate,
  getGlobalScoringContract,
  setGlobalNewUserTemplate,
  setGlobalScoringContract,
} from "../db/globalSettings";
import { OPENAI_SCORING_CONTRACT_INSTRUCTION } from "../pipeline/aiInstructionDefaults";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function safeJsonStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const x = JSON.parse(raw) as unknown;
    return Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Prefer live {@link resolveWorkplaceType} on stored JSON so dashboard matches current rules
 * (ingestion params vs. prose) without re-ingesting; fall back to SQL column, then Office.
 */
function workplaceTypeForDashboardList(
  sqlWorkplace: string | null | undefined,
  normalizedJson: string | null | undefined,
): "Office" | "Remote" | "Hybrid" {
  if (normalizedJson) {
    try {
      return resolveWorkplaceType(JSON.parse(normalizedJson) as NormalizedJob);
    } catch {
      /* ignore */
    }
  }
  const w = sqlWorkplace?.trim();
  if (w === "Office" || w === "Remote" || w === "Hybrid") return w;
  return "Office";
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** UTC calendar date for middle row: YYYY.MM.DD */
function formatPostedDotYmdUtc(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

/** UTC for tooltips: YYYY.MM.DD HH:MM */
function formatDotYmdHmUtc(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}.${m}.${day} ${h}:${min}`;
}

/** Prefer persisted API fetch time; else row creation time. */
function resolveApiRequestUnixSec(
  apiFetchedUnix: number | null,
  createdAtFallback: number,
): number | null {
  if (apiFetchedUnix != null && Number.isFinite(apiFetchedUnix) && apiFetchedUnix > 0) {
    return apiFetchedUnix;
  }
  if (createdAtFallback > 0) return createdAtFallback;
  return null;
}

const TAB_RE = /^(active|favorites|accepted|denied|filtered)$/;
const DASHBOARD_JOB_PAGE_LIMIT_DEFAULT = 20;
const DASHBOARD_JOB_PAGE_LIMIT_MAX = 100;

function normalizeDashboardJobListCursor(raw: unknown): DashboardJobListCursor | null {
  if (raw == null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: DashboardJobListCursor = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key) return null;
    if (typeof value === "string") {
      if (!value.length) return null;
      out[key] = value;
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
      continue;
    }
    return null;
  }
  return typeof out.id === "string" && out.id.length > 0 ? out : null;
}

function clampDashboardJobListLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DASHBOARD_JOB_PAGE_LIMIT_DEFAULT;
  return Math.min(DASHBOARD_JOB_PAGE_LIMIT_MAX, Math.max(1, Math.floor(n)));
}

function copyDashboardBooleanRecord(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== "string" || typeof value !== "boolean") continue;
    out[key] = value;
  }
  return out;
}

function normalizeDashboardJobListPrefs(raw: unknown): DashboardJobListPrefs {
  const prefs = defaultDashboardJobListPrefs();
  if (!raw || typeof raw !== "object") return prefs;

  const obj = raw as Record<string, unknown>;
  const src = obj.src;
  if (src && typeof src === "object") {
    const value = src as Record<string, unknown>;
    if (typeof value.linkedin === "boolean") prefs.src.linkedin = value.linkedin;
    if (typeof value.google === "boolean") prefs.src.google = value.google;
    if (typeof value.other === "boolean") prefs.src.other = value.other;
  }

  const rel = obj.rel;
  if (rel && typeof rel === "object") {
    const value = rel as Record<string, unknown>;
    if (typeof value.high === "boolean") prefs.rel.high = value.high;
    if (typeof value.medium === "boolean") prefs.rel.medium = value.medium;
    if (typeof value.low === "boolean") prefs.rel.low = value.low;
    if (typeof value.failed === "boolean") prefs.rel.failed = value.failed;
    if (typeof value.none === "boolean") prefs.rel.none = value.none;
  }

  const contract = obj.contract;
  if (contract && typeof contract === "object") {
    const value = contract as Record<string, unknown>;
    if (typeof value.ft === "boolean") prefs.contract.ft = value.ft;
    if (typeof value.pt === "boolean") prefs.contract.pt = value.pt;
    if (typeof value.temp === "boolean") prefs.contract.temp = value.temp;
    if (typeof value.other === "boolean") prefs.contract.other = value.other;
  }

  prefs.countries = copyDashboardBooleanRecord(obj.countries);
  prefs.roleQueries = copyDashboardBooleanRecord(obj.roleQueries);

  if (obj.sortRel === "high-first" || obj.sortRel === "low-first" || obj.sortRel === "as-fetched") {
    prefs.sortRel = obj.sortRel;
  }
  if (
    obj.sortSrc === "default" ||
    obj.sortSrc === "linkedin-first" ||
    obj.sortSrc === "google-first" ||
    obj.sortSrc === "other-first"
  ) {
    prefs.sortSrc = obj.sortSrc;
  }
  if (obj.sortSalary === "off" || obj.sortSalary === "high-first" || obj.sortSalary === "low-first") {
    prefs.sortSalary = obj.sortSalary;
  }
  if (obj.sortDate === "off" || obj.sortDate === "new-first" || obj.sortDate === "old-first") {
    prefs.sortDate = obj.sortDate;
  }
  if (
    obj.filterFetchAge === "off" ||
    obj.filterFetchAge === "24h" ||
    obj.filterFetchAge === "2d" ||
    obj.filterFetchAge === "3d" ||
    obj.filterFetchAge === "7d" ||
    obj.filterFetchAge === "14d" ||
    obj.filterFetchAge === "21d"
  ) {
    prefs.filterFetchAge = obj.filterFetchAge;
  }
  if (typeof obj.listSearch === "string") {
    prefs.listSearch = obj.listSearch;
  }
  return prefs;
}

/**
 * Serializes salary-cache backfill nudges across concurrent dashboard requests on the same isolate.
 * First read sets this to an in-flight promise that runs one ~200-row batch; subsequent reads
 * await the same promise (cheap no-op) so a flood of requests doesn't fan out into many writes.
 * When it settles we clear the slot so the next request can schedule another batch.
 */
let salaryCacheBackfillInFlight: Promise<void> | null = null;
let salaryCacheBackfillKnownZero = false;

function scheduleSalaryCacheBackfillNudge(env: Env, ctx: ExecutionContext | undefined): void {
  if (!ctx) return;
  if (salaryCacheBackfillKnownZero) return;
  if (salaryCacheBackfillInFlight) return;
  const task = (async () => {
    try {
      const missing = await countJobsMissingSalaryEurCache(env.DB);
      if (missing <= 0) {
        salaryCacheBackfillKnownZero = true;
        return;
      }
      const fx = await fetchUsdGbpToEurRates();
      const now = Math.floor(Date.now() / 1000);
      // 2000/request converges the full ~8k corpus in ~4 dashboard loads (each row is a cheap
      // single-row UPDATE). waitUntil has plenty of CPU budget on Workers Standard for this.
      await backfillSalaryEurCacheBatch(env.DB, fx, now, 2000);
      // Totals / facets don't change, but cached list rows do — reset so the user sees salaries quickly.
      invalidateDashboardListMemoCaches();
    } catch {
      // Swallow: nudges are best-effort; cron takes care of stragglers.
    } finally {
      salaryCacheBackfillInFlight = null;
    }
  })();
  salaryCacheBackfillInFlight = task;
  ctx.waitUntil(task);
}

async function buildDashboardJobListResponse(
  env: Env,
  userId: string,
  query: { tab: DashboardJobListTab; cursor: DashboardJobListCursor | null; limit: number; prefs: DashboardJobListPrefs },
  ctx?: ExecutionContext,
): Promise<Response> {
  // Everything the initial dashboard load needs runs concurrently. Previously the page query,
  // favorite ids and FX lookup ran serially (adding ~2× D1 round trips + any Frankfurter delay).
  // FX is now gone from the list path entirely — salary display/sort use `jobs.salary_monthly_eur`
  // and `jobs.salary_display_eur` populated at ingest time / via the backfill cron.
  const [page, favSet, showPipelineParams, showApiRaw, aiDebugRescore] = await Promise.all([
    queryDashboardJobListPage(env.DB, userId, query.tab, query.prefs, query.cursor, query.limit),
    getFavoriteJobIdsSet(env.DB, userId),
    getDashboardShowJobPipelineParams(env.DB, userId),
    getDashboardShowJobApiRaw(env.DB, userId),
    getDashboardAiDebugRescoreEnabled(env.DB, userId),
  ]);
  const jobs = page.rows.map((r) => {
    const jobUrl = r.job_url ?? "";
    const applyUrl = r.apply_url ?? "";
    const logo = listingLogoFromUrls(jobUrl, applyUrl);
    const apiFetched = numOrNull(r.api_fetched_at_unix);
    const createdAt = typeof r.created_at === "number" ? r.created_at : 0;
    const apiRequestSec = resolveApiRequestUnixSec(apiFetched, createdAt);
    const apiRequestDateYmd = apiRequestSec != null ? formatPostedDotYmdUtc(apiRequestSec) : "";
    const dateHoverTitle =
      apiRequestSec != null ? `API request (UTC): ${formatDotYmdHmUtc(apiRequestSec)}` : "";
    const postedListing = numOrNull(r.posted_at_unix);
    const listingPostedAtUnix = postedListing != null && postedListing > 0 ? postedListing : 0;
    const ingestedAtUnix =
      apiRequestSec != null && apiRequestSec > 0 ? apiRequestSec : createdAt > 0 ? createdAt : 0;
    const postedAtUnix =
      listingPostedAtUnix > 0 ? listingPostedAtUnix : ingestedAtUnix > 0 ? ingestedAtUnix : 0;
    return {
      id: r.id,
      status: r.status ?? "",
      title: r.title ?? "",
      company: r.company ?? "",
      jobUrl,
      applyUrl,
      countryName: r.country_name ?? "",
      employmentType: r.employment_type ?? "",
      workplaceType: workplaceTypeForDashboardList(r.workplace_type, r.normalized_json),
      searchQuery: r.search_query ?? "",
      searchTier: r.search_tier === 1 || r.search_tier === 2 ? 1 : null,
      apiRequestDateYmd,
      postedDateYmd: apiRequestDateYmd,
      dateHoverTitle,
      postedAtUnix,
      listingPostedAtUnix,
      ingestedAtUnix,
      sortSalaryMonthlyEur: typeof r.salary_monthly_eur === "number" ? r.salary_monthly_eur : null,
      salaryEur: r.salary_display_eur ?? "N/A",
      fitScore: r.fit_score ?? 0,
      recommendation: r.recommendation ?? "",
      positionSummary: (r.position_summary ?? "").trim(),
      positives: safeJsonStringArray(r.reasons_to_apply),
      negatives: safeJsonStringArray(r.risks),
      logo,
      hasDocx: Boolean(r.r2_cv_key && r.r2_cover_key),
      downloadCv: `/api/jobs/${r.id}/download/cv`,
      downloadCover: `/api/jobs/${r.id}/download/cover`,
      filterReasons: filterOutExplanationLines(r),
      isFavorite: favSet.has(r.id),
      ingestionFacts: showPipelineParams ? buildIngestionFactsFromNormalizedJson(r.normalized_json) : [],
      ingestionRequestParamsStored: showPipelineParams ? hasStoredIngestionRequestParams(r.normalized_json) : false,
      apiRawFields: showApiRaw ? buildRawApiFieldsFromNormalizedJson(r.normalized_json) : [],
      apiRawFieldsStored: showApiRaw ? hasStoredApiRawFields(r.normalized_json) : false,
    };
  });

  return json({
    ok: true,
    tab: query.tab,
    jobs,
    totalMatching: page.totalMatching,
    totalUnfiltered: page.totalUnfiltered,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    facets: page.facets,
    jobExpandUi: {
      showPipelineRequestParams: showPipelineParams,
      showApiRawFields: showApiRaw,
      aiDebugRescore,
    },
  });
}

const VENDOR_LABELS: Record<JobSourceId, string> = {
  linkedin_jobs: "LinkedIn (Fantastic Jobs)",
  jsearch: "JSearch",
  jobs_api: "Jobs API (Pat92)",
};

async function buildVendorsPayload(
  env: Env,
  userId: string,
): Promise<{ id: JobSourceId; label: string; enabled: boolean }[]> {
  const ids = getRegisteredProviderIds();
  const enabledIds = await getEnabledJobSourceIdsFromDb(env.DB, userId, ids);
  const enabledSet = new Set(enabledIds);
  return ids.map((id) => ({
    id,
    label: VENDOR_LABELS[id] ?? id,
    enabled: enabledSet.has(id),
  }));
}

/** Positive env int = cap; missing/0/invalid = no cap (matches pipeline RapidAPI limiter). */
function parsePositiveEnvInt(raw: string | undefined): number | null {
  const n = raw?.trim() ? parseInt(raw.trim(), 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function requestCapsPerDayFromEnv(env: Env): Record<JobSourceId, number | null> {
  return {
    linkedin_jobs: parsePositiveEnvInt(env.LINKEDIN_MAX_API_CALLS_PER_RUN),
    jsearch: parsePositiveEnvInt(env.JSEARCH_MAX_API_CALLS_PER_RUN),
    jobs_api: parsePositiveEnvInt(env.JOBS_API_MAX_API_CALLS_PER_RUN),
  };
}

const MAX_REQUEST_CAP_PER_DAY = 1_000_000;

type RequestCapDetail = {
  effective: number | null;
  envDefault: number | null;
  databaseOverride: number | null;
};

type OperationalVendorState = {
  id: JobSourceId;
  label: string;
  enabled: boolean;
  cap: number | null;
  usedUtcDay: number;
  utcDay: string;
  exhaustedForDay: boolean;
  orchestrationDoneForCycle: boolean;
  orchestrationNextEligibleAt: number;
  orchestrationPauseKind: string | null;
};

type IncidentSeverity = "critical" | "moderate" | "low";

function isIncidentSeverity(value: unknown): value is IncidentSeverity {
  return value === "critical" || value === "moderate" || value === "low";
}

type OperationalIncidentGroup = {
  key: string;
  severity: IncidentSeverity;
  category: string;
  eventType: string;
  scope: string;
  message: string;
  latestAt: number;
  firstAt: number;
  count: number;
  level: string;
  providerId: string | null;
  jobId: string | null;
  cycleId: string | null;
  phase: string | null;
  statusKind: string | null;
  meta: unknown;
};

async function buildRequestCapsPayload(
  env: Env,
  userId: string,
): Promise<{
  requestCapsPerDay: Record<JobSourceId, number | null>;
  requestCapsDetail: Record<JobSourceId, RequestCapDetail>;
}> {
  const envOnly = requestCapsPerDayFromEnv(env);
  const overrides = await getProviderRequestCapOverrides(env.DB, userId);
  const ids = getRegisteredProviderIds();
  const requestCapsPerDay = {} as Record<JobSourceId, number | null>;
  const requestCapsDetail = {} as Record<JobSourceId, RequestCapDetail>;
  for (const id of ids) {
    const envDef = envOnly[id];
    const dbO = overrides[id];
    const hasDb = dbO !== undefined;
    let effective: number | null;
    if (hasDb) {
      effective = dbO! <= 0 ? null : dbO!;
    } else {
      effective = envDef;
    }
    requestCapsPerDay[id] = effective;
    requestCapsDetail[id] = {
      effective,
      envDefault: envDef,
      databaseOverride: hasDb ? dbO! : null,
    };
  }
  return { requestCapsPerDay, requestCapsDetail };
}

async function buildOperationalVendorStates(
  env: Env,
  userId: string,
  nowSec: number,
  coord: Awaited<ReturnType<typeof getCoordinatorStatus>>,
): Promise<OperationalVendorState[]> {
  const ymd = utcYmdFromUnix(nowSec);
  const capsPayload = await buildRequestCapsPayload(env, userId);
  const vendorsMeta = await buildVendorsPayload(env, userId);
  const ids = getRegisteredProviderIds();
  const orch =
    coord && "ok" in coord && coord.ok === true ? coord.providerOrchestration ?? {} : {};
  return Promise.all(
    ids.map(async (id) => {
      const meta = vendorsMeta.find((v) => v.id === id);
      const label = meta?.label ?? VENDOR_LABELS[id] ?? id;
      const enabled = meta?.enabled ?? false;
      const cap = capsPayload.requestCapsPerDay[id] ?? null;
      const usedUtcDay = await getProviderUtcDayRequestCount(env.DB, userId, id, ymd);
      const exhaustedForDay = cap != null && cap > 0 && usedUtcDay >= cap;
      const o = orch[id];
      return {
        id,
        label,
        enabled,
        cap,
        usedUtcDay,
        utcDay: ymd,
        exhaustedForDay,
        orchestrationDoneForCycle: o?.doneForCycle ?? false,
        orchestrationNextEligibleAt: o?.nextEligibleAt ?? 0,
        orchestrationPauseKind: o?.lastPauseKind ?? null,
      };
    }),
  );
}

function safeParseLogMeta(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function orchestrationFailureWasDurableObjectDeployNoise(row: AppLogRow): boolean {
  if ((row.event_type ?? "") !== "orchestration_failure") return false;
  const parts: string[] = [row.message ?? ""];
  const raw = row.meta;
  if (typeof raw === "string") {
    try {
      const o = JSON.parse(raw) as { message?: unknown };
      if (typeof o.message === "string") parts.push(o.message);
    } catch {
      parts.push(raw);
    }
  } else if (raw && typeof raw === "object" && raw !== null && "message" in raw) {
    parts.push(String((raw as { message?: unknown }).message ?? ""));
  }
  const blob = parts.join(" ").toLowerCase();
  return blob.includes("durable object reset") && blob.includes("code was updated");
}

/** Expected orchestration signals — omit from ops incidents / header flip (handles legacy `log.low` rows too). */
function isExcludedOperationalIncidentRow(row: AppLogRow): boolean {
  const et = row.event_type ?? "";
  if (et === "provider_daily_request_cap_reached") return true;
  if (et === "request_cap_pause_cleared") return true;
  /** AI debug clone path: informational only, not an operational anomaly. */
  if (et === "debug_clone_skipped_content_dedupe") return true;
  if (orchestrationFailureWasDurableObjectDeployNoise(row)) return true;
  const msg = (row.message ?? "").trim();
  if (msg.includes("Synthetic ingest: skipping content-hash duplicate reject")) return true;
  if (msg.includes("Provider daily request cap reached") && msg.includes("skipping vendor requests")) {
    return true;
  }
  if (msg.includes("Cleared request-cap pause") && msg.includes("dashboard raised cap")) return true;
  return false;
}

function groupOperationalIncidents(rows: AppLogRow[]): Record<IncidentSeverity, OperationalIncidentGroup[]> {
  const buckets: Record<IncidentSeverity, Map<string, OperationalIncidentGroup>> = {
    critical: new Map(),
    moderate: new Map(),
    low: new Map(),
  };
  for (const row of rows) {
    if (isExcludedOperationalIncidentRow(row)) continue;
    const severity = row.severity as IncidentSeverity | null;
    if (severity !== "critical" && severity !== "moderate" && severity !== "low") continue;
    const key =
      row.fingerprint ||
      [
        severity,
        row.category ?? "",
        row.event_type ?? "",
        row.provider_id ?? "",
        row.phase ?? "",
        row.message,
      ].join("|");
    const existing = buckets[severity].get(key);
    const meta = safeParseLogMeta(row.meta);
    if (!existing) {
      buckets[severity].set(key, {
        key,
        severity,
        category: row.category ?? "system",
        eventType: row.event_type ?? "unknown",
        scope: row.scope,
        message: row.message,
        latestAt: row.ts,
        firstAt: row.ts,
        count: 1,
        level: row.level,
        providerId: row.provider_id ?? null,
        jobId: row.job_id ?? null,
        cycleId: row.cycle_id ?? null,
        phase: row.phase ?? null,
        statusKind: row.status_kind ?? null,
        meta,
      });
      continue;
    }
    existing.count += 1;
    if (row.ts < existing.firstAt) existing.firstAt = row.ts;
    if (row.ts > existing.latestAt) existing.latestAt = row.ts;
  }
  return {
    critical: [...buckets.critical.values()].sort((a, b) => b.latestAt - a.latestAt).slice(0, 8),
    moderate: [...buckets.moderate.values()].sort((a, b) => b.latestAt - a.latestAt).slice(0, 10),
    low: [...buckets.low.values()].sort((a, b) => b.latestAt - a.latestAt).slice(0, 10),
  };
}

/** Optional test incident for header flip / ops cards (set `DASHBOARD_DUMMY_LOW_INCIDENT=true`). */
function appendDummyLowIncidentIfEnabled(
  env: Env,
  incidents: Record<IncidentSeverity, OperationalIncidentGroup[]>,
  nowSec: number,
): Record<IncidentSeverity, OperationalIncidentGroup[]> {
  if (env.DASHBOARD_DUMMY_LOW_INCIDENT !== "true") return incidents;
  const dummy: OperationalIncidentGroup = {
    key: "__dashboard_dummy_low__",
    severity: "low",
    category: "test",
    eventType: "dummy",
    scope: "dashboard",
    message: "It's a dummy",
    latestAt: nowSec,
    firstAt: nowSec,
    count: 1,
    level: "warn",
    providerId: null,
    jobId: null,
    cycleId: null,
    phase: null,
    statusKind: "dummy",
    meta: { dummy: true },
  };
  return {
    critical: incidents.critical,
    moderate: incidents.moderate,
    low: [dummy, ...incidents.low].slice(0, 10),
  };
}

function buildOperationalStatusSummary(args: {
  coord: Awaited<ReturnType<typeof getCoordinatorStatus>>;
  gate: Awaited<ReturnType<typeof getPipelineFetchAllowed>>;
  operational: ReturnType<typeof getOperationalHoursState>;
  vendors: OperationalVendorState[];
  incidents: Record<IncidentSeverity, OperationalIncidentGroup[]>;
}) {
  const { coord, gate, operational, vendors, incidents } = args;
  const topIncident = incidents.critical[0] ?? incidents.moderate[0] ?? null;
  const headline =
    !coord || coord.ok !== true
      ? "Coordinator status unavailable"
      : gate.reason === "PIPELINE_HARD_KILL"
        ? "Pipeline blocked by hard kill"
        : gate.reason === "API_EXTRACTION_DISABLED"
          ? "Pipeline paused from dashboard switch"
          : gate.reason === "OUTSIDE_OPERATIONAL_HOURS"
            ? "Waiting for operational window"
            : coord.status === "running"
              ? "Pipeline running"
              : coord.status === "sleeping"
                ? "Pipeline sleeping"
                : coord.status === "paused"
                  ? "Pipeline paused"
                  : "Pipeline idle";
  const driver =
    topIncident?.message ??
    (gate.reason === "OUTSIDE_OPERATIONAL_HOURS"
      ? "Fetch is blocked until the next operational-hours window."
      : gate.reason === "API_EXTRACTION_DISABLED"
        ? "API extraction is turned off in dashboard settings."
        : gate.reason === "PIPELINE_HARD_KILL"
          ? "The wrangler hard kill is blocking all provider fetches."
          : coord && coord.ok === true && coord.status === "sleeping"
            ? coord.wakeAt
              ? `All enabled providers finished this cycle; sleeping until ${new Date(coord.wakeAt * 1000).toISOString()} UTC (alarm), unless you resume from Operations → “Resume after exhaustion / freeze”.`
              : "All enabled providers finished this cycle; coordinator is sleeping until the next cycle."
            : "No critical incident is currently dominating status.");
  const lines: string[] = [];
  if (coord && coord.ok === true) {
    lines.push(`Coordinator: ${coord.status}`);
    if (coord.cycleId) lines.push(`Cycle: ${coord.cycleId}`);
    if (coord.pendingProviderId && coord.pendingSeq != null) {
      lines.push(`Pending chunk: ${coord.pendingProviderId} / seq ${coord.pendingSeq}`);
    }
    if (coord.wakeAt) {
      lines.push(`Wake at: ${new Date(coord.wakeAt * 1000).toISOString()}`);
    }
    if (coord.orchestrationError?.message) {
      lines.push(`Coordinator error: ${coord.orchestrationError.message}`);
    }
  }
  if (!operational.isOpenNow && operational.nextWindowStartAt) {
    lines.push(`Next operational window: ${new Date(operational.nextWindowStartAt * 1000).toISOString()}`);
  }
  if (gate.nextAllowedAt) {
    lines.push(`Fetch gate opens at: ${new Date(gate.nextAllowedAt * 1000).toISOString()}`);
  }
  const enabledVendors = vendors.filter((v) => v.enabled);
  const blockedVendors = enabledVendors.filter(
    (v) => v.exhaustedForDay || (v.orchestrationDoneForCycle && v.orchestrationPauseKind === "request_cap"),
  );
  if (enabledVendors.length) {
    lines.push(`Enabled vendors: ${enabledVendors.length}`);
  }
  if (blockedVendors.length) {
    lines.push(`Budget-blocked vendors: ${blockedVendors.map((v) => v.label).join(", ")}`);
  }
  return {
    headline,
    driver,
    lines,
    topIncident,
  };
}

/** Safe ASCII slug for Content-Disposition filenames (e.g. CV_AfterShip.docx). */
function slugForDownloadFilename(raw: string | null): string {
  const s = (raw ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return s;
}

function cvDownloadFilename(company: string | null): string {
  const slug = slugForDownloadFilename(company);
  return slug ? `CV_${slug}.docx` : "cv.docx";
}

function coverDownloadFilename(company: string | null): string {
  const slug = slugForDownloadFilename(company);
  return slug ? `Cover_${slug}.docx` : "cover-letter.docx";
}

function filterOutExplanationLines(row: {
  status: string | null;
  hard_reject_reasons: string | null;
  hard_filter_passed?: number | null;
  recommendation: string | null;
  fit_score: number | null;
  scoring_notes: string | null;
}): string[] {
  const st = row.status ?? "";
  if (st === "hard_rejected") {
    const arr = safeJsonStringArray(row.hard_reject_reasons);
    return arr.length > 0 ? arr : ["Hard filter rejected this job (no reason text was stored)."];
  }
  if (st === "rejected_by_ai") {
    const note = (row.scoring_notes ?? "").trim();
    const lines: string[] = [];
    if (note) {
      lines.push(note);
    } else {
      lines.push("Excluded by AI scoring (reject); no summary was stored.");
    }
    if (row.fit_score != null && !Number.isNaN(Number(row.fit_score))) {
      lines.push(`Fit score: ${row.fit_score}.`);
    }
    return lines;
  }
  if (st === "failed" || st === "imported") {
    const note = (row.scoring_notes ?? "").trim();
    if (note) return [note];
    if (row.hard_filter_passed === 1) {
      return ["Hard filters passed, but the pipeline stopped before AI scoring saved a final recommendation."];
    }
    if (row.hard_filter_passed === 0) {
      return ["The pipeline stopped before the hard-filter rejection reason could be saved."];
    }
    return ["The pipeline stopped before this job reached a final dashboard state."];
  }
  return [];
}

export async function handleDashboardApi(
  env: Env,
  request: Request,
  url: URL,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  const path = url.pathname;

  if (path === "/api/auth/login" && request.method === "POST") {
    return handleLogin(env, request);
  }
  if (path === "/api/auth/logout" && request.method === "POST") {
    return handleLogout(request);
  }

  if (!path.startsWith("/api/")) return null;

  const session = await requireDashboardSession(request, env);
  if (session instanceof Response) return session;
  const { userId } = session;

  if (path === "/api/settings" && request.method === "GET") {
    const [
      apiExtractionEnabled,
      verboseLoggingEnabled,
      dashboardShowJobPipelineParams,
      dashboardShowJobApiRaw,
      dashboardAiDebugRescoreEnabled,
      roleTiers,
      vendors,
      countries,
      searchPolicy,
      capsPayload,
      cvCache,
    ] = await Promise.all([
      getApiExtractionEnabled(env.DB, userId),
      getVerboseLoggingEnabled(env.DB),
      getDashboardShowJobPipelineParams(env.DB, userId),
      getDashboardShowJobApiRaw(env.DB, userId),
      getDashboardAiDebugRescoreEnabled(env.DB, userId),
      getSearchRoleTiers(env.DB, userId),
      buildVendorsPayload(env, userId),
      getSearchCountries(env.DB, userId),
      getSearchRuntimePolicy(env.DB, userId),
      buildRequestCapsPayload(env, userId),
      getCvCacheStatus(env.DB, userId),
    ]);
    return json({
      ok: true,
      apiExtractionEnabled,
      verboseLoggingEnabled,
      dashboardShowJobPipelineParams,
      dashboardShowJobApiRaw,
      dashboardAiDebugRescoreEnabled,
      roleTiers,
      searchConfig: {
        countries,
        defaultCountries: [...DEFAULT_SEARCH_COUNTRIES],
        policy: searchPolicy,
      },
      pipelineHardKillActive: isPipelineHardKillActive(env),
      requestCapsPerDay: capsPayload.requestCapsPerDay,
      requestCapsDetail: capsPayload.requestCapsDetail,
      vendors,
      cvCache,
    });
  }

  if (path === "/api/settings/cv-upload" && request.method === "POST") {
    const ct = request.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("multipart/form-data")) {
      return json({ ok: false, error: "expected_multipart" }, 400);
    }
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return json({ ok: false, error: "invalid_form" }, 400);
    }
    const file = formData.get("file");
    if (!file || typeof file !== "object") {
      return json({ ok: false, error: "missing_file" }, 400);
    }
    const f = file as File;
    const name = (f.name || "").toLowerCase();
    if (!name.endsWith(".docx")) {
      return json({ ok: false, error: "docx_only" }, 400);
    }
    const maxBytes = 15 * 1024 * 1024;
    if (typeof f.size === "number" && f.size > maxBytes) {
      return json({ ok: false, error: "file_too_large" }, 413);
    }
    let buf: ArrayBuffer;
    try {
      buf = await f.arrayBuffer();
    } catch {
      return json({ ok: false, error: "read_failed" }, 400);
    }
    let extracted: { text: string; html: string };
    try {
      extracted = await extractCvFromDocxArrayBuffer(buf);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ ok: false, error: "extract_failed", message: msg }, 400);
    }
    if (!extracted.text?.trim() || !extracted.html?.trim()) {
      return json({ ok: false, error: "empty_extract" }, 400);
    }
    const uploadedAtUnix = Math.floor(Date.now() / 1000);
    const sanitizedText = sanitizeCvTextForAiScoring(extracted.text);
    await setCvExtractionCache(env.DB, userId, { ...extracted, uploadedAtUnix, sanitizedText });
    if (env.DOCS_BUCKET) {
      await env.DOCS_BUCKET.put("cv/latest.docx", buf, {
        httpMetadata: { contentType: DOCX_MIME, cacheControl: "private, max-age=0" },
      });
    }
    await log.info(env, "dashboard", "CV uploaded and extraction cached", {
      textLen: extracted.text.length,
      htmlLen: extracted.html.length,
      sanitizedLen: sanitizedText.length,
    });
    const nextCvCache = await getCvCacheStatus(env.DB, userId);
    return json({ ok: true, cvCache: nextCvCache });
  }

  if (path === "/api/settings/cv-sanitized" && request.method === "GET") {
    const compare = url.searchParams.get("compare") === "1";
    const row = await getCvExtractionFromDb(env.DB, userId);
    const cached = row.sanitizedText?.trim() ?? "";
    const hasRaw = Boolean(row.text?.trim() && row.html?.trim());
    let compareSanitizedNow: string | undefined;
    if (compare && row.text?.trim()) {
      compareSanitizedNow = sanitizeCvTextForAiScoring(row.text);
    }
    return json({
      ok: true,
      source: hasRaw ? "database" : "none",
      uploadedAtUnix: row.uploadedAtUnix,
      cachedChars: cached.length,
      hasSanitizedCache: cached.length > 0,
      sanitizedText: cached,
      ...(compareSanitizedNow !== undefined
        ? {
            compareSanitizedNow,
            matchesCached: compareSanitizedNow === cached,
          }
        : {}),
    });
  }

  if (path === "/api/pipeline-status" && request.method === "GET") {
    const st = await getCoordinatorStatus(env, userId);
    if (!st || st.ok !== true) return json(st);
    const gate = await getPipelineFetchAllowed(env, userId);
    const operational = getOperationalHoursState(env);
    return json({
      ...st,
      fetchGateReason: gate.reason,
      fetchGateNextAllowedAt: gate.nextAllowedAt,
      operationalHours: {
        startHourUtc: operational.startHourUtc,
        endHourUtc: operational.endHourUtc,
        isOpenNow: operational.isOpenNow,
      },
    });
  }

  if (path === "/api/pipeline/clear-exhaust-pause" && request.method === "POST") {
    try {
      const r = await clearExhaustPause(env, userId);
      await log.info(env, "dashboard", "Pipeline orchestration pause(s) cleared (manual)", r);
      return json(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await log.moderate(
        env,
        "dashboard",
        "clearExhaustPause failed",
        { error: msg.slice(0, 500) },
        {
          category: "dashboard",
          eventType: "clear_exhaust_pause_failed",
          phase: "pipeline_clear_exhaust",
          statusKind: "degraded",
        },
      );
      return json({ ok: false, error: msg.slice(0, 500) }, 502);
    }
  }

  if (path === "/api/statistics" && request.method === "GET") {
    const payload = await buildStatisticsPayload(env, userId, {
      days: url.searchParams.get("days"),
      top: url.searchParams.get("top"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      date: url.searchParams.get("date"),
      end: url.searchParams.get("end"),
    });
    return json(payload);
  }

  if (path === "/api/search-path-exhaustion" && request.method === "GET") {
    const payload = await buildSearchPathExhaustionPayload(env, userId);
    return json(payload);
  }

  if (path === "/api/operational-dashboard" && request.method === "GET") {
    const nowSec = Math.floor(Date.now() / 1000);
    const ymd = utcYmdFromUnix(nowSec);
    const coord = await getCoordinatorStatus(env, userId);
    const gate = await getPipelineFetchAllowed(env, userId);
    const operational = getOperationalHoursState(env, nowSec);
    const vendors = await buildOperationalVendorStates(env, userId, nowSec, coord);
    return json({
      ok: true,
      utcDate: ymd,
      vendors,
      fetchGateReason: gate.reason,
      fetchGateNextAllowedAt: gate.nextAllowedAt,
      operationalHours: {
        startHourUtc: operational.startHourUtc,
        endHourUtc: operational.endHourUtc,
        isOpenNow: operational.isOpenNow,
        nextWindowStartAt: operational.nextWindowStartAt,
      },
    });
  }

  if (path === "/api/operational-dashboard/refresh-limits" && request.method === "POST") {
    const nowSec = Math.floor(Date.now() / 1000);
    const ymd = utcYmdFromUnix(nowSec);
    const { deletedRows } = await clearAllProviderUtcDayRequestCountsForUtcDate(env.DB, userId, ymd);
    let coordinatorCleared = 0;
    let coordinatorError: string | null = null;
    try {
      const r = await clearRequestCapPauseForProviders(env, userId, { providerIds: [...getRegisteredProviderIds()] });
      coordinatorCleared = r.cleared;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      coordinatorError = msg.slice(0, 500);
      await log.moderate(
        env,
        "dashboard",
        "clearRequestCapPauseForProviders failed after refresh limits",
        { error: coordinatorError, utcDate: ymd },
        {
          category: "dashboard",
          eventType: "clear_request_cap_pause_failed",
          phase: "refresh_daily_limits",
          statusKind: "degraded",
        },
      );
    }
    await log.info(env, "dashboard", "Cleared UTC daily RapidAPI counters (refresh limits)", {
      utcDate: ymd,
      deletedRows,
      coordinatorCleared,
      coordinatorError,
    });
    return json({
      ok: true,
      utcDate: ymd,
      deletedRows,
      coordinatorCleared,
      coordinatorError,
    });
  }

  if (path === "/api/operational-signals" && request.method === "GET") {
    const nowSec = Math.floor(Date.now() / 1000);
    const coord = await getCoordinatorStatus(env, userId);
    const gate = await getPipelineFetchAllowed(env, userId);
    const operational = getOperationalHoursState(env, nowSec);
    const vendors = await buildOperationalVendorStates(env, userId, nowSec, coord);
    const rawIncidentRows = await listOperationalAppLogs(env.DB, userId, 400);
    const incidents = appendDummyLowIncidentIfEnabled(env, groupOperationalIncidents(rawIncidentRows), nowSec);
    const status = buildOperationalStatusSummary({
      coord,
      gate,
      operational,
      vendors,
      incidents,
    });
    return json({
      ok: true,
      generatedAt: nowSec,
      incidents,
      status,
      vendors: vendors.map((vendor) => ({
        id: vendor.id,
        label: vendor.label,
        enabled: vendor.enabled,
        state:
          !vendor.enabled
            ? "Disabled"
            : !vendor.orchestrationDoneForCycle
              ? "In rotation"
              : vendor.orchestrationPauseKind === "request_cap"
                ? "Daily budget reached"
                : vendor.orchestrationPauseKind === "sources_exhausted"
                  ? "Nothing left to fetch"
                  : vendor.orchestrationPauseKind === "schedule_wait"
                    ? "Waiting on schedule"
                    : "Paused",
        nextEligibleAt: vendor.orchestrationNextEligibleAt || null,
        usedUtcDay: vendor.usedUtcDay,
        cap: vendor.cap,
      })),
      fetchGateReason: gate.reason,
      fetchGateNextAllowedAt: gate.nextAllowedAt,
      operationalHours: {
        startHourUtc: operational.startHourUtc,
        endHourUtc: operational.endHourUtc,
        isOpenNow: operational.isOpenNow,
        nextWindowStartAt: operational.nextWindowStartAt,
      },
    });
  }

  if (path === "/api/operational-signals" && request.method === "DELETE") {
    let body: { key?: unknown; severity?: unknown; purgeAll?: unknown } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    if (body.purgeAll === true) {
      const deleted = await deleteOperationalAppLogs(env.DB, userId);
      return json({ ok: true, deleted, purgedAll: true });
    }
    const key = typeof body.key === "string" ? body.key.trim() : "";
    const severity = body.severity;
    if (!key) return json({ ok: false, error: "missing_key" }, 400);
    if (!isIncidentSeverity(severity)) return json({ ok: false, error: "bad_severity" }, 400);
    const deleted = await deleteOperationalIncidentGroup(env.DB, userId, { key, severity });
    return json({ ok: true, deleted, purgedAll: false });
  }

  if (path === "/api/ai-instructions/history" && request.method === "GET") {
    const idRaw = url.searchParams.get("id");
    if (idRaw !== null && idRaw !== "") {
      const id = parseInt(idRaw, 10);
      if (!Number.isFinite(id) || id <= 0) return json({ ok: false, error: "bad_id" }, 400);
      const rev = await getAiInstructionRevisionById(env.DB, userId, id);
      if (!rev) return json({ ok: false, error: "not_found" }, 404);
      return json({
        ok: true,
        revision: {
          id: rev.id,
          createdAt: rev.created_at,
          source: rev.source,
          scoring: rev.scoring,
          drafts: rev.drafts,
          note: rev.note ?? "",
        },
      });
    }
    const limitRaw = url.searchParams.get("limit");
    const limitParsed = limitRaw ? parseInt(limitRaw, 10) : 30;
    const limit = Number.isFinite(limitParsed) ? limitParsed : 30;
    const revisions = await listAiInstructionRevisions(env.DB, userId, limit);
    return json({ ok: true, revisions });
  }

  if (path === "/api/ai-instructions/revert" && request.method === "POST") {
    let body: { revisionId?: number; revisionNote?: string };
    try {
      body = (await request.json()) as { revisionId?: number; revisionNote?: string };
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    const rid = body.revisionId;
    if (typeof rid !== "number" || !Number.isFinite(rid) || rid <= 0) {
      return json({ ok: false, error: "bad_revision_id" }, 400);
    }
    const noteRaw = typeof body.revisionNote === "string" ? body.revisionNote : "";
    const noteErr = validateRevisionNoteForSave(noteRaw);
    if (noteErr) return json({ ok: false, error: noteErr }, 400);
    const now = Math.floor(Date.now() / 1000);
    const out = await revertAiInstructionsToRevision(env.DB, userId, rid, now, noteRaw);
    if (!out) return json({ ok: false, error: "not_found" }, 404);
    await log.info(env, "dashboard", "AI instructions reverted to revision", { revisionId: rid });
    return json({ ok: true, scoring: out.scoring, drafts: out.drafts });
  }

  if (path === "/api/ai-instructions/revision-note" && request.method === "PATCH") {
    let body: { revisionId?: number; note?: string };
    try {
      body = (await request.json()) as { revisionId?: number; note?: string };
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    const rid = body.revisionId;
    if (typeof rid !== "number" || !Number.isFinite(rid) || rid <= 0) {
      return json({ ok: false, error: "bad_revision_id" }, 400);
    }
    const noteRaw = typeof body.note === "string" ? body.note : "";
    const nErr = validateRevisionNoteForSave(noteRaw);
    if (nErr) return json({ ok: false, error: nErr }, 400);
    const updated = await updateAiInstructionRevisionNote(env.DB, userId, rid, noteRaw);
    if (!updated) return json({ ok: false, error: "not_found" }, 404);
    await log.info(env, "dashboard", "AI instruction revision note updated", { revisionId: rid });
    return json({ ok: true, note: noteRaw.trim() });
  }

  if (path === "/api/ai-instructions/revision" && request.method === "DELETE") {
    const idRaw = url.searchParams.get("id");
    const id = idRaw ? parseInt(idRaw, 10) : NaN;
    if (!Number.isFinite(id) || id <= 0) return json({ ok: false, error: "bad_id" }, 400);
    const deleted = await deleteAiInstructionRevision(env.DB, userId, id);
    if (!deleted) return json({ ok: false, error: "not_found" }, 404);
    await log.info(env, "dashboard", "AI instruction revision deleted", { revisionId: id });
    return json({ ok: true });
  }

  if (path === "/api/ai-instructions" && request.method === "GET") {
    const { scoring, drafts } = await getAiInstructionsForEditor(env.DB, userId);
    return json({ ok: true, scoring, drafts });
  }

  if (path === "/api/ai-instructions" && request.method === "PATCH") {
    let body: { scoring?: string; drafts?: string; reset?: boolean; revisionNote?: string };
    try {
      body = (await request.json()) as {
        scoring?: string;
        drafts?: string;
        reset?: boolean;
        revisionNote?: string;
      };
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    const revisionNoteRaw = typeof body.revisionNote === "string" ? body.revisionNote : "";
    const revNoteErr = validateRevisionNoteForSave(revisionNoteRaw);
    if (revNoteErr) return json({ ok: false, error: revNoteErr }, 400);
    if (body.reset === true) {
      const previous = await getAiInstructionsForEditor(env.DB, userId);
      await resetOpenAiInstructionsToDefaults(env.DB, userId);
      await log.info(env, "dashboard", "AI instructions reset to repository defaults");
      const next = await getAiInstructionsForEditor(env.DB, userId);
      const now = Math.floor(Date.now() / 1000);
      if (!aiInstructionSnapshotsEqual(previous, next)) {
        await appendAiInstructionRevision(
          env.DB,
          userId,
          {
            scoring: previous.scoring,
            drafts: previous.drafts,
            source: "reset",
            note: revisionNoteRaw,
          },
          now,
        );
      }
      return json({ ok: true, scoring: next.scoring, drafts: next.drafts });
    }
    const hasScoring = typeof body.scoring === "string";
    const hasDrafts = typeof body.drafts === "string";
    if (!hasScoring && !hasDrafts) {
      return json({ ok: false, error: "bad_body" }, 400);
    }
    const previous = await getAiInstructionsForEditor(env.DB, userId);
    if (hasScoring) {
      const err = validateScoringInstructionForSave(body.scoring!);
      if (err) return json({ ok: false, error: err }, 400);
      await setStoredOpenAiScoringPolicyInstruction(env.DB, userId, body.scoring!);
    }
    if (hasDrafts) {
      const err = validateDraftInstructionForSave(body.drafts!);
      if (err) return json({ ok: false, error: err }, 400);
      await setStoredOpenAiDraftInstruction(env.DB, userId, body.drafts!);
    }
    await log.info(env, "dashboard", "AI instructions saved", {
      scoring: hasScoring,
      drafts: hasDrafts,
    });
    const next = await getAiInstructionsForEditor(env.DB, userId);
    const now = Math.floor(Date.now() / 1000);
    if (!aiInstructionSnapshotsEqual(previous, next)) {
      await appendAiInstructionRevision(
        env.DB,
        userId,
        {
          scoring: previous.scoring,
          drafts: previous.drafts,
          source: "save",
          note: revisionNoteRaw,
        },
        now,
      );
    }
    return json({ ok: true, scoring: next.scoring, drafts: next.drafts });
  }

  if (path === "/api/search-role-revisions/history" && request.method === "GET") {
    const idRaw = url.searchParams.get("id");
    if (idRaw !== null && idRaw !== "") {
      const id = parseInt(idRaw, 10);
      if (!Number.isFinite(id) || id <= 0) return json({ ok: false, error: "bad_id" }, 400);
      const rev = await getSearchRoleRevisionById(env.DB, userId, id);
      if (!rev) return json({ ok: false, error: "not_found" }, 404);
      const tiers = tiersFromRevisionRow(rev);
      return json({
        ok: true,
        revision: {
          id: rev.id,
          createdAt: rev.created_at,
          source: rev.source,
          note: rev.note ?? "",
          tier1: tiers.tier1,
          tier2: tiers.tier2,
        },
      });
    }
    const limitRaw = url.searchParams.get("limit");
    const limitParsed = limitRaw ? parseInt(limitRaw, 10) : 30;
    const limit = Number.isFinite(limitParsed) ? limitParsed : 30;
    const revisions = await listSearchRoleRevisions(env.DB, userId, limit);
    return json({ ok: true, revisions });
  }

  if (path === "/api/search-role-revisions/revert" && request.method === "POST") {
    let body: { revisionId?: number; revisionNote?: string };
    try {
      body = (await request.json()) as { revisionId?: number; revisionNote?: string };
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    const rid = body.revisionId;
    if (typeof rid !== "number" || !Number.isFinite(rid) || rid <= 0) {
      return json({ ok: false, error: "bad_revision_id" }, 400);
    }
    const noteRaw = typeof body.revisionNote === "string" ? body.revisionNote : "";
    const noteErr = validateRevisionNoteForSave(noteRaw);
    if (noteErr) return json({ ok: false, error: noteErr }, 400);
    const now = Math.floor(Date.now() / 1000);
    const out = await revertSearchRolesToRevision(env.DB, userId, rid, now, noteRaw);
    if (!out) return json({ ok: false, error: "not_found" }, 404);
    await log.info(env, "dashboard", "Search role tiers reverted to revision", { revisionId: rid });
    return json({ ok: true, roleTiers: { tier1: out.tier1, tier2: out.tier2 } });
  }

  if (path === "/api/search-role-revisions/revision-note" && request.method === "PATCH") {
    let body: { revisionId?: number; note?: string };
    try {
      body = (await request.json()) as { revisionId?: number; note?: string };
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    const rid = body.revisionId;
    if (typeof rid !== "number" || !Number.isFinite(rid) || rid <= 0) {
      return json({ ok: false, error: "bad_revision_id" }, 400);
    }
    const noteRaw = typeof body.note === "string" ? body.note : "";
    const nErr = validateRevisionNoteForSave(noteRaw);
    if (nErr) return json({ ok: false, error: nErr }, 400);
    const updated = await updateSearchRoleRevisionNote(env.DB, userId, rid, noteRaw);
    if (!updated) return json({ ok: false, error: "not_found" }, 404);
    await log.info(env, "dashboard", "Search role revision note updated", { revisionId: rid });
    return json({ ok: true, note: noteRaw.trim() });
  }

  if (path === "/api/search-role-revisions/revision" && request.method === "DELETE") {
    const idRaw = url.searchParams.get("id");
    const id = idRaw ? parseInt(idRaw, 10) : NaN;
    if (!Number.isFinite(id) || id <= 0) return json({ ok: false, error: "bad_id" }, 400);
    const deleted = await deleteSearchRoleRevision(env.DB, userId, id);
    if (!deleted) return json({ ok: false, error: "not_found" }, 404);
    await log.info(env, "dashboard", "Search role revision deleted", { revisionId: id });
    return json({ ok: true });
  }

  if (path === "/api/settings" && request.method === "PATCH") {
    let body: {
      apiExtractionEnabled?: boolean;
      verboseLoggingEnabled?: boolean;
      dashboardShowJobPipelineParams?: boolean;
      dashboardShowJobApiRaw?: boolean;
      dashboardAiDebugRescoreEnabled?: boolean;
      enabledJobSources?: string[];
      roleTiers?: {
        tier1?: unknown[];
        tier2?: unknown[];
      };
      roleTiersReset?: boolean;
      revisionNote?: string;
      requestCapOverrides?: Record<string, unknown>;
      searchCountries?: unknown[];
    };
    try {
      body = (await request.json()) as {
        apiExtractionEnabled?: boolean;
        verboseLoggingEnabled?: boolean;
        dashboardShowJobPipelineParams?: boolean;
        dashboardShowJobApiRaw?: boolean;
        dashboardAiDebugRescoreEnabled?: boolean;
        enabledJobSources?: string[];
        roleTiers?: {
          tier1?: unknown[];
          tier2?: unknown[];
        };
        roleTiersReset?: boolean;
        revisionNote?: string;
        requestCapOverrides?: Record<string, unknown>;
        searchCountries?: unknown[];
      };
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    const hasApi = typeof body.apiExtractionEnabled === "boolean";
    const hasVerbose = typeof body.verboseLoggingEnabled === "boolean";
    const hasShowPipelineParams = typeof body.dashboardShowJobPipelineParams === "boolean";
    const hasShowApiRaw = typeof body.dashboardShowJobApiRaw === "boolean";
    const hasAiDebugRescore = typeof body.dashboardAiDebugRescoreEnabled === "boolean";
    const hasVendors = Array.isArray(body.enabledJobSources);
    const hasRoleTiersReset = body.roleTiersReset === true;
    const hasRoleTiers =
      !hasRoleTiersReset &&
      !!body.roleTiers &&
      typeof body.roleTiers === "object" &&
      (Array.isArray(body.roleTiers.tier1) || Array.isArray(body.roleTiers.tier2));
    const roleRevisionNoteRaw = typeof body.revisionNote === "string" ? body.revisionNote : "";
    const hasRequestCaps =
      body.requestCapOverrides !== undefined &&
      body.requestCapOverrides !== null &&
      typeof body.requestCapOverrides === "object" &&
      !Array.isArray(body.requestCapOverrides);
    const hasSearchCountries = Array.isArray(body.searchCountries);
    if (
      !hasApi &&
      !hasVerbose &&
      !hasShowPipelineParams &&
      !hasShowApiRaw &&
      !hasAiDebugRescore &&
      !hasVendors &&
      !hasRoleTiers &&
      !hasRoleTiersReset &&
      !hasRequestCaps &&
      !hasSearchCountries
    ) {
      return json({ ok: false, error: "bad_body" }, 400);
    }
    if (hasRoleTiers || hasRoleTiersReset) {
      const rnErr = validateRevisionNoteForSave(roleRevisionNoteRaw);
      if (rnErr) return json({ ok: false, error: rnErr }, 400);
    }
    const apiBefore = await getApiExtractionEnabled(env.DB, userId);
    const verboseBefore = await getVerboseLoggingEnabled(env.DB);

    if (hasApi && body.apiExtractionEnabled !== apiBefore) {
      await setApiExtractionEnabled(env.DB, userId, body.apiExtractionEnabled!);
      await log.info(
        env,
        "dashboard",
        body.apiExtractionEnabled ? "API extraction enabled" : "API extraction disabled",
      );
    }
    if (hasVerbose && body.verboseLoggingEnabled !== verboseBefore) {
      await setVerboseLoggingEnabled(env.DB, body.verboseLoggingEnabled!);
      await log.info(
        env,
        "dashboard",
        body.verboseLoggingEnabled ? "Verbose logging enabled" : "Verbose logging disabled",
      );
    }

    if (hasShowPipelineParams) {
      await setDashboardShowJobPipelineParams(env.DB, userId, body.dashboardShowJobPipelineParams!);
      await log.info(env, "dashboard", "Job list: pipeline request params visibility updated", {
        show: body.dashboardShowJobPipelineParams,
      });
    }
    if (hasShowApiRaw) {
      await setDashboardShowJobApiRaw(env.DB, userId, body.dashboardShowJobApiRaw!);
      await log.info(env, "dashboard", "Job list: API raw fields visibility updated", {
        show: body.dashboardShowJobApiRaw,
      });
    }
    if (hasAiDebugRescore) {
      await setDashboardAiDebugRescoreEnabled(env.DB, userId, body.dashboardAiDebugRescoreEnabled!);
      await log.info(env, "dashboard", "AI debug new-copy button visibility updated", {
        enabled: body.dashboardAiDebugRescoreEnabled,
      });
    }

    if (hasVendors) {
      const valid = new Set(getRegisteredProviderIds());
      const next: JobSourceId[] = [];
      for (const x of body.enabledJobSources!) {
        if (typeof x !== "string") continue;
        const id = x as JobSourceId;
        if (valid.has(id)) {
          next.push(id);
        }
      }
      await setEnabledJobSourceIds(env.DB, userId, next, getRegisteredProviderIds());
      await log.info(env, "dashboard", "Pipeline vendors updated", { enabledJobSources: next });
      if (ctx) {
        ctx.waitUntil(
          (async () => {
            try {
              const r = await startOrResumeCoordinator(env, userId, { reason: "dashboard_vendors" });
              await log.info(env, "dashboard", "Coordinator start requested after vendor list change", r);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              await log.critical(
                env,
                "dashboard",
                "Coordinator start failed (after vendor list change)",
                {
                  error: msg.slice(0, 500),
                },
                {
                  category: "dashboard",
                  eventType: "coordinator_start_failed",
                  phase: "dashboard_vendors",
                  statusKind: "failed",
                },
              );
            }
          })(),
        );
      }
    }

    if (hasRoleTiersReset) {
      const previousRoles = await getSearchRoleTiers(env.DB, userId);
      const defaults = normalizeSearchRoleTiers(DEFAULT_SEARCH_ROLE_TIERS);
      await setSearchRoleTiers(env.DB, userId, defaults);
      await log.info(env, "dashboard", "Search roles reset to codebase defaults", {
        roleCount: defaults.tier1.length,
      });
      const nowRoles = Math.floor(Date.now() / 1000);
      const nextRolesSnap = await getSearchRoleTiers(env.DB, userId);
      if (!searchRoleTiersEqual(previousRoles, nextRolesSnap)) {
        await appendSearchRoleRevision(
          env.DB,
          userId,
          { tiers: previousRoles, source: "reset", note: roleRevisionNoteRaw },
          nowRoles,
        );
      }
      if (ctx) {
        ctx.waitUntil(
          (async () => {
            try {
              const r = await startOrResumeCoordinator(env, userId, { reason: "dashboard_roles" });
              await log.info(env, "dashboard", "Coordinator start requested after role list change", r);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              await log.critical(
                env,
                "dashboard",
                "Coordinator start failed (after role list change)",
                {
                  error: msg.slice(0, 500),
                },
                {
                  category: "dashboard",
                  eventType: "coordinator_start_failed",
                  phase: "dashboard_roles",
                  statusKind: "failed",
                },
              );
            }
          })(),
        );
      }
    } else if (hasRoleTiers) {
      const previousRoles = await getSearchRoleTiers(env.DB, userId);
      const nextRoles = {
        tier1: Array.isArray(body.roleTiers?.tier1) ? body.roleTiers!.tier1.filter((x): x is string => typeof x === "string") : previousRoles.tier1,
        tier2: Array.isArray(body.roleTiers?.tier2) ? body.roleTiers!.tier2.filter((x): x is string => typeof x === "string") : previousRoles.tier2,
      };
      await setSearchRoleTiers(env.DB, userId, nextRoles);
      const snapSave = await getSearchRoleTiers(env.DB, userId);
      await log.info(env, "dashboard", "Search roles updated", {
        roleCount: snapSave.tier1.length,
      });
      const nowSave = Math.floor(Date.now() / 1000);
      if (!searchRoleTiersEqual(previousRoles, snapSave)) {
        await appendSearchRoleRevision(
          env.DB,
          userId,
          { tiers: previousRoles, source: "save", note: roleRevisionNoteRaw },
          nowSave,
        );
      }
      if (ctx) {
        ctx.waitUntil(
          (async () => {
            try {
              const r = await startOrResumeCoordinator(env, userId, { reason: "dashboard_roles" });
              await log.info(env, "dashboard", "Coordinator start requested after role list change", r);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              await log.critical(
                env,
                "dashboard",
                "Coordinator start failed (after role list change)",
                {
                  error: msg.slice(0, 500),
                },
                {
                  category: "dashboard",
                  eventType: "coordinator_start_failed",
                  phase: "dashboard_roles",
                  statusKind: "failed",
                },
              );
            }
          })(),
        );
      }
    }

    if (hasRequestCaps) {
      const valid = new Set(getRegisteredProviderIds());
      const raw = body.requestCapOverrides!;
      const patch: Partial<Record<JobSourceId, number | null>> = {};
      for (const key of Object.keys(raw)) {
        if (!valid.has(key as JobSourceId)) {
          return json({ ok: false, error: "bad_request_cap_key" }, 400);
        }
      }
      for (const id of valid) {
        if (!Object.prototype.hasOwnProperty.call(raw, id)) continue;
        const v = raw[id as string];
        if (v === null) {
          patch[id] = null;
        } else if (typeof v === "number" && Number.isFinite(v)) {
          const n = Math.floor(v as number);
          if (n < 0 || n > MAX_REQUEST_CAP_PER_DAY) {
            return json({ ok: false, error: "bad_request_cap" }, 400);
          }
          patch[id] = n;
        } else {
          return json({ ok: false, error: "bad_request_cap" }, 400);
        }
      }
      const patchedIds = Object.keys(patch) as JobSourceId[];
      const effectiveCapsBefore: Partial<Record<JobSourceId, number>> = {};
      for (const id of patchedIds) {
        effectiveCapsBefore[id] = await getResolvedProviderDailyRequestCap(env.DB, env, userId, id);
      }
      await patchProviderRequestCapOverrides(env.DB, userId, patch);
      const capRaisedIds: JobSourceId[] = [];
      for (const id of patchedIds) {
        const before = effectiveCapsBefore[id] ?? 0;
        const after = await getResolvedProviderDailyRequestCap(env.DB, env, userId, id);
        const raised = after > before || (before > 0 && after === 0);
        if (raised) capRaisedIds.push(id);
      }
      await log.info(env, "dashboard", "Provider request caps updated", {
        patchedIds,
        capRaisedIds,
      });
      if (capRaisedIds.length && ctx) {
        ctx.waitUntil(
          (async () => {
            try {
              const r = await clearRequestCapPauseForProviders(env, userId, { providerIds: capRaisedIds });
              await log.info(env, "dashboard", "Coordinator cleared request-cap pause after cap raise", {
                cleared: r.cleared,
                status: r.status,
              });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              await log.moderate(
                env,
                "dashboard",
                "clearRequestCapPauseForProviders failed",
                {
                  error: msg.slice(0, 500),
                  providerIds: capRaisedIds,
                },
                {
                  category: "dashboard",
                  eventType: "clear_request_cap_pause_failed",
                  phase: "request_cap_overrides",
                  statusKind: "degraded",
                },
              );
            }
          })(),
        );
      }
    }

    if (hasSearchCountries) {
      const raw = body.searchCountries!;
      const items: { iso2: string; fullName: string }[] = [];
      for (const x of raw) {
        if (!x || typeof x !== "object") continue;
        const o = x as Record<string, unknown>;
        const iso2Raw = typeof o.iso2 === "string" ? o.iso2.trim().toLowerCase() : "";
        const fullName = typeof o.fullName === "string" ? o.fullName.trim() : "";
        if (!iso2Raw || !fullName) continue;
        if (!/^[a-z]{2}$/.test(iso2Raw)) {
          return json({ ok: false, error: "bad_country_iso2" }, 400);
        }
        if (fullName.length > 160) {
          return json({ ok: false, error: "bad_country_name" }, 400);
        }
        items.push({ iso2: iso2Raw, fullName });
      }
      const normalized = normalizeSearchCountries(items);
      await setSearchCountries(env.DB, userId, normalized);
      await log.info(env, "dashboard", "Search countries updated", { count: normalized.length });
    }

    const apiTurnedOn = hasApi && body.apiExtractionEnabled === true && !apiBefore;
    if (apiTurnedOn && (await getVerboseLoggingEnabled(env.DB))) {
      const now = Math.floor(Date.now() / 1000);
      const freezeUntil = await getLinkedinFreezeUntil(env.DB, userId);
      const asleep = freezeUntil > now;
      const freezeIso = freezeUntil > 0 ? new Date(freezeUntil * 1000).toISOString() : null;
      await log.verbose(
        env,
        "dashboard",
        asleep
          ? "LinkedIn active-jb slice already exhausted for this window (API returned no more pages); 24h freeze active — pipeline will skip LinkedIn fetches until it lifts."
          : "LinkedIn 24h freeze is not active — next pipeline run will call the LinkedIn jobs API as usual (subject to keys and rotation).",
        {
          linkedinAsleep: asleep,
          freezeUntil,
          freezeUntilIso: freezeIso,
          secondsRemaining: asleep ? freezeUntil - now : 0,
        },
      );
    }

    if (apiTurnedOn && ctx) {
      ctx.waitUntil(
        (async () => {
          try {
            const r = await startOrResumeCoordinator(env, userId, { reason: "dashboard_enable" });
            await log.info(env, "dashboard", "Coordinator start requested after API extraction enabled", r);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await log.critical(
              env,
              "dashboard",
              "Coordinator start failed (after API extraction enabled)",
              {
                error: msg.slice(0, 500),
              },
              {
                category: "dashboard",
                eventType: "coordinator_start_failed",
                phase: "dashboard_enable",
                statusKind: "failed",
              },
            );
          }
        })(),
      );
    }

    const capsPayload = await buildRequestCapsPayload(env, userId);
    return json({
      ok: true,
      apiExtractionEnabled: await getApiExtractionEnabled(env.DB, userId),
      verboseLoggingEnabled: await getVerboseLoggingEnabled(env.DB),
      dashboardShowJobPipelineParams: await getDashboardShowJobPipelineParams(env.DB, userId),
      dashboardShowJobApiRaw: await getDashboardShowJobApiRaw(env.DB, userId),
      dashboardAiDebugRescoreEnabled: await getDashboardAiDebugRescoreEnabled(env.DB, userId),
      roleTiers: await getSearchRoleTiers(env.DB, userId),
      searchConfig: {
        countries: await getSearchCountries(env.DB, userId),
        defaultCountries: [...DEFAULT_SEARCH_COUNTRIES],
        policy: await getSearchRuntimePolicy(env.DB, userId),
      },
      pipelineHardKillActive: isPipelineHardKillActive(env),
      requestCapsPerDay: capsPayload.requestCapsPerDay,
      requestCapsDetail: capsPayload.requestCapsDetail,
      vendors: await buildVendorsPayload(env, userId),
    });
  }

  if (path === "/api/logs" && request.method === "GET") {
    const raw = url.searchParams.get("limit");
    const n = raw ? parseInt(raw, 10) : 200;
    const limit = Number.isFinite(n) ? n : 200;
    const logs = await listAppLogs(env.DB, userId, limit);
    return json({ ok: true, logs });
  }

  if (path === "/api/logs" && request.method === "DELETE") {
    const deleted = await deleteAllAppLogs(env.DB, userId);
    return json({ ok: true, deleted });
  }

  if (path === "/api/jobs" && request.method === "GET") {
    const tab = url.searchParams.get("tab") || "active";
    if (!TAB_RE.test(tab)) return json({ ok: false, error: "bad_tab" }, 400);
    return buildDashboardJobListResponse(env, userId, {
      tab: tab as DashboardJobListTab,
      cursor: null,
      limit: clampDashboardJobListLimit(url.searchParams.get("limit")),
      prefs: defaultDashboardJobListPrefs(),
    });
  }

  if (path === "/api/jobs/query" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const tabRaw = body && typeof body === "object" ? (body as Record<string, unknown>).tab : null;
    if (typeof tabRaw !== "string" || !TAB_RE.test(tabRaw)) {
      return json({ ok: false, error: "bad_tab" }, 400);
    }
    const bodyObj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const hasCursor = Object.prototype.hasOwnProperty.call(bodyObj, "cursor");
    const cursor = normalizeDashboardJobListCursor(bodyObj.cursor);
    if (hasCursor && bodyObj.cursor != null && cursor == null) {
      return json({ ok: false, error: "bad_cursor" }, 400);
    }
    scheduleSalaryCacheBackfillNudge(env, ctx);
    return buildDashboardJobListResponse(
      env,
      userId,
      {
        tab: tabRaw as DashboardJobListTab,
        cursor,
        limit: clampDashboardJobListLimit(bodyObj.limit),
        prefs: normalizeDashboardJobListPrefs(bodyObj.prefs),
      },
      ctx,
    );
  }

  if (path === "/api/jobs/query-ids" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const tabRaw = body && typeof body === "object" ? (body as Record<string, unknown>).tab : null;
    if (typeof tabRaw !== "string" || !TAB_RE.test(tabRaw)) {
      return json({ ok: false, error: "bad_tab" }, 400);
    }
    const bodyObj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const ids = await queryDashboardJobListIds(
      env.DB,
      userId,
      tabRaw as DashboardJobListTab,
      normalizeDashboardJobListPrefs(bodyObj.prefs),
    );
    return json({ ok: true, tab: tabRaw, ids, totalMatching: ids.length });
  }

  const favMatch = path.match(/^\/api\/jobs\/([^/]+)\/favorite$/);
  if (favMatch && request.method === "POST") {
    return handleFavorite(env, userId, favMatch[1]!, request);
  }

  if (path === "/api/jobs/bulk-deny" && request.method === "POST") {
    return handleBulkDeny(env, userId, request);
  }

  if (path === "/api/jobs/bulk-accept" && request.method === "POST") {
    return handleBulkAccept(env, userId, request);
  }

  if (path === "/api/jobs/bulk-restore" && request.method === "POST") {
    return handleBulkRestore(env, userId, request);
  }

  if (path === "/api/jobs/bulk-delete" && request.method === "POST") {
    return handleBulkDelete(env, userId, request);
  }

  const debugRescoreMatch = path.match(/^\/api\/jobs\/([^/]+)\/debug-ai-rescore$/);
  if (debugRescoreMatch && request.method === "POST") {
    return handleDebugAiRescore(env, userId, debugRescoreMatch[1]!);
  }

  const retryFailedMatch = path.match(/^\/api\/jobs\/([^/]+)\/retry-scoring$/);
  if (retryFailedMatch && request.method === "POST") {
    return handleRetryFailedJob(env, userId, retryFailedMatch[1]!);
  }

  const genMatch = path.match(/^\/api\/jobs\/([^/]+)\/generate$/);
  if (genMatch && request.method === "POST") {
    const id = genMatch[1]!;
    return handleGenerate(env, userId, id);
  }

  const accMatch = path.match(/^\/api\/jobs\/([^/]+)\/accept$/);
  if (accMatch && request.method === "POST") {
    return handleDecision(env, userId, accMatch[1]!, "accepted");
  }

  const denyMatch = path.match(/^\/api\/jobs\/([^/]+)\/deny$/);
  if (denyMatch && request.method === "POST") {
    return handleDecision(env, userId, denyMatch[1]!, "denied");
  }

  const restoreMatch = path.match(/^\/api\/jobs\/([^/]+)\/restore$/);
  if (restoreMatch && request.method === "POST") {
    return handleRestoreToActive(env, userId, restoreMatch[1]!);
  }

  const dlCv = path.match(/^\/api\/jobs\/([^/]+)\/download\/cv$/);
  if (dlCv && request.method === "GET") {
    return handleDownload(env, userId, dlCv[1]!, "cv");
  }

  const dlCover = path.match(/^\/api\/jobs\/([^/]+)\/download\/cover$/);
  if (dlCover && request.method === "GET") {
    return handleDownload(env, userId, dlCover[1]!, "cover");
  }

  // ── /api/me ─────────────────────────────────────────────────────────────
  if (path === "/api/me" && request.method === "GET") {
    const user = await getUserById(env.DB, userId);
    if (!user) return json({ ok: false, error: "user_not_found" }, 404);
    return json({ ok: true, userId: user.id, username: user.username, role: user.role });
  }

  // ── Admin routes (require role=admin) ────────────────────────────────────
  if (path.startsWith("/api/admin/")) {
    if (session.role !== "admin") return json({ ok: false, error: "forbidden" }, 403);
    return handleAdminApi(env, request, path);
  }

  return null;
}

async function handleDebugAiRescore(env: Env, userId: string, id: string): Promise<Response> {
  if (!(await getDashboardAiDebugRescoreEnabled(env.DB, userId))) {
    return json({ ok: false, error: "feature_disabled", code: "feature_disabled" }, 403);
  }
  const r = await rescoreJobBypassingHardFilters(env, userId, id);
  if (!r.ok) {
    const status =
      r.code === "not_found"
        ? 404
        : r.code === "openai_not_configured"
          ? 503
          : r.code === "openai_failed"
            ? 502
            : 502;
    return json({ ok: false, error: r.error, code: r.code }, status);
  }
  return json({
    ok: true,
    newJobId: r.newJobId,
    parentJobId: r.parentJobId,
    fit_score: r.scoring.fit_score,
    recommendation: r.scoring.recommendation,
    position_summary: r.scoring.position_summary,
    positives: r.scoring.positives,
    negatives: r.scoring.negatives,
    ...(r.pipelineWarnings?.length ? { pipelineWarnings: r.pipelineWarnings } : {}),
  });
}

async function handleRetryFailedJob(env: Env, userId: string, id: string): Promise<Response> {
  const result = await retryFailedJobProcessing(env, userId, id);
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : 400;
    return json({ ok: false, error: result.error, code: result.code }, status);
  }
  invalidateDashboardListMemoCaches();
  return json({
    ok: true,
    jobId: result.jobId,
    status: result.status,
    dashBucket: result.dashBucket,
    fit_score: result.fitScore,
    recommendation: result.recommendation,
    retryOutcome: result.retryOutcome,
    ...(result.pipelineWarnings?.length ? { pipelineWarnings: result.pipelineWarnings } : {}),
  });
}

async function handleLogin(env: Env, request: Request): Promise<Response> {
  const secret = env.REVIEW_TOKEN_SECRET;
  if (!secret) return json({ ok: false, error: "not_configured" }, 503);

  let body: { username?: string; password?: string };
  try {
    body = (await request.json()) as { username?: string; password?: string };
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";

  const claims = await authenticateUser(env.DB, env, username, password);
  if (!claims) {
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }

  const setCookie = await createSessionCookie(
    secret,
    claims.userId,
    claims.role,
    request.url.startsWith("https:"),
  );
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Set-Cookie": setCookie,
    },
  });
}

async function handleLogout(request: Request): Promise<Response> {
  const secure = request.url.startsWith("https:");
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Set-Cookie": clearSessionCookie(secure),
    },
  });
}

async function handleGenerate(env: Env, userId: string, id: string): Promise<Response> {
  if (!env.DOCS_BUCKET) return json({ ok: false, error: "r2_not_configured" }, 503);
  if (!env.OPENAI_API_KEY) return json({ ok: false, error: "openai_not_configured" }, 503);

  const job = await loadNormalizedJob(env.DB, userId, id);
  const scoring = await loadScoringResult(env.DB, userId, id);
  if (!job || !scoring) return json({ ok: false, error: "not_found" }, 404);

  let drafts;
  try {
    drafts = await generateTailoredDrafts(env.DB, env, userId, job, scoring);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log.moderate(
      env,
      "dashboard",
      "Generate drafts failed",
      { id, err: msg },
      {
        category: "ai_drafts",
        eventType: "generate_drafts_failed",
        providerId: job.source,
        jobId: id,
        phase: "handleGenerate",
        statusKind: "degraded",
      },
    );
    return json({ ok: false, error: msg }, 500);
  }
  if (!drafts) {
    await log.moderate(
      env,
      "dashboard",
      "Generate drafts returned no output",
      { id },
      {
        category: "ai_drafts",
        eventType: "generate_drafts_empty",
        providerId: job.source,
        jobId: id,
        phase: "handleGenerate",
        statusKind: "degraded",
      },
    );
    return json({ ok: false, error: "draft_failed" }, 500);
  }

  const now = Math.floor(Date.now() / 1000);
  const cvKey = `jobs/${id}/cv.docx`;
  const coverKey = `jobs/${id}/cover.docx`;

  try {
    const cvBuf = drafts.cvHtml.trim()
      ? await htmlToDocxArrayBuffer(drafts.cvHtml, drafts.referenceCvHtml)
      : await textToDocxArrayBuffer(drafts.cvDraft);
    const coverBuf = await textToDocxArrayBuffer(drafts.coverLetter);
    await env.DOCS_BUCKET.put(cvKey, cvBuf, {
      httpMetadata: { contentType: DOCX_MIME, cacheControl: "private, max-age=3600" },
    });
    await env.DOCS_BUCKET.put(coverKey, coverBuf, {
      httpMetadata: { contentType: DOCX_MIME, cacheControl: "private, max-age=3600" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log.moderate(
      env,
      "dashboard",
      "Persist generated documents failed",
      { id, err: msg },
      {
        category: "storage",
        eventType: "generated_docs_persist_failed",
        providerId: job.source,
        jobId: id,
        phase: "handleGenerate",
        statusKind: "degraded",
      },
    );
    return json(
      { ok: false, error: msg },
      500,
    );
  }

  try {
    await saveGeneratedDrafts(env.DB, userId, id, drafts, cvKey, coverKey, now);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log.moderate(
      env,
      "dashboard",
      "Persist generated draft metadata failed",
      { id, err: msg, cvKey, coverKey },
      {
        category: "storage",
        eventType: "generated_draft_metadata_save_failed",
        providerId: job.source,
        jobId: id,
        phase: "handleGenerate",
        statusKind: "degraded",
      },
    );
    return json({ ok: false, error: msg }, 500);
  }
  return json({
    ok: true,
    downloadCv: `/api/jobs/${id}/download/cv`,
    downloadCover: `/api/jobs/${id}/download/cover`,
  });
}

async function handleFavorite(env: Env, userId: string, id: string, request: Request): Promise<Response> {
  let body: { favorite?: unknown };
  try {
    body = (await request.json()) as { favorite?: unknown };
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const favorite = body.favorite === true;
  const now = Math.floor(Date.now() / 1000);
  const result = await setJobFavorite(env.DB, userId, id, favorite, now);
  if (!result.ok) {
    const code = result.error === "not_found" ? 404 : 400;
    return json({ ok: false, error: result.error }, code);
  }
  invalidateDashboardListMemoCaches();
  return json({ ok: true });
}

function parseIdListBody(requestBody: unknown): string[] {
  const raw = (requestBody as { ids?: unknown })?.ids;
  return Array.isArray(raw)
    ? [...new Set(raw.filter((x): x is string => typeof x === "string" && x.length > 0))]
    : [];
}

type DashboardBulkSelection =
  | { mode: "explicit_ids"; ids: string[] }
  | {
      mode: "all_matching";
      tab: DashboardJobListTab;
      prefs: DashboardJobListPrefs;
      loadedIds: string[];
    };

function parseLoadedIdListBody(requestBody: unknown): string[] {
  const raw = (requestBody as { loadedIds?: unknown })?.loadedIds;
  return Array.isArray(raw)
    ? [...new Set(raw.filter((x): x is string => typeof x === "string" && x.length > 0))]
    : [];
}

function parseBulkSelectionBody(requestBody: unknown): DashboardBulkSelection | null {
  const body = (requestBody && typeof requestBody === "object" ? requestBody : {}) as Record<string, unknown>;
  if (body.selectAllMatching === true) {
    const tabRaw = body.tab;
    if (typeof tabRaw !== "string" || !TAB_RE.test(tabRaw)) return null;
    return {
      mode: "all_matching",
      tab: tabRaw as DashboardJobListTab,
      prefs: normalizeDashboardJobListPrefs(body.prefs),
      loadedIds: parseLoadedIdListBody(body),
    };
  }
  return { mode: "explicit_ids", ids: parseIdListBody(body) };
}

function intersectIdsPreservingOrder(candidateIds: string[], allowedIds: string[]): string[] {
  if (candidateIds.length === 0 || allowedIds.length === 0) return [];
  const allowed = new Set(allowedIds);
  return candidateIds.filter((id) => allowed.has(id));
}

async function resolveBulkSelectionIds(
  db: D1Database,
  userId: string,
  selection: DashboardBulkSelection,
): Promise<{ ids: string[]; affectedLoadedIds: string[] }> {
  if (selection.mode === "all_matching") {
    const ids = await queryDashboardJobListIds(db, userId, selection.tab, selection.prefs);
    return {
      ids,
      affectedLoadedIds: intersectIdsPreservingOrder(selection.loadedIds, ids),
    };
  }
  return { ids: selection.ids, affectedLoadedIds: selection.ids.slice() };
}

async function handleBulkDeny(env: Env, userId: string, request: Request): Promise<Response> {
  let body: { ids?: unknown };
  try {
    body = (await request.json()) as { ids?: unknown };
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const selection = parseBulkSelectionBody(body);
  if (!selection) return json({ ok: false, error: "bad_selection" }, 400);
  const resolved = await resolveBulkSelectionIds(env.DB, userId, selection);
  if (resolved.ids.length === 0) return json({ ok: true, updated: 0, affectedLoadedIds: [] });
  const now = Math.floor(Date.now() / 1000);
  const updatedIds = await bulkDenyActiveJobs(env.DB, userId, resolved.ids, now);
  if (updatedIds.length > 0) invalidateDashboardListMemoCaches();
  return json({
    ok: true,
    updated: updatedIds.length,
    affectedLoadedIds: intersectIdsPreservingOrder(resolved.affectedLoadedIds, updatedIds),
  });
}

async function handleBulkAccept(env: Env, userId: string, request: Request): Promise<Response> {
  let body: { ids?: unknown };
  try {
    body = (await request.json()) as { ids?: unknown };
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const selection = parseBulkSelectionBody(body);
  if (!selection) return json({ ok: false, error: "bad_selection" }, 400);
  const resolved = await resolveBulkSelectionIds(env.DB, userId, selection);
  if (resolved.ids.length === 0) return json({ ok: true, updated: 0, affectedLoadedIds: [] });
  const now = Math.floor(Date.now() / 1000);
  const updatedIds = await bulkAcceptActiveJobs(env.DB, userId, resolved.ids, now);
  if (updatedIds.length > 0) invalidateDashboardListMemoCaches();
  return json({
    ok: true,
    updated: updatedIds.length,
    affectedLoadedIds: intersectIdsPreservingOrder(resolved.affectedLoadedIds, updatedIds),
  });
}

async function handleBulkRestore(env: Env, userId: string, request: Request): Promise<Response> {
  let body: { ids?: unknown };
  try {
    body = (await request.json()) as { ids?: unknown };
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const selection = parseBulkSelectionBody(body);
  if (!selection) return json({ ok: false, error: "bad_selection" }, 400);
  const resolved = await resolveBulkSelectionIds(env.DB, userId, selection);
  if (resolved.ids.length === 0) return json({ ok: true, updated: 0, affectedLoadedIds: [] });
  const now = Math.floor(Date.now() / 1000);
  const updatedIds = await bulkRestoreJobs(env.DB, userId, resolved.ids, now);
  if (updatedIds.length > 0) invalidateDashboardListMemoCaches();
  return json({
    ok: true,
    updated: updatedIds.length,
    affectedLoadedIds: intersectIdsPreservingOrder(resolved.affectedLoadedIds, updatedIds),
  });
}

async function handleBulkDelete(env: Env, userId: string, request: Request): Promise<Response> {
  let body: { ids?: unknown };
  try {
    body = (await request.json()) as { ids?: unknown };
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const selection = parseBulkSelectionBody(body);
  if (!selection) return json({ ok: false, error: "bad_selection" }, 400);
  const resolved = await resolveBulkSelectionIds(env.DB, userId, selection);
  if (resolved.ids.length === 0) return json({ ok: true, deleted: 0, affectedLoadedIds: [], r2Deleted: 0 });
  const { deletedIds, r2Deleted } = await deleteJobsByIdsWithR2Cleanup(env.DB, env.DOCS_BUCKET, resolved.ids, userId);
  if (deletedIds.length > 0) invalidateDashboardListMemoCaches();
  return json({
    ok: true,
    deleted: deletedIds.length,
    affectedLoadedIds: intersectIdsPreservingOrder(resolved.affectedLoadedIds, deletedIds),
    r2Deleted,
  });
}

async function handleDecision(
  env: Env,
  userId: string,
  id: string,
  decision: "accepted" | "denied",
): Promise<Response> {
  const row = await getJob(env.DB, userId, id);
  if (!row) return json({ ok: false, error: "not_found" }, 404);
  if (row.dash_bucket !== "active") {
    return json({ ok: false, error: "not_active_tab" }, 400);
  }
  const now = Math.floor(Date.now() / 1000);
  await setDashboardDecision(env.DB, userId, id, decision, now);
  invalidateDashboardListMemoCaches();
  return json({ ok: true });
}

async function handleRestoreToActive(env: Env, userId: string, id: string): Promise<Response> {
  const row = await getJob(env.DB, userId, id);
  if (!row) return json({ ok: false, error: "not_found" }, 404);
  const now = Math.floor(Date.now() / 1000);
  if (row.dash_bucket === "accepted" || row.dash_bucket === "denied") {
    const ok = await restoreDashboardJobToActive(env.DB, userId, id, now);
    if (!ok) return json({ ok: false, error: "not_applied_or_rejected" }, 400);
    invalidateDashboardListMemoCaches();
    return json({ ok: true });
  }
  if (row.dash_bucket === "filtered") {
    const ok = await restoreFilteredJobToActive(env.DB, userId, id, now);
    if (!ok) return json({ ok: false, error: "not_filtered" }, 400);
    invalidateDashboardListMemoCaches();
    return json({ ok: true });
  }
  return json({ ok: false, error: "not_restorable" }, 400);
}

async function handleDownload(
  env: Env,
  userId: string,
  id: string,
  kind: "cv" | "cover",
): Promise<Response> {
  if (!env.DOCS_BUCKET) return json({ ok: false, error: "r2_not_configured" }, 503);
  const keys = await getJobR2Keys(env.DB, userId, id);
  if (!keys) return json({ ok: false, error: "not_found" }, 404);
  const key = kind === "cv" ? keys.r2_cv_key : keys.r2_cover_key;
  if (!key) return json({ ok: false, error: "not_generated" }, 404);

  const obj = await env.DOCS_BUCKET.get(key);
  if (!obj) return json({ ok: false, error: "missing_object" }, 404);

  const company = await getJobCompany(env.DB, userId, id);
  const filename =
    kind === "cv" ? cvDownloadFilename(company) : coverDownloadFilename(company);
  const headers = new Headers();
  headers.set("content-type", DOCX_MIME);
  headers.set("content-disposition", `attachment; filename="${filename}"`);
  if (obj.size != null) headers.set("content-length", String(obj.size));

  return new Response(obj.body, { status: 200, headers });
}

// ══ ADMIN API ══════════════════════════════════════════════════════════════════

async function handleAdminApi(env: Env, request: Request, path: string): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);

  // ── Users list ────────────────────────────────────────────────────────────
  if (path === "/api/admin/users" && request.method === "GET") {
    const users = await listUsers(env.DB);
    const withCaps = await Promise.all(
      users.map(async (u) => ({
        ...u,
        caps: await getUserProviderCaps(env.DB, u.id),
      })),
    );
    return json({ ok: true, users: withCaps });
  }

  // ── Create user ───────────────────────────────────────────────────────────
  if (path === "/api/admin/users" && request.method === "POST") {
    let body: { username?: string; password?: string; role?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    if (typeof body.username !== "string" || !body.username.trim()) {
      return json({ ok: false, error: "username_required" }, 400);
    }
    if (typeof body.password !== "string" || body.password.length < 8) {
      return json({ ok: false, error: "password_too_short" }, 400);
    }
    let username: string;
    try {
      username = normalizeUsername(body.username);
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : "invalid_username" }, 400);
    }
    const role = body.role === "admin" ? "admin" : "user";
    try {
      const { id } = await createUser(env.DB, { username, password: body.password, role, now });
      return json({ ok: true, id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE") || msg.includes("unique")) {
        return json({ ok: false, error: "username_taken" }, 409);
      }
      return json({ ok: false, error: msg }, 500);
    }
  }

  // ── Per-user routes ───────────────────────────────────────────────────────
  const userMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (userMatch) {
    const targetId = userMatch[1]!;

    if (request.method === "PATCH") {
      let body: { password?: string; role?: string; status?: string };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ ok: false, error: "invalid_json" }, 400);
      }
      if (typeof body.password === "string") {
        if (body.password.length < 8) return json({ ok: false, error: "password_too_short" }, 400);
        await updatePassword(env.DB, targetId, body.password, now);
      }
      if (body.role === "admin" || body.role === "user") {
        await setUserRole(env.DB, targetId, body.role, now);
      }
      if (body.status === "active" || body.status === "disabled") {
        await setUserStatus(env.DB, targetId, body.status, now);
      }
      return json({ ok: true });
    }

    if (request.method === "DELETE") {
      await setUserStatus(env.DB, targetId, "disabled", now);
      return json({ ok: true });
    }
  }

  // ── User caps ─────────────────────────────────────────────────────────────
  const capsMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/caps$/);
  if (capsMatch) {
    const targetId = capsMatch[1]!;

    if (request.method === "GET") {
      const caps = await getUserProviderCaps(env.DB, targetId);
      return json({ ok: true, caps });
    }

    if (request.method === "PATCH") {
      let body: { caps?: unknown };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ ok: false, error: "invalid_json" }, 400);
      }
      if (!body.caps || typeof body.caps !== "object" || Array.isArray(body.caps)) {
        return json({ ok: false, error: "invalid_caps" }, 400);
      }
      const capsIn = body.caps as Record<string, unknown>;
      const capsOut: Partial<Record<string, number>> = {};
      for (const [k, v] of Object.entries(capsIn)) {
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
          capsOut[k] = Math.floor(v);
        }
      }
      await setUserProviderCaps(env.DB, targetId, capsOut, now);
      return json({ ok: true });
    }
  }

  // ── Global scoring contract ───────────────────────────────────────────────
  if (path === "/api/admin/scoring-contract") {
    if (request.method === "GET") {
      const contract = await getGlobalScoringContract(env.DB);
      const defaultContract = Array.isArray(OPENAI_SCORING_CONTRACT_INSTRUCTION)
        ? OPENAI_SCORING_CONTRACT_INSTRUCTION.join("\n")
        : String(OPENAI_SCORING_CONTRACT_INSTRUCTION);
      return json({ ok: true, contract: contract ?? defaultContract, isDefault: !contract });
    }
    if (request.method === "PUT") {
      let body: { contract?: string; reset?: boolean };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ ok: false, error: "invalid_json" }, 400);
      }
      if (body.reset) {
        const defaultContract = Array.isArray(OPENAI_SCORING_CONTRACT_INSTRUCTION)
          ? OPENAI_SCORING_CONTRACT_INSTRUCTION.join("\n")
          : String(OPENAI_SCORING_CONTRACT_INSTRUCTION);
        await setGlobalScoringContract(env.DB, defaultContract);
        return json({ ok: true, reset: true });
      }
      if (typeof body.contract !== "string" || !body.contract.trim()) {
        return json({ ok: false, error: "contract_required" }, 400);
      }
      await setGlobalScoringContract(env.DB, body.contract.trim());
      return json({ ok: true });
    }
  }

  // ── New-user template ─────────────────────────────────────────────────────
  if (path === "/api/admin/new-user-template") {
    if (request.method === "GET") {
      const template = await getGlobalNewUserTemplate(env.DB);
      return json({ ok: true, template: template ?? {}, keys: [...USER_SETTINGS_TEMPLATE_KEYS] });
    }
    if (request.method === "PUT") {
      let body: { template?: unknown };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ ok: false, error: "invalid_json" }, 400);
      }
      if (!body.template || typeof body.template !== "object" || Array.isArray(body.template)) {
        return json({ ok: false, error: "invalid_template" }, 400);
      }
      const t = body.template as Record<string, unknown>;
      const filtered: Record<string, string> = {};
      for (const key of USER_SETTINGS_TEMPLATE_KEYS) {
        if (typeof t[key] === "string") filtered[key] = t[key] as string;
      }
      await setGlobalNewUserTemplate(env.DB, filtered);
      return json({ ok: true });
    }
  }

  // ── Sync template from admin ──────────────────────────────────────────────
  if (path === "/api/admin/new-user-template/sync-from-admin" && request.method === "POST") {
    await syncNewUserTemplateFromAdmin(env.DB, now);
    return json({ ok: true });
  }

  // ── Admin pipeline status for a specific user ─────────────────────────────
  if (path === "/api/admin/pipeline-status" && request.method === "GET") {
    const targetUserId = new URL(request.url).searchParams.get("userId");
    if (!targetUserId) return json({ ok: false, error: "userId_required" }, 400);
    const status = await getCoordinatorStatus(env, targetUserId);
    return json(status);
  }

  return json({ ok: false, error: "not_found" }, 404);
}

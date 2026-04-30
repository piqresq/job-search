 import {
  DEFAULT_SEARCH_COUNTRIES,
  type SearchCountry,
  normalizeSearchCountries,
} from "../config/searchCountries";
import {
  DEFAULT_SEARCH_ROLE_TIERS,
  buildSearchRoleQueryCache,
  normalizeSearchRoleTiers,
  type SearchRoleQueryCache,
  type SearchRoleTiers,
} from "../config/searchRoles";
import {
  DEFAULT_SEARCH_RUNTIME_POLICY,
  normalizeSearchRuntimePolicy,
  type SearchRuntimePolicy,
} from "../config/searchPolicy";
import { getOperationalHoursState } from "../orchestration/operationalHours";
import type { JobSourceId } from "../types/job";

const API_EXTRACTION_KEY = "api_extraction_enabled";
/** Consecutive OpenAI scoring failures that look like network/outage (see pipeline); >3 disables extraction. */
const OPENAI_NETWORK_FAILURE_STREAK_KEY = "openai_network_failure_streak";
const VERBOSE_LOGGING_KEY = "verbose_logging_enabled";
/** When true, job expand panel shows Pipeline & extraction (HTTP request parameters sent). Default on. */
const DASHBOARD_SHOW_JOB_PIPELINE_PARAMS_KEY = "dashboard_show_job_pipeline_params";
/** When true, job expand panel shows raw fields from the provider API payload (`normalized_json.raw`). Default on. */
const DASHBOARD_SHOW_JOB_API_RAW_KEY = "dashboard_show_job_api_raw";
/** When true, each job expand panel shows “AI debug: re-score” (bypass hard filters, run OpenAI scoring). Default off. */
const DASHBOARD_AI_DEBUG_RESCORE_ENABLED_KEY = "dashboard_ai_debug_rescore_enabled";
/** JSON array of `JobSourceId` strings — dashboard is source of truth for pipeline round-robin. */
const ENABLED_JOB_SOURCES_KEY = "enabled_job_sources";
const SEARCH_ROLES_TIER1_KEY = "search_roles_tier1";
const SEARCH_ROLES_TIER2_KEY = "search_roles_tier2";
const SEARCH_ROLES_QUERY_CACHE_QUOTED_OR_TIER1_KEY = "search_roles_query_cache_quoted_or_tier1";
const SEARCH_ROLES_QUERY_CACHE_QUOTED_OR_TIER2_KEY = "search_roles_query_cache_quoted_or_tier2";
const SEARCH_COUNTRIES_KEY = "search_countries";
const SEARCH_REMOTE_ONLY_KEY = "search_remote_only";
const SEARCH_EMPLOYMENT_MODE_KEY = "search_employment_mode";
const SEARCH_RECENCY_MODE_KEY = "search_recency_mode";
/** Optional per-vendor overrides for max RapidAPI calls per UTC day (JSON object). */
const PROVIDER_REQUEST_CAPS_KEY = "provider_request_caps";

async function getJsonStringArray(db: D1Database, key: string): Promise<string[] | null> {
  const row = await db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  if (!row?.value?.trim()) return null;
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return null;
  }
}

async function getSettingValue(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

async function setSettingValue(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(key, value)
    .run();
}

export async function getApiExtractionEnabled(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(API_EXTRACTION_KEY)
    .first<{ value: string }>();
  if (!row) return false;
  const v = row.value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function setApiExtractionEnabled(db: D1Database, enabled: boolean): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(API_EXTRACTION_KEY, enabled ? "1" : "0")
    .run();
}

export async function getOpenAiNetworkFailureStreak(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(OPENAI_NETWORK_FAILURE_STREAK_KEY)
    .first<{ value: string }>();
  const n = parseInt(String(row?.value ?? "0"), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function resetOpenAiNetworkFailureStreak(db: D1Database): Promise<void> {
  await setSettingValue(db, OPENAI_NETWORK_FAILURE_STREAK_KEY, "0");
}

/** Returns new streak value after increment. */
export async function incrementOpenAiNetworkFailureStreak(db: D1Database): Promise<number> {
  const prev = await getOpenAiNetworkFailureStreak(db);
  const next = prev + 1;
  await setSettingValue(db, OPENAI_NETWORK_FAILURE_STREAK_KEY, String(next));
  return next;
}

export async function getVerboseLoggingEnabled(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(VERBOSE_LOGGING_KEY)
    .first<{ value: string }>();
  if (!row) return false;
  const v = row.value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function setVerboseLoggingEnabled(db: D1Database, enabled: boolean): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(VERBOSE_LOGGING_KEY, enabled ? "1" : "0")
    .run();
}

function parseTruthySetting(v: string | undefined | null, defaultTrue: boolean): boolean {
  if (v == null || !String(v).trim()) return defaultTrue;
  const x = String(v).trim().toLowerCase();
  if (x === "0" || x === "false" || x === "no" || x === "off") return false;
  if (x === "1" || x === "true" || x === "yes" || x === "on") return true;
  return defaultTrue;
}

export async function getDashboardShowJobPipelineParams(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(DASHBOARD_SHOW_JOB_PIPELINE_PARAMS_KEY)
    .first<{ value: string }>();
  return parseTruthySetting(row?.value, true);
}

export async function setDashboardShowJobPipelineParams(db: D1Database, enabled: boolean): Promise<void> {
  await setSettingValue(db, DASHBOARD_SHOW_JOB_PIPELINE_PARAMS_KEY, enabled ? "1" : "0");
}

export async function getDashboardShowJobApiRaw(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(DASHBOARD_SHOW_JOB_API_RAW_KEY)
    .first<{ value: string }>();
  return parseTruthySetting(row?.value, true);
}

export async function setDashboardShowJobApiRaw(db: D1Database, enabled: boolean): Promise<void> {
  await setSettingValue(db, DASHBOARD_SHOW_JOB_API_RAW_KEY, enabled ? "1" : "0");
}

export async function getDashboardAiDebugRescoreEnabled(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(DASHBOARD_AI_DEBUG_RESCORE_ENABLED_KEY)
    .first<{ value: string }>();
  const v = row?.value?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export async function setDashboardAiDebugRescoreEnabled(db: D1Database, enabled: boolean): Promise<void> {
  await setSettingValue(db, DASHBOARD_AI_DEBUG_RESCORE_ENABLED_KEY, enabled ? "1" : "0");
}

export async function getSearchRoleTiers(db: D1Database): Promise<SearchRoleTiers> {
  const [tier1, tier2] = await Promise.all([
    getJsonStringArray(db, SEARCH_ROLES_TIER1_KEY),
    getJsonStringArray(db, SEARCH_ROLES_TIER2_KEY),
  ]);
  return normalizeSearchRoleTiers({
    tier1: tier1 ?? DEFAULT_SEARCH_ROLE_TIERS.tier1,
    tier2: tier2 ?? DEFAULT_SEARCH_ROLE_TIERS.tier2,
  });
}

export async function getSearchCountries(db: D1Database): Promise<SearchCountry[]> {
  const raw = await getSettingValue(db, SEARCH_COUNTRIES_KEY);
  if (!raw?.trim()) return [...DEFAULT_SEARCH_COUNTRIES];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeSearchCountries(parsed);
  } catch {
    return [...DEFAULT_SEARCH_COUNTRIES];
  }
}

export async function setSearchCountries(db: D1Database, countries: readonly SearchCountry[]): Promise<void> {
  const normalized = normalizeSearchCountries(countries);
  await setSettingValue(db, SEARCH_COUNTRIES_KEY, JSON.stringify(normalized));
}

export async function getSearchRuntimePolicy(db: D1Database): Promise<SearchRuntimePolicy> {
  const [remoteOnly, employmentMode, recencyMode] = await Promise.all([
    getSettingValue(db, SEARCH_REMOTE_ONLY_KEY),
    getSettingValue(db, SEARCH_EMPLOYMENT_MODE_KEY),
    getSettingValue(db, SEARCH_RECENCY_MODE_KEY),
  ]);
  return normalizeSearchRuntimePolicy({
    remoteOnly,
    employmentMode,
    recencyMode,
  });
}

export async function setSearchRuntimePolicy(
  db: D1Database,
  policy: Partial<SearchRuntimePolicy>,
): Promise<void> {
  const current = await getSearchRuntimePolicy(db);
  const normalized = normalizeSearchRuntimePolicy({
    remoteOnly: policy.remoteOnly ?? current.remoteOnly,
    employmentMode: policy.employmentMode ?? current.employmentMode,
    recencyMode: policy.recencyMode ?? current.recencyMode,
  });
  await db.batch([
    db
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .bind(SEARCH_REMOTE_ONLY_KEY, normalized.remoteOnly ? "1" : "0"),
    db
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .bind(SEARCH_EMPLOYMENT_MODE_KEY, normalized.employmentMode),
    db
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .bind(SEARCH_RECENCY_MODE_KEY, normalized.recencyMode),
  ]);
}

export async function setSearchRoleTiers(db: D1Database, tiers: SearchRoleTiers): Promise<void> {
  const normalized = normalizeSearchRoleTiers(tiers, { fallbackToDefaults: false });
  const cache = buildSearchRoleQueryCache(normalized);
  await db.batch([
    db
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .bind(SEARCH_ROLES_TIER1_KEY, JSON.stringify(normalized.tier1)),
    db
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .bind(SEARCH_ROLES_TIER2_KEY, JSON.stringify(normalized.tier2)),
    db
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .bind(SEARCH_ROLES_QUERY_CACHE_QUOTED_OR_TIER1_KEY, cache.quotedOr.tier1),
    db
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .bind(SEARCH_ROLES_QUERY_CACHE_QUOTED_OR_TIER2_KEY, cache.quotedOr.tier2),
  ]);
}

export async function getSearchRoleQueryCache(db: D1Database): Promise<SearchRoleQueryCache> {
  const [tier1, tier2] = await Promise.all([
    db
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .bind(SEARCH_ROLES_QUERY_CACHE_QUOTED_OR_TIER1_KEY)
      .first<{ value: string }>(),
    db
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .bind(SEARCH_ROLES_QUERY_CACHE_QUOTED_OR_TIER2_KEY)
      .first<{ value: string }>(),
  ]);
  const fallback = buildSearchRoleQueryCache(await getSearchRoleTiers(db));
  return {
    quotedOr: {
      tier1: tier1?.value?.trim() || fallback.quotedOr.tier1,
      tier2: tier2?.value?.trim() || fallback.quotedOr.tier2,
    },
  };
}

/**
 * Emergency kill only: when wrangler sets `PIPELINE_FETCH_ENABLED` to the string `"false"`,
 * all extraction is blocked regardless of the dashboard toggle.
 */
export function isPipelineHardKillActive(env: Env): boolean {
  return env.PIPELINE_FETCH_ENABLED?.trim().toLowerCase() === "false";
}

/** Dashboard master switch + optional hard kill. Re-check during long runs via {@link isExtractionActive}. */
export async function getPipelineFetchAllowed(env: Env): Promise<{
  allowed: boolean;
  reason: string;
  nextAllowedAt: number | null;
}> {
  if (isPipelineHardKillActive(env)) {
    return { allowed: false, reason: "PIPELINE_HARD_KILL", nextAllowedAt: null };
  }
  const on = await getApiExtractionEnabled(env.DB);
  if (!on) return { allowed: false, reason: "API_EXTRACTION_DISABLED", nextAllowedAt: null };
  const operational = getOperationalHoursState(env);
  if (!operational.isOpenNow) {
    return {
      allowed: false,
      reason: "OUTSIDE_OPERATIONAL_HOURS",
      nextAllowedAt: operational.nextWindowStartAt,
    };
  }
  return { allowed: true, reason: "", nextAllowedAt: null };
}

/** Same gating as {@link getPipelineFetchAllowed} without allocating a reason string (for hot paths). */
export async function isExtractionActive(env: Env): Promise<boolean> {
  if (isPipelineHardKillActive(env)) return false;
  if (!(await getApiExtractionEnabled(env.DB))) return false;
  return getOperationalHoursState(env).isOpenNow;
}

/**
 * Enabled pipeline vendors (order preserved). If the setting row is missing, all `validIds` are enabled.
 * Empty array means no vendors (pipeline queues nothing).
 */
export async function getEnabledJobSourceIdsFromDb(
  db: D1Database,
  validIds: readonly JobSourceId[],
): Promise<JobSourceId[]> {
  const validSet = new Set<JobSourceId>(validIds);
  const row = await db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(ENABLED_JOB_SOURCES_KEY)
    .first<{ value: string }>();
  if (!row?.value?.trim()) {
    return [...validIds];
  }
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (!Array.isArray(parsed)) {
      return [...validIds];
    }
    const out: JobSourceId[] = [];
    for (const x of parsed) {
      if (typeof x !== "string") continue;
      const id = x as JobSourceId;
      if (validSet.has(id)) {
        out.push(id);
      }
    }
    return out;
  } catch {
    return [...validIds];
  }
}

/** Persists the exact enabled set (may be empty). */
export async function setEnabledJobSourceIds(
  db: D1Database,
  ids: readonly JobSourceId[],
  validIds: readonly JobSourceId[],
): Promise<void> {
  const validSet = new Set<JobSourceId>(validIds);
  const seen = new Set<JobSourceId>();
  const unique: JobSourceId[] = [];
  for (const id of ids) {
    if (validSet.has(id) && !seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }
  await db
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(ENABLED_JOB_SOURCES_KEY, JSON.stringify(unique))
    .run();
}

const PROVIDER_CAP_IDS: readonly JobSourceId[] = ["linkedin_jobs", "jsearch", "jobs_api"];

function parsePositiveIntFromEnv(raw: string | undefined): number {
  const n = raw ? parseInt(raw.trim(), 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Default per-UTC-day cap from wrangler vars (0 = unlimited). */
export function getDefaultProviderRequestCapFromEnv(env: Env, providerId: JobSourceId): number {
  switch (providerId) {
    case "linkedin_jobs":
      return parsePositiveIntFromEnv(env.LINKEDIN_MAX_API_CALLS_PER_RUN);
    case "jsearch":
      return parsePositiveIntFromEnv(env.JSEARCH_MAX_API_CALLS_PER_RUN);
    case "jobs_api":
      return parsePositiveIntFromEnv(env.JOBS_API_MAX_API_CALLS_PER_RUN);
  }
}

/**
 * Effective per-UTC-day RapidAPI budget: dashboard override if set, else wrangler default.
 * `0` = unlimited (no cap enforcement).
 */
export async function getResolvedProviderDailyRequestCap(
  db: D1Database,
  env: Env,
  providerId: JobSourceId,
): Promise<number> {
  const overrides = await getProviderRequestCapOverrides(db);
  if (overrides[providerId] !== undefined) {
    return Math.max(0, overrides[providerId]!);
  }
  return getDefaultProviderRequestCapFromEnv(env, providerId);
}

/**
 * Dashboard overrides for per-day RapidAPI budgets. Missing key = use wrangler env.
 * Value `0` means no cap (unlimited), same as unset env.
 */
export async function getProviderRequestCapOverrides(
  db: D1Database,
): Promise<Partial<Record<JobSourceId, number>>> {
  const raw = await getSettingValue(db, PROVIDER_REQUEST_CAPS_KEY);
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Partial<Record<JobSourceId, number>> = {};
    const o = parsed as Record<string, unknown>;
    for (const id of PROVIDER_CAP_IDS) {
      if (!Object.prototype.hasOwnProperty.call(o, id)) continue;
      const v = o[id];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        out[id] = Math.floor(v);
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Merge partial updates; `null` removes override for that vendor (inherit from env). */
export async function patchProviderRequestCapOverrides(
  db: D1Database,
  patch: Partial<Record<JobSourceId, number | null>>,
): Promise<void> {
  const current = await getProviderRequestCapOverrides(db);
  const next: Partial<Record<JobSourceId, number>> = { ...current };
  for (const id of PROVIDER_CAP_IDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, id)) continue;
    const p = patch[id];
    if (p === null) {
      delete next[id];
    } else if (typeof p === "number" && Number.isFinite(p) && p >= 0) {
      next[id] = Math.floor(p);
    }
  }
  if (Object.keys(next).length === 0) {
    await db.prepare("DELETE FROM app_settings WHERE key = ?").bind(PROVIDER_REQUEST_CAPS_KEY).run();
  } else {
    await setSettingValue(db, PROVIDER_REQUEST_CAPS_KEY, JSON.stringify(next));
  }
}

const OPENAI_SCORING_INSTRUCTION_KEY = "openai_scoring_instruction";
const OPENAI_DRAFT_INSTRUCTION_KEY = "openai_draft_instruction";

export async function getStoredOpenAiScoringInstruction(db: D1Database): Promise<string | null> {
  return getSettingValue(db, OPENAI_SCORING_INSTRUCTION_KEY);
}

export async function setStoredOpenAiScoringInstruction(db: D1Database, value: string): Promise<void> {
  await setSettingValue(db, OPENAI_SCORING_INSTRUCTION_KEY, value);
}

export async function getStoredOpenAiDraftInstruction(db: D1Database): Promise<string | null> {
  return getSettingValue(db, OPENAI_DRAFT_INSTRUCTION_KEY);
}

export async function setStoredOpenAiDraftInstruction(db: D1Database, value: string): Promise<void> {
  await setSettingValue(db, OPENAI_DRAFT_INSTRUCTION_KEY, value);
}

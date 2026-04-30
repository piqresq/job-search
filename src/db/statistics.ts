import type { JobSourceId } from "../types/job";
import { utcYmdFromUnix } from "./pipelineState";

const BACKFILL_DONE_KEY = "statistics_backfill_v1_done_at";
const PROVIDER_REQUEST_PREFIX = "provider_utc_day_request_count:";
const SQLITE_BATCH_LIMIT = 128;

type StatisticsCounterKey =
  | "requestCount"
  | "jobsReceived"
  | "jobsKept"
  | "jobsProcessed"
  | "jobsHigh"
  | "jobsMedium"
  | "jobsLow"
  | "jobsFiltered"
  | "jobsHardRejected"
  | "jobsAiRejected";

const COUNTER_KEYS: readonly StatisticsCounterKey[] = [
  "requestCount",
  "jobsReceived",
  "jobsKept",
  "jobsProcessed",
  "jobsHigh",
  "jobsMedium",
  "jobsLow",
  "jobsFiltered",
  "jobsHardRejected",
  "jobsAiRejected",
];

export type StatisticsCounterDelta = Partial<Record<StatisticsCounterKey, number>>;

export type StatisticsVariantDimension = {
  searchQuery?: string | null;
  tier?: number | null;
  countryKey?: string | null;
  countryLabel?: string | null;
};

export type StatisticsDelta = StatisticsCounterDelta & {
  providerId: JobSourceId;
  atUnix: number;
  variant?: StatisticsVariantDimension | null;
};

type NormalizedStatisticsVariantDimension = {
  searchQuery: string;
  tier: 0 | 1 | 2;
  countryKey: string;
  countryLabel: string;
};

type MutableProviderRow = {
  dayUtc: string;
  providerId: string;
  requestCount: number;
  jobsReceived: number;
  jobsKept: number;
  jobsProcessed: number;
  jobsHigh: number;
  jobsMedium: number;
  jobsLow: number;
  jobsFiltered: number;
  jobsHardRejected: number;
  jobsAiRejected: number;
  updatedAt: number;
};

type MutableVariantRow = MutableProviderRow & {
  searchQuery: string;
  tier: 0 | 1 | 2;
  countryKey: string;
  countryLabel: string;
};

export type StatisticsDailyProviderRow = {
  day_utc: string;
  provider_id: string;
  request_count: number;
  jobs_received: number;
  jobs_kept: number;
  jobs_processed: number;
  jobs_high: number;
  jobs_medium: number;
  jobs_low: number;
  jobs_filtered: number;
  jobs_hard_rejected: number;
  jobs_ai_rejected: number;
};

export type StatisticsProviderAggregateRow = StatisticsDailyProviderRow;

export type StatisticsVariantAggregateRow = {
  search_query: string;
  tier: number;
  providers_csv: string;
  request_count: number;
  jobs_received: number;
  jobs_kept: number;
  jobs_processed: number;
  jobs_high: number;
  jobs_medium: number;
  jobs_low: number;
  jobs_filtered: number;
  jobs_hard_rejected: number;
  jobs_ai_rejected: number;
};

/** Per-vendor request credits for a role variant (for dashboard zebra strip). */
export type StatisticsVariantProviderRequestRow = {
  search_query: string;
  tier: number;
  provider_id: string;
  request_count: number;
};

type BackfillJobRow = {
  source: string;
  recommendation: string | null;
  status: string;
  hard_filter_passed: number;
  created_at: number;
  api_fetched_at_unix: number | null;
  search_query: string | null;
  search_tier: number | null;
  search_country_key: string | null;
  search_country_label: string | null;
  country_name: string | null;
};

type BackfillChunkLogRow = {
  ts: number;
  provider_id: string | null;
  meta: string | null;
};

function emptyProviderRow(dayUtc: string, providerId: string, updatedAt: number): MutableProviderRow {
  return {
    dayUtc,
    providerId,
    requestCount: 0,
    jobsReceived: 0,
    jobsKept: 0,
    jobsProcessed: 0,
    jobsHigh: 0,
    jobsMedium: 0,
    jobsLow: 0,
    jobsFiltered: 0,
    jobsHardRejected: 0,
    jobsAiRejected: 0,
    updatedAt,
  };
}

function emptyVariantRow(
  dayUtc: string,
  providerId: string,
  variant: NormalizedStatisticsVariantDimension,
  updatedAt: number,
): MutableVariantRow {
  return {
    ...emptyProviderRow(dayUtc, providerId, updatedAt),
    searchQuery: variant.searchQuery,
    tier: variant.tier,
    countryKey: variant.countryKey,
    countryLabel: variant.countryLabel,
  };
}

function clampDeltaCount(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

function hasNonZeroCounters(delta: StatisticsCounterDelta): boolean {
  for (const key of COUNTER_KEYS) {
    if (clampDeltaCount(delta[key]) > 0) return true;
  }
  return false;
}

function normalizeVariantDimension(
  variant: StatisticsVariantDimension | null | undefined,
): NormalizedStatisticsVariantDimension | null {
  const searchQuery = typeof variant?.searchQuery === "string" ? variant.searchQuery.replace(/\s+/g, " ").trim() : "";
  if (!searchQuery) return null;
  const tier = variant?.tier === 1 || variant?.tier === 2 ? variant.tier : 0;
  const countryKeyRaw =
    typeof variant?.countryKey === "string" ? variant.countryKey.trim().toLowerCase() : "";
  const countryLabel = typeof variant?.countryLabel === "string" ? variant.countryLabel.trim() : "";
  return {
    searchQuery,
    tier,
    countryKey: countryKeyRaw,
    countryLabel,
  };
}

function applyCounterDelta(
  row: MutableProviderRow | MutableVariantRow,
  delta: StatisticsCounterDelta,
  updatedAt: number,
): void {
  row.requestCount += clampDeltaCount(delta.requestCount);
  row.jobsReceived += clampDeltaCount(delta.jobsReceived);
  row.jobsKept += clampDeltaCount(delta.jobsKept);
  row.jobsProcessed += clampDeltaCount(delta.jobsProcessed);
  row.jobsHigh += clampDeltaCount(delta.jobsHigh);
  row.jobsMedium += clampDeltaCount(delta.jobsMedium);
  row.jobsLow += clampDeltaCount(delta.jobsLow);
  row.jobsFiltered += clampDeltaCount(delta.jobsFiltered);
  row.jobsHardRejected += clampDeltaCount(delta.jobsHardRejected);
  row.jobsAiRejected += clampDeltaCount(delta.jobsAiRejected);
  row.updatedAt = Math.max(row.updatedAt, updatedAt);
}

function providerMapKey(dayUtc: string, providerId: string): string {
  return `${dayUtc}\0${providerId}`;
}

function variantMapKey(
  dayUtc: string,
  providerId: string,
  variant: NormalizedStatisticsVariantDimension,
): string {
  return `${dayUtc}\0${providerId}\0${variant.searchQuery}\0${variant.tier}\0${variant.countryKey}`;
}

function chunkStatements<T>(items: readonly T[], size = SQLITE_BATCH_LIMIT): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function providerDeltaStatement(db: D1Database, delta: StatisticsDelta): D1PreparedStatement {
  const dayUtc = utcYmdFromUnix(delta.atUnix);
  return db
    .prepare(
      `INSERT INTO statistics_daily_provider (
        day_utc, provider_id,
        request_count, jobs_received, jobs_kept, jobs_processed,
        jobs_high, jobs_medium, jobs_low, jobs_filtered,
        jobs_hard_rejected, jobs_ai_rejected, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(day_utc, provider_id) DO UPDATE SET
        request_count = statistics_daily_provider.request_count + excluded.request_count,
        jobs_received = statistics_daily_provider.jobs_received + excluded.jobs_received,
        jobs_kept = statistics_daily_provider.jobs_kept + excluded.jobs_kept,
        jobs_processed = statistics_daily_provider.jobs_processed + excluded.jobs_processed,
        jobs_high = statistics_daily_provider.jobs_high + excluded.jobs_high,
        jobs_medium = statistics_daily_provider.jobs_medium + excluded.jobs_medium,
        jobs_low = statistics_daily_provider.jobs_low + excluded.jobs_low,
        jobs_filtered = statistics_daily_provider.jobs_filtered + excluded.jobs_filtered,
        jobs_hard_rejected = statistics_daily_provider.jobs_hard_rejected + excluded.jobs_hard_rejected,
        jobs_ai_rejected = statistics_daily_provider.jobs_ai_rejected + excluded.jobs_ai_rejected,
        updated_at = excluded.updated_at`,
    )
    .bind(
      dayUtc,
      delta.providerId,
      clampDeltaCount(delta.requestCount),
      clampDeltaCount(delta.jobsReceived),
      clampDeltaCount(delta.jobsKept),
      clampDeltaCount(delta.jobsProcessed),
      clampDeltaCount(delta.jobsHigh),
      clampDeltaCount(delta.jobsMedium),
      clampDeltaCount(delta.jobsLow),
      clampDeltaCount(delta.jobsFiltered),
      clampDeltaCount(delta.jobsHardRejected),
      clampDeltaCount(delta.jobsAiRejected),
      delta.atUnix,
    );
}

function variantDeltaStatement(
  db: D1Database,
  delta: StatisticsDelta,
  variant: NormalizedStatisticsVariantDimension,
): D1PreparedStatement {
  const dayUtc = utcYmdFromUnix(delta.atUnix);
  return db
    .prepare(
      `INSERT INTO statistics_daily_variant (
        day_utc, provider_id, search_query, tier, country_key, country_label,
        request_count, jobs_received, jobs_kept, jobs_processed,
        jobs_high, jobs_medium, jobs_low, jobs_filtered,
        jobs_hard_rejected, jobs_ai_rejected, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(day_utc, provider_id, search_query, tier, country_key) DO UPDATE SET
        country_label = CASE
          WHEN excluded.country_label <> '' THEN excluded.country_label
          ELSE statistics_daily_variant.country_label
        END,
        request_count = statistics_daily_variant.request_count + excluded.request_count,
        jobs_received = statistics_daily_variant.jobs_received + excluded.jobs_received,
        jobs_kept = statistics_daily_variant.jobs_kept + excluded.jobs_kept,
        jobs_processed = statistics_daily_variant.jobs_processed + excluded.jobs_processed,
        jobs_high = statistics_daily_variant.jobs_high + excluded.jobs_high,
        jobs_medium = statistics_daily_variant.jobs_medium + excluded.jobs_medium,
        jobs_low = statistics_daily_variant.jobs_low + excluded.jobs_low,
        jobs_filtered = statistics_daily_variant.jobs_filtered + excluded.jobs_filtered,
        jobs_hard_rejected = statistics_daily_variant.jobs_hard_rejected + excluded.jobs_hard_rejected,
        jobs_ai_rejected = statistics_daily_variant.jobs_ai_rejected + excluded.jobs_ai_rejected,
        updated_at = excluded.updated_at`,
    )
    .bind(
      dayUtc,
      delta.providerId,
      variant.searchQuery,
      variant.tier,
      variant.countryKey,
      variant.countryLabel,
      clampDeltaCount(delta.requestCount),
      clampDeltaCount(delta.jobsReceived),
      clampDeltaCount(delta.jobsKept),
      clampDeltaCount(delta.jobsProcessed),
      clampDeltaCount(delta.jobsHigh),
      clampDeltaCount(delta.jobsMedium),
      clampDeltaCount(delta.jobsLow),
      clampDeltaCount(delta.jobsFiltered),
      clampDeltaCount(delta.jobsHardRejected),
      clampDeltaCount(delta.jobsAiRejected),
      delta.atUnix,
    );
}

export async function applyStatisticsDeltas(
  db: D1Database,
  deltas: readonly StatisticsDelta[],
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const delta of deltas) {
    if (!hasNonZeroCounters(delta)) continue;
    statements.push(providerDeltaStatement(db, delta));
    const variant = normalizeVariantDimension(delta.variant);
    if (variant) {
      statements.push(variantDeltaStatement(db, delta, variant));
    }
  }
  for (const chunk of chunkStatements(statements)) {
    if (chunk.length > 0) await db.batch(chunk);
  }
}

function providerOutcomeDelta(row: BackfillJobRow): StatisticsCounterDelta | null {
  const recommendation = (row.recommendation ?? "").trim().toLowerCase();
  const status = row.status.trim().toLowerCase();
  if (status === "hard_rejected") {
    return {
      jobsProcessed: 1,
      jobsFiltered: 1,
      jobsHardRejected: 1,
    };
  }
  if (recommendation === "high_priority_review") {
    return { jobsProcessed: 1, jobsHigh: 1 };
  }
  if (recommendation === "review") {
    return { jobsProcessed: 1, jobsMedium: 1 };
  }
  if (recommendation === "low_priority_review") {
    return { jobsProcessed: 1, jobsLow: 1 };
  }
  if (recommendation === "reject" || status === "rejected_by_ai") {
    return {
      jobsProcessed: 1,
      jobsFiltered: 1,
      jobsAiRejected: 1,
    };
  }
  return null;
}

function safeJsonParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseProviderRequestStateKey(
  key: string,
): { providerId: string; dayUtc: string } | null {
  if (!key.startsWith(PROVIDER_REQUEST_PREFIX)) return null;
  const rest = key.slice(PROVIDER_REQUEST_PREFIX.length);
  const idx = rest.indexOf(":");
  if (idx <= 0) return null;
  const providerId = rest.slice(0, idx).trim();
  const dayUtc = rest.slice(idx + 1).trim();
  if (!providerId || !dayUtc) return null;
  return { providerId, dayUtc };
}

function countryKeyFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function getBackfillDoneAt(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(BACKFILL_DONE_KEY)
    .first<{ value: string }>();
  if (!row?.value) return null;
  const n = parseInt(row.value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function setBackfillDoneAt(db: D1Database, nowSec: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(BACKFILL_DONE_KEY, String(nowSec))
    .run();
}

function getOrCreateProviderBackfillRow(
  map: Map<string, MutableProviderRow>,
  dayUtc: string,
  providerId: string,
  updatedAt: number,
): MutableProviderRow {
  const key = providerMapKey(dayUtc, providerId);
  let row = map.get(key);
  if (!row) {
    row = emptyProviderRow(dayUtc, providerId, updatedAt);
    map.set(key, row);
  }
  return row;
}

function getOrCreateVariantBackfillRow(
  map: Map<string, MutableVariantRow>,
  dayUtc: string,
  providerId: string,
  variant: NormalizedStatisticsVariantDimension,
  updatedAt: number,
): MutableVariantRow {
  const key = variantMapKey(dayUtc, providerId, variant);
  let row = map.get(key);
  if (!row) {
    row = emptyVariantRow(dayUtc, providerId, variant, updatedAt);
    map.set(key, row);
  }
  return row;
}

async function loadBackfillProviderRequests(
  db: D1Database,
  todayUtc: string,
  providerMap: Map<string, MutableProviderRow>,
): Promise<void> {
  const res = await db
    .prepare("SELECT k, v, updated_at FROM pipeline_state WHERE k LIKE ?")
    .bind(`${PROVIDER_REQUEST_PREFIX}%`)
    .all<{ k: string; v: string; updated_at: number }>();
  for (const row of res.results ?? []) {
    const parsed = parseProviderRequestStateKey(row.k);
    if (!parsed || parsed.dayUtc >= todayUtc) continue;
    const n = parseInt(String(row.v ?? ""), 10);
    if (!Number.isFinite(n) || n <= 0) continue;
    const target = getOrCreateProviderBackfillRow(
      providerMap,
      parsed.dayUtc,
      parsed.providerId,
      row.updated_at || 0,
    );
    target.requestCount += n;
    target.updatedAt = Math.max(target.updatedAt, row.updated_at || 0);
  }
}

async function loadBackfillChunkLogs(
  db: D1Database,
  todayStartUnix: number,
  providerMap: Map<string, MutableProviderRow>,
  variantMap: Map<string, MutableVariantRow>,
): Promise<void> {
  const res = await db
    .prepare(
      `SELECT ts, provider_id, meta
       FROM app_logs
       WHERE event_type = 'provider_chunk_finished'
         AND ts < ?`,
    )
    .bind(todayStartUnix)
    .all<BackfillChunkLogRow>();
  for (const row of res.results ?? []) {
    const meta = safeJsonParse(row.meta);
    if (!meta || typeof meta !== "object") continue;
    const obj = meta as Record<string, unknown>;
    const processing = obj.processing;
    if (!processing || typeof processing !== "object") continue;
    const proc = processing as Record<string, unknown>;
    const fetched =
      typeof proc.fetched === "number" && Number.isFinite(proc.fetched) ? Math.max(0, Math.floor(proc.fetched)) : 0;
    const kept =
      typeof proc.kept === "number" && Number.isFinite(proc.kept) ? Math.max(0, Math.floor(proc.kept)) : 0;
    if (fetched <= 0 && kept <= 0) continue;
    const providerId =
      (typeof row.provider_id === "string" && row.provider_id.trim()) ||
      (typeof obj.providerId === "string" ? obj.providerId.trim() : "");
    if (!providerId) continue;
    const dayUtc = utcYmdFromUnix(row.ts);
    const providerTarget = getOrCreateProviderBackfillRow(providerMap, dayUtc, providerId, row.ts);
    applyCounterDelta(providerTarget, { jobsReceived: fetched, jobsKept: kept }, row.ts);

    const providerResult = obj.providerResult;
    const providerMeta =
      providerResult && typeof providerResult === "object"
        ? (providerResult as Record<string, unknown>).meta
        : null;
    if (!providerMeta || typeof providerMeta !== "object") continue;
    const metaObj = providerMeta as Record<string, unknown>;
    const searchQuery =
      typeof metaObj.query === "string"
        ? metaObj.query
        : typeof metaObj.titleFilter === "string"
          ? metaObj.titleFilter
          : "";
    const countryLabel = typeof metaObj.country === "string" ? metaObj.country.trim() : "";
    const variant = normalizeVariantDimension({
      searchQuery,
      tier: typeof metaObj.tier === "number" ? metaObj.tier : null,
      countryKey:
        typeof metaObj.countryKey === "string" && metaObj.countryKey.trim()
          ? metaObj.countryKey
          : countryKeyFromLabel(countryLabel),
      countryLabel,
    });
    if (!variant) continue;
    const variantTarget = getOrCreateVariantBackfillRow(variantMap, dayUtc, providerId, variant, row.ts);
    applyCounterDelta(variantTarget, { jobsReceived: fetched, jobsKept: kept }, row.ts);
  }
}

async function loadBackfillFinalOutcomes(
  db: D1Database,
  todayStartUnix: number,
  providerMap: Map<string, MutableProviderRow>,
  variantMap: Map<string, MutableVariantRow>,
): Promise<void> {
  const res = await db
    .prepare(
      `SELECT
          source,
          recommendation,
          status,
          hard_filter_passed,
          created_at,
          CAST(json_extract(normalized_json, '$.apiFetchedAtUnix') AS INTEGER) AS api_fetched_at_unix,
          json_extract(normalized_json, '$.searchQuery') AS search_query,
          CAST(json_extract(normalized_json, '$.searchTier') AS INTEGER) AS search_tier,
          json_extract(normalized_json, '$.searchCountryKey') AS search_country_key,
          json_extract(normalized_json, '$.searchCountryLabel') AS search_country_label,
          json_extract(normalized_json, '$.country') AS country_name
       FROM jobs
       WHERE COALESCE(CAST(json_extract(normalized_json, '$.apiFetchedAtUnix') AS INTEGER), created_at) < ?`,
    )
    .bind(todayStartUnix)
    .all<BackfillJobRow>();
  for (const row of res.results ?? []) {
    const delta = providerOutcomeDelta(row);
    if (!delta) continue;
    const intakeUnix =
      typeof row.api_fetched_at_unix === "number" && Number.isFinite(row.api_fetched_at_unix) && row.api_fetched_at_unix > 0
        ? row.api_fetched_at_unix
        : row.created_at;
    const dayUtc = utcYmdFromUnix(intakeUnix);
    const providerId = row.source;
    const providerTarget = getOrCreateProviderBackfillRow(providerMap, dayUtc, providerId, intakeUnix);
    applyCounterDelta(providerTarget, delta, intakeUnix);

    const countryLabel =
      (row.search_country_label ?? "").trim() ||
      (row.country_name ?? "").trim();
    const variant = normalizeVariantDimension({
      searchQuery: row.search_query,
      tier: row.search_tier,
      countryKey:
        typeof row.search_country_key === "string" && row.search_country_key.trim()
          ? row.search_country_key
          : countryKeyFromLabel(countryLabel),
      countryLabel,
    });
    if (!variant) continue;
    const variantTarget = getOrCreateVariantBackfillRow(variantMap, dayUtc, providerId, variant, intakeUnix);
    applyCounterDelta(variantTarget, delta, intakeUnix);
  }
}

function providerBackfillStatement(db: D1Database, row: MutableProviderRow): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO statistics_daily_provider (
        day_utc, provider_id,
        request_count, jobs_received, jobs_kept, jobs_processed,
        jobs_high, jobs_medium, jobs_low, jobs_filtered,
        jobs_hard_rejected, jobs_ai_rejected, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(day_utc, provider_id) DO UPDATE SET
        request_count = excluded.request_count,
        jobs_received = excluded.jobs_received,
        jobs_kept = excluded.jobs_kept,
        jobs_processed = excluded.jobs_processed,
        jobs_high = excluded.jobs_high,
        jobs_medium = excluded.jobs_medium,
        jobs_low = excluded.jobs_low,
        jobs_filtered = excluded.jobs_filtered,
        jobs_hard_rejected = excluded.jobs_hard_rejected,
        jobs_ai_rejected = excluded.jobs_ai_rejected,
        updated_at = excluded.updated_at`,
    )
    .bind(
      row.dayUtc,
      row.providerId,
      row.requestCount,
      row.jobsReceived,
      row.jobsKept,
      row.jobsProcessed,
      row.jobsHigh,
      row.jobsMedium,
      row.jobsLow,
      row.jobsFiltered,
      row.jobsHardRejected,
      row.jobsAiRejected,
      row.updatedAt,
    );
}

function variantBackfillStatement(db: D1Database, row: MutableVariantRow): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO statistics_daily_variant (
        day_utc, provider_id, search_query, tier, country_key, country_label,
        request_count, jobs_received, jobs_kept, jobs_processed,
        jobs_high, jobs_medium, jobs_low, jobs_filtered,
        jobs_hard_rejected, jobs_ai_rejected, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(day_utc, provider_id, search_query, tier, country_key) DO UPDATE SET
        country_label = excluded.country_label,
        request_count = excluded.request_count,
        jobs_received = excluded.jobs_received,
        jobs_kept = excluded.jobs_kept,
        jobs_processed = excluded.jobs_processed,
        jobs_high = excluded.jobs_high,
        jobs_medium = excluded.jobs_medium,
        jobs_low = excluded.jobs_low,
        jobs_filtered = excluded.jobs_filtered,
        jobs_hard_rejected = excluded.jobs_hard_rejected,
        jobs_ai_rejected = excluded.jobs_ai_rejected,
        updated_at = excluded.updated_at`,
    )
    .bind(
      row.dayUtc,
      row.providerId,
      row.searchQuery,
      row.tier,
      row.countryKey,
      row.countryLabel,
      row.requestCount,
      row.jobsReceived,
      row.jobsKept,
      row.jobsProcessed,
      row.jobsHigh,
      row.jobsMedium,
      row.jobsLow,
      row.jobsFiltered,
      row.jobsHardRejected,
      row.jobsAiRejected,
      row.updatedAt,
    );
}

export async function ensureStatisticsBackfilled(db: D1Database, nowSec: number): Promise<boolean> {
  const doneAt = await getBackfillDoneAt(db);
  if (doneAt) return false;

  const todayUtc = utcYmdFromUnix(nowSec);
  const todayStartUnix = Math.floor(Date.UTC(
    new Date(nowSec * 1000).getUTCFullYear(),
    new Date(nowSec * 1000).getUTCMonth(),
    new Date(nowSec * 1000).getUTCDate(),
  ) / 1000);
  const providerMap = new Map<string, MutableProviderRow>();
  const variantMap = new Map<string, MutableVariantRow>();

  await loadBackfillProviderRequests(db, todayUtc, providerMap);
  await loadBackfillChunkLogs(db, todayStartUnix, providerMap, variantMap);
  await loadBackfillFinalOutcomes(db, todayStartUnix, providerMap, variantMap);

  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM statistics_daily_provider WHERE day_utc < ?").bind(todayUtc),
    db.prepare("DELETE FROM statistics_daily_variant WHERE day_utc < ?").bind(todayUtc),
  ];
  for (const row of providerMap.values()) statements.push(providerBackfillStatement(db, row));
  for (const row of variantMap.values()) statements.push(variantBackfillStatement(db, row));

  for (const chunk of chunkStatements(statements)) {
    if (chunk.length > 0) await db.batch(chunk);
  }
  await setBackfillDoneAt(db, nowSec);
  return true;
}

export function normalizeStatisticsDays(rawDays: string | number | null | undefined): number {
  const n = typeof rawDays === "number" ? rawDays : parseInt(String(rawDays ?? ""), 10);
  if (!Number.isFinite(n)) return 30;
  return Math.max(7, Math.min(180, Math.floor(n)));
}

export function statisticsWindow(nowSec: number, days: number): { fromYmd: string; toYmd: string } {
  const safeDays = normalizeStatisticsDays(days);
  const end = new Date(nowSec * 1000);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (safeDays - 1));
  return {
    fromYmd: utcYmdFromUnix(Math.floor(start.getTime() / 1000)),
    toYmd: utcYmdFromUnix(Math.floor(end.getTime() / 1000)),
  };
}

function parseUtcYmdString(ymd: string): Date | null {
  const t = ymd.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

/** Rolling window of `days` UTC calendar days ending on `endYmd` (inclusive). */
export function statisticsWindowEndingOn(endYmd: string, days: number): { fromYmd: string; toYmd: string } | null {
  const end = parseUtcYmdString(endYmd);
  if (!end) return null;
  const safeDays = normalizeStatisticsDays(days);
  const start = new Date(end.getTime());
  start.setUTCDate(start.getUTCDate() - (safeDays - 1));
  return {
    fromYmd: utcYmdFromUnix(Math.floor(start.getTime() / 1000)),
    toYmd: utcYmdFromUnix(Math.floor(end.getTime() / 1000)),
  };
}

/** Exact UTC calendar range for calendar picker selections; reversed inputs are normalized. */
export function statisticsExactRangeWindow(
  fromRawYmd: string,
  toRawYmd: string,
): { fromYmd: string; toYmd: string } | null {
  const from = parseUtcYmdString(fromRawYmd);
  const to = parseUtcYmdString(toRawYmd);
  if (!from || !to) return null;
  const start = from.getTime() <= to.getTime() ? from : to;
  const end = from.getTime() <= to.getTime() ? to : from;
  return {
    fromYmd: utcYmdFromUnix(Math.floor(start.getTime() / 1000)),
    toYmd: utcYmdFromUnix(Math.floor(end.getTime() / 1000)),
  };
}

/** Exact UTC calendar day window for a date picker selection. */
export function statisticsSingleDayWindow(dayYmd: string): { fromYmd: string; toYmd: string } | null {
  return statisticsExactRangeWindow(dayYmd, dayYmd);
}

export async function listStatisticsDailyProviderRows(
  db: D1Database,
  fromYmd: string,
  toYmd: string,
): Promise<StatisticsDailyProviderRow[]> {
  const res = await db
    .prepare(
      `SELECT day_utc, provider_id, request_count, jobs_received, jobs_kept, jobs_processed,
              jobs_high, jobs_medium, jobs_low, jobs_filtered, jobs_hard_rejected, jobs_ai_rejected
       FROM statistics_daily_provider
       WHERE day_utc >= ? AND day_utc <= ?
       ORDER BY day_utc ASC, provider_id ASC`,
    )
    .bind(fromYmd, toYmd)
    .all<StatisticsDailyProviderRow>();
  return res.results ?? [];
}

export async function listStatisticsProviderAggregates(
  db: D1Database,
  fromYmd: string,
  toYmd: string,
): Promise<StatisticsProviderAggregateRow[]> {
  const res = await db
    .prepare(
      `SELECT provider_id,
              SUM(request_count) AS request_count,
              SUM(jobs_received) AS jobs_received,
              SUM(jobs_kept) AS jobs_kept,
              SUM(jobs_processed) AS jobs_processed,
              SUM(jobs_high) AS jobs_high,
              SUM(jobs_medium) AS jobs_medium,
              SUM(jobs_low) AS jobs_low,
              SUM(jobs_filtered) AS jobs_filtered,
              SUM(jobs_hard_rejected) AS jobs_hard_rejected,
              SUM(jobs_ai_rejected) AS jobs_ai_rejected,
              MIN(day_utc) AS day_utc
       FROM statistics_daily_provider
       WHERE day_utc >= ? AND day_utc <= ?
       GROUP BY provider_id
       ORDER BY jobs_received DESC, provider_id ASC`,
    )
    .bind(fromYmd, toYmd)
    .all<StatisticsProviderAggregateRow>();
  return res.results ?? [];
}

export async function listStatisticsVariantAggregates(
  db: D1Database,
  fromYmd: string,
  toYmd: string,
  top: number,
): Promise<StatisticsVariantAggregateRow[]> {
  const limit = Math.max(5, Math.min(50, Math.floor(top)));
  const res = await db
    .prepare(
      `SELECT search_query,
              tier,
              GROUP_CONCAT(DISTINCT provider_id) AS providers_csv,
              SUM(request_count) AS request_count,
              SUM(jobs_received) AS jobs_received,
              SUM(jobs_kept) AS jobs_kept,
              SUM(jobs_processed) AS jobs_processed,
              SUM(jobs_high) AS jobs_high,
              SUM(jobs_medium) AS jobs_medium,
              SUM(jobs_low) AS jobs_low,
              SUM(jobs_filtered) AS jobs_filtered,
              SUM(jobs_hard_rejected) AS jobs_hard_rejected,
              SUM(jobs_ai_rejected) AS jobs_ai_rejected
       FROM statistics_daily_variant
       WHERE day_utc >= ? AND day_utc <= ?
       GROUP BY search_query, tier
       ORDER BY (SUM(jobs_high) * 3 + SUM(jobs_medium) * 2 + SUM(jobs_low)) DESC,
                SUM(jobs_received) DESC,
                search_query ASC
       LIMIT ?`,
    )
    .bind(fromYmd, toYmd, limit)
    .all<StatisticsVariantAggregateRow>();
  return res.results ?? [];
}

export async function listStatisticsVariantProviderRequestBreakdown(
  db: D1Database,
  fromYmd: string,
  toYmd: string,
): Promise<StatisticsVariantProviderRequestRow[]> {
  const res = await db
    .prepare(
      `SELECT search_query,
              tier,
              provider_id,
              SUM(request_count) AS request_count
       FROM statistics_daily_variant
       WHERE day_utc >= ? AND day_utc <= ?
       GROUP BY search_query, tier, provider_id`,
    )
    .bind(fromYmd, toYmd)
    .all<StatisticsVariantProviderRequestRow>();
  return res.results ?? [];
}

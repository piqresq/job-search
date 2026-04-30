import type { JobSourceId } from "../types/job";

const K_LINKEDIN_FREEZE_UNTIL = "linkedin_freeze_until";
const K_LINKEDIN_RR_START = "linkedin_rr_start";
const K_LINKEDIN_SWEEP_ID = "linkedin_sweep_id";
const K_PROVIDER_CYCLE_REQUEST_COUNT = "provider_cycle_request_count";
const K_PROVIDER_UTC_DAY_REQUEST_COUNT = "provider_utc_day_request_count";

/** UTC calendar date `YYYY-MM-DD` for daily RapidAPI usage counters. */
export function utcYmdFromUnix(sec: number): string {
  const d = new Date(sec * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function providerUtcDayRequestCountKey(providerId: JobSourceId, ymdUtc: string): string {
  const provider = providerId.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "_") || "default";
  const safeYmd = ymdUtc.replace(/[^0-9-]/g, "").slice(0, 10) || "unknown";
  return `${K_PROVIDER_UTC_DAY_REQUEST_COUNT}:${provider}:${safeYmd}`;
}

export async function getProviderUtcDayRequestCount(
  db: D1Database,
  providerId: JobSourceId,
  ymdUtc: string,
): Promise<number> {
  return getPipelineStateInt(db, providerUtcDayRequestCountKey(providerId, ymdUtc), 0);
}

export async function bumpProviderUtcDayRequestCount(
  db: D1Database,
  providerId: JobSourceId,
  nowSec: number,
): Promise<void> {
  const ymd = utcYmdFromUnix(nowSec);
  await db
    .prepare(
      `INSERT INTO pipeline_state (k, v, updated_at) VALUES (?, '1', ?)
       ON CONFLICT(k) DO UPDATE SET
         v = CAST(COALESCE(NULLIF(pipeline_state.v, ''), '0') AS INTEGER) + 1,
         updated_at = excluded.updated_at`,
    )
    .bind(providerUtcDayRequestCountKey(providerId, ymd), nowSec)
    .run();
}

/** Removes all per-vendor UTC-day RapidAPI counters for the given UTC calendar date (dashboard “refresh limits”). */
export async function clearAllProviderUtcDayRequestCountsForUtcDate(
  db: D1Database,
  ymdUtc: string,
): Promise<{ deletedRows: number }> {
  const safeYmd = ymdUtc.replace(/[^0-9-]/g, "").slice(0, 10) || "unknown";
  const globPattern = `${K_PROVIDER_UTC_DAY_REQUEST_COUNT}:*:${safeYmd}`;
  const countRow = await db
    .prepare(`SELECT COUNT(1) AS c FROM pipeline_state WHERE k GLOB ?`)
    .bind(globPattern)
    .first<{ c: number }>();
  const deletedRows = Number(countRow?.c ?? 0);
  if (deletedRows > 0) {
    await db.prepare(`DELETE FROM pipeline_state WHERE k GLOB ?`).bind(globPattern).run();
  }
  return { deletedRows };
}

export async function getPipelineStateInt(
  db: D1Database,
  key: string,
  defaultVal: number,
): Promise<number> {
  const row = await db
    .prepare("SELECT v FROM pipeline_state WHERE k = ?")
    .bind(key)
    .first<{ v: string }>();
  if (!row?.v) return defaultVal;
  const n = parseInt(row.v, 10);
  return Number.isFinite(n) ? n : defaultVal;
}

export async function setPipelineStateInt(db: D1Database, key: string, value: number, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO pipeline_state (k, v, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
    )
    .bind(key, String(value), now)
    .run();
}

export async function getLinkedinFreezeUntil(db: D1Database): Promise<number> {
  return getPipelineStateInt(db, K_LINKEDIN_FREEZE_UNTIL, 0);
}

export async function setLinkedinFreezeUntil(db: D1Database, until: number, now: number): Promise<void> {
  await setPipelineStateInt(db, K_LINKEDIN_FREEZE_UNTIL, until, now);
}

export async function getLinkedinRrStart(db: D1Database): Promise<number> {
  return getPipelineStateInt(db, K_LINKEDIN_RR_START, 0);
}

export async function setLinkedinRrStart(db: D1Database, start: number, now: number): Promise<void> {
  await setPipelineStateInt(db, K_LINKEDIN_RR_START, start, now);
}

export async function bumpLinkedinSweepId(db: D1Database, now: number): Promise<number> {
  const cur = await getPipelineStateInt(db, K_LINKEDIN_SWEEP_ID, 0);
  const next = cur + 1;
  await setPipelineStateInt(db, K_LINKEDIN_SWEEP_ID, next, now);
  return next;
}

function providerCycleRequestCountKey(providerId: JobSourceId, cycleId: string): string {
  const provider = providerId.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "_") || "default";
  const cycle = cycleId.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "_") || "default";
  return `${K_PROVIDER_CYCLE_REQUEST_COUNT}:${provider}:${cycle}`;
}

export async function getProviderCycleRequestCount(
  db: D1Database,
  providerId: JobSourceId,
  cycleId: string,
): Promise<number> {
  return getPipelineStateInt(db, providerCycleRequestCountKey(providerId, cycleId), 0);
}

export async function bumpProviderCycleRequestCount(
  db: D1Database,
  providerId: JobSourceId,
  cycleId: string,
  now: number,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO pipeline_state (k, v, updated_at) VALUES (?, '1', ?)
       ON CONFLICT(k) DO UPDATE SET
         v = CAST(COALESCE(NULLIF(pipeline_state.v, ''), '0') AS INTEGER) + 1,
         updated_at = excluded.updated_at
       RETURNING v`,
    )
    .bind(providerCycleRequestCountKey(providerId, cycleId), now)
    .first<{ v: string | number }>();
  const raw = row?.v;
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) {
    throw new Error(`pipeline_state: failed to bump provider request count for ${providerId}/${cycleId}`);
  }
  await bumpProviderUtcDayRequestCount(db, providerId, now);
  return n;
}

import { BOOTSTRAP_ADMIN_ID } from "./users";

export type AppLogRow = {
  id: number;
  ts: number;
  level: string;
  scope: string;
  message: string;
  meta: string | null;
  severity: string | null;
  category: string | null;
  event_type: string | null;
  provider_id: string | null;
  job_id: string | null;
  cycle_id: string | null;
  phase: string | null;
  fingerprint: string | null;
  status_kind: string | null;
};

export async function insertAppLog(
  db: D1Database,
  row: {
    userId?: string;
    level: string;
    scope: string;
    message: string;
    meta?: unknown;
    severity?: string | null;
    category?: string | null;
    eventType?: string | null;
    providerId?: string | null;
    jobId?: string | null;
    cycleId?: string | null;
    phase?: string | null;
    fingerprint?: string | null;
    statusKind?: string | null;
  },
): Promise<void> {
  const userId = row.userId ?? BOOTSTRAP_ADMIN_ID;
  const ts = Math.floor(Date.now() / 1000);
  const meta = row.meta !== undefined && row.meta !== null ? JSON.stringify(row.meta) : null;
  const msg = row.message.slice(0, 4000);
  const scope = row.scope.slice(0, 128);
  await db
    .prepare(
      `INSERT INTO app_logs (
        user_id, ts, level, scope, message, meta,
        severity, category, event_type, provider_id, job_id, cycle_id, phase, fingerprint, status_kind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      userId,
      ts,
      row.level,
      scope,
      msg,
      meta,
      row.severity ?? null,
      row.category ?? null,
      row.eventType ?? null,
      row.providerId ?? null,
      row.jobId ?? null,
      row.cycleId ?? null,
      row.phase ?? null,
      row.fingerprint ?? null,
      row.statusKind ?? null,
    )
    .run();
}

export async function listAppLogs(
  db: D1Database,
  userId: string,
  limit: number,
): Promise<AppLogRow[]> {
  const cap = Math.min(Math.max(1, Math.floor(limit)), 500);
  const res = await db
    .prepare(
      `SELECT
         id, ts, level, scope, message, meta,
         severity, category, event_type, provider_id, job_id, cycle_id, phase, fingerprint, status_kind
       FROM app_logs
       WHERE user_id = ?
       ORDER BY ts DESC, id DESC LIMIT ?`,
    )
    .bind(userId, cap)
    .all<AppLogRow>();
  return res.results ?? [];
}

export async function listOperationalAppLogs(
  db: D1Database,
  userId: string,
  limit: number,
): Promise<AppLogRow[]> {
  const cap = Math.min(Math.max(1, Math.floor(limit)), 500);
  const res = await db
    .prepare(
      `SELECT
         id, ts, level, scope, message, meta,
         severity, category, event_type, provider_id, job_id, cycle_id, phase, fingerprint, status_kind
       FROM app_logs
       WHERE user_id = ? AND severity IN ('critical', 'moderate', 'low')
       ORDER BY ts DESC, id DESC LIMIT ?`,
    )
    .bind(userId, cap)
    .all<AppLogRow>();
  return res.results ?? [];
}

export async function deleteOperationalIncidentGroup(
  db: D1Database,
  userId: string,
  args: { severity: "critical" | "moderate" | "low"; key: string },
): Promise<number> {
  const res = await db
    .prepare(
      `DELETE FROM app_logs
       WHERE user_id = ? AND severity = ?
         AND (
           fingerprint = ?
           OR (
             fingerprint IS NULL
             AND (
               COALESCE(severity, '') || '|' ||
               COALESCE(category, '') || '|' ||
               COALESCE(event_type, '') || '|' ||
               COALESCE(provider_id, '') || '|' ||
               COALESCE(phase, '') || '|' ||
               COALESCE(message, '')
             ) = ?
           )
         )`,
    )
    .bind(userId, args.severity, args.key, args.key)
    .run();
  return res.meta.changes ?? 0;
}

export async function deleteOperationalAppLogs(db: D1Database, userId: string): Promise<number> {
  const res = await db
    .prepare(`DELETE FROM app_logs WHERE user_id = ? AND severity IN ('critical', 'moderate', 'low')`)
    .bind(userId)
    .run();
  return res.meta.changes ?? 0;
}

export async function deleteAllAppLogs(db: D1Database, userId: string): Promise<number> {
  const res = await db.prepare("DELETE FROM app_logs WHERE user_id = ?").bind(userId).run();
  return res.meta.changes ?? 0;
}

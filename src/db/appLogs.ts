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
  const ts = Math.floor(Date.now() / 1000);
  const meta =
    row.meta !== undefined && row.meta !== null ? JSON.stringify(row.meta) : null;
  const msg = row.message.slice(0, 4000);
  const scope = row.scope.slice(0, 128);
  await db
    .prepare(
      `INSERT INTO app_logs (
        ts, level, scope, message, meta,
        severity, category, event_type, provider_id, job_id, cycle_id, phase, fingerprint, status_kind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
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

export async function listAppLogs(db: D1Database, limit: number): Promise<AppLogRow[]> {
  const cap = Math.min(Math.max(1, Math.floor(limit)), 500);
  const res = await db
    .prepare(
      `SELECT
         id, ts, level, scope, message, meta,
         severity, category, event_type, provider_id, job_id, cycle_id, phase, fingerprint, status_kind
       FROM app_logs
       ORDER BY ts DESC, id DESC LIMIT ?`,
    )
    .bind(cap)
    .all<AppLogRow>();
  return res.results ?? [];
}

export async function listOperationalAppLogs(db: D1Database, limit: number): Promise<AppLogRow[]> {
  const cap = Math.min(Math.max(1, Math.floor(limit)), 500);
  const res = await db
    .prepare(
      `SELECT
         id, ts, level, scope, message, meta,
         severity, category, event_type, provider_id, job_id, cycle_id, phase, fingerprint, status_kind
       FROM app_logs
       WHERE severity IN ('critical', 'moderate', 'low')
       ORDER BY ts DESC, id DESC LIMIT ?`,
    )
    .bind(cap)
    .all<AppLogRow>();
  return res.results ?? [];
}

export async function deleteOperationalIncidentGroup(
  db: D1Database,
  args: { severity: "critical" | "moderate" | "low"; key: string },
): Promise<number> {
  const res = await db
    .prepare(
      `DELETE FROM app_logs
       WHERE severity = ?
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
    .bind(args.severity, args.key, args.key)
    .run();
  return res.meta.changes ?? 0;
}

export async function deleteOperationalAppLogs(db: D1Database): Promise<number> {
  const res = await db
    .prepare(`DELETE FROM app_logs WHERE severity IN ('critical', 'moderate', 'low')`)
    .run();
  return res.meta.changes ?? 0;
}

/** Remove every row from `app_logs` (dashboard Textbot + all persisted logger output). */
export async function deleteAllAppLogs(db: D1Database): Promise<number> {
  const res = await db.prepare("DELETE FROM app_logs").run();
  return res.meta.changes ?? 0;
}

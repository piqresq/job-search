/**
 * D1 CRUD for the `linkedin_session` table.
 *
 * Single row, id = 'global'.  Stores the LinkedIn cookie blob, expiry, and
 * control flags used by the tiered Worker-IP → Bright-Data scan path.
 */

export type LinkedinSessionStatus =
  | "active"
  | "challenged"
  | "bad_credentials"
  | "transient"
  | "unknown";

export type LinkedinSessionRow = {
  cookies: Record<string, string>;
  liAtExpiresAt: number;
  lastRefreshAt: number;
  refreshCount: number;
  lastStatus: LinkedinSessionStatus;
  lastError: string | null;
  lastErrorDetail: Record<string, unknown> | null;
  lastErrorAt: number | null;
  disabledUntilNextCron: boolean;
  forceBrightdataScansUntil: number;
};

type RawRow = {
  cookies_json: string;
  li_at_expires_at: number;
  last_refresh_at: number;
  refresh_count: number;
  last_status: string;
  last_error: string | null;
  last_error_detail: string | null;
  last_error_at: number | null;
  disabled_until_next_cron: number;
  force_brightdata_scans_until: number;
};

function parseRow(raw: RawRow): LinkedinSessionRow {
  let cookies: Record<string, string> = {};
  try { cookies = JSON.parse(raw.cookies_json) as Record<string, string>; } catch { /* ignore */ }

  let lastErrorDetail: Record<string, unknown> | null = null;
  if (raw.last_error_detail) {
    try { lastErrorDetail = JSON.parse(raw.last_error_detail) as Record<string, unknown>; } catch { /* ignore */ }
  }

  return {
    cookies,
    liAtExpiresAt: raw.li_at_expires_at,
    lastRefreshAt: raw.last_refresh_at,
    refreshCount: raw.refresh_count,
    lastStatus: (raw.last_status as LinkedinSessionStatus) ?? "unknown",
    lastError: raw.last_error,
    lastErrorDetail,
    lastErrorAt: raw.last_error_at,
    disabledUntilNextCron: raw.disabled_until_next_cron === 1,
    forceBrightdataScansUntil: raw.force_brightdata_scans_until,
  };
}

export async function getLinkedinSession(db: D1Database): Promise<LinkedinSessionRow | null> {
  const raw = await db
    .prepare("SELECT * FROM linkedin_session WHERE id = 'global'")
    .first<RawRow>();
  if (!raw) return null;
  return parseRow(raw);
}

export async function upsertLinkedinSessionActive(
  db: D1Database,
  cookies: Record<string, string>,
  liAtExpiresAt: number,
  now: number,
  prevRefreshCount: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO linkedin_session
         (id, cookies_json, li_at_expires_at, last_refresh_at, refresh_count,
          last_status, last_error, last_error_detail, last_error_at,
          disabled_until_next_cron, force_brightdata_scans_until)
       VALUES ('global', ?, ?, ?, ?, 'active', NULL, NULL, NULL, 0, 0)
       ON CONFLICT(id) DO UPDATE SET
         cookies_json                 = excluded.cookies_json,
         li_at_expires_at             = excluded.li_at_expires_at,
         last_refresh_at              = excluded.last_refresh_at,
         refresh_count                = excluded.refresh_count,
         last_status                  = 'active',
         last_error                   = NULL,
         last_error_detail            = NULL,
         last_error_at                = NULL,
         disabled_until_next_cron     = 0`,
    )
    .bind(
      JSON.stringify(cookies),
      liAtExpiresAt,
      now,
      prevRefreshCount + 1,
    )
    .run();
}

export async function setLinkedinSessionFailure(
  db: D1Database,
  status: LinkedinSessionStatus,
  error: string,
  detail: Record<string, unknown>,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO linkedin_session
         (id, cookies_json, li_at_expires_at, last_refresh_at, refresh_count,
          last_status, last_error, last_error_detail, last_error_at,
          disabled_until_next_cron, force_brightdata_scans_until)
       VALUES ('global', '{}', 0, ?, 0, ?, ?, ?, ?, 1, 0)
       ON CONFLICT(id) DO UPDATE SET
         last_status                  = excluded.last_status,
         last_error                   = excluded.last_error,
         last_error_detail            = excluded.last_error_detail,
         last_error_at                = excluded.last_error_at,
         disabled_until_next_cron     = 1`,
    )
    .bind(now, status, error, JSON.stringify(detail), now)
    .run();
}

export async function clearLinkedinSessionDisabled(db: D1Database): Promise<void> {
  await db
    .prepare(
      `UPDATE linkedin_session SET disabled_until_next_cron = 0 WHERE id = 'global'`,
    )
    .run();
}

export async function setLinkedinBrightdataFallback(
  db: D1Database,
  until: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO linkedin_session
         (id, cookies_json, li_at_expires_at, last_refresh_at, refresh_count,
          last_status, last_error, last_error_detail, last_error_at,
          disabled_until_next_cron, force_brightdata_scans_until)
       VALUES ('global', '{}', 0, 0, 0, 'unknown', NULL, NULL, NULL, 0, ?)
       ON CONFLICT(id) DO UPDATE SET force_brightdata_scans_until = excluded.force_brightdata_scans_until`,
    )
    .bind(until)
    .run();
}

export async function clearLinkedinBrightdataFallback(db: D1Database): Promise<void> {
  await db
    .prepare(
      `UPDATE linkedin_session SET force_brightdata_scans_until = 0 WHERE id = 'global'`,
    )
    .run();
}

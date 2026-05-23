import type { DashboardListRow } from "./jobs";
import { deleteJobsByIdsWithR2Cleanup } from "./jobs";

export type JobBoardColumnId = "new" | "applying" | "applied" | "interview" | "rejected" | "expired";

export const JOB_BOARD_COLUMNS: readonly JobBoardColumnId[] = [
  "new",
  "applying",
  "applied",
  "interview",
  "rejected",
  "expired",
] as const;

/** Columns whose items are eligible for the daily expiration scan. */
export const EXPIRATION_SCAN_COLUMNS: readonly JobBoardColumnId[] = ["new", "applying", "applied"] as const;

/** Minimal job fields returned by selectBoardItemsForExpirationScan. */
export type BoardItemForExpirationScan = {
  job_id: string;
  source: string;
  title: string;
  company: string;
  job_url: string | null;
  apply_url: string | null;
  normalized_json: string | null;
  /** ISO2 country key from searchCountryKey (lowercase, e.g. "gb") */
  search_country_key: string | null;
};

export type JobBoardRow = DashboardListRow & {
  board_column_id: JobBoardColumnId;
  board_position: number;
  board_entered_at: number;
  board_updated_at: number;
  board_generating: number;
};

const DASHBOARD_LIST_COLUMNS_FOR_BOARD = `j.id AS id, j.source AS source, j.title AS title, j.company AS company,
              j.job_url AS job_url, j.apply_url AS apply_url, j.salary_raw AS salary_raw,
              j.salary_min AS salary_min, j.salary_max AS salary_max, j.salary_currency AS salary_currency,
              j.salary_monthly_eur AS salary_monthly_eur, j.salary_display_eur AS salary_display_eur,
              j.fit_score AS fit_score, j.recommendation AS recommendation, j.reasons_to_apply AS reasons_to_apply,
              j.risks AS risks, j.r2_cv_key AS r2_cv_key, j.r2_cover_key AS r2_cover_key, j.status AS status,
              j.hard_reject_reasons AS hard_reject_reasons, j.scoring_notes AS scoring_notes,
              j.created_at AS created_at,
              json_extract(j.normalized_json, '$.country') AS country_name,
              json_extract(j.normalized_json, '$.employmentType') AS employment_type,
              json_extract(j.normalized_json, '$.workplaceType') AS workplace_type,
              json_extract(j.normalized_json, '$.searchQuery') AS search_query,
              CAST(json_extract(j.normalized_json, '$.searchTier') AS INTEGER) AS search_tier,
              json_extract(j.scoring_json, '$.position_summary') AS position_summary,
              j.normalized_json AS normalized_json,
              json_extract(j.normalized_json, '$.postedAtUnix') AS posted_at_unix,
              json_extract(j.normalized_json, '$.apiFetchedAtUnix') AS api_fetched_at_unix`;

export function normalizeBoardColumnId(raw: unknown): JobBoardColumnId | null {
  return typeof raw === "string" && JOB_BOARD_COLUMNS.includes(raw as JobBoardColumnId)
    ? (raw as JobBoardColumnId)
    : null;
}

export async function listBoardItems(db: D1Database, userId: string): Promise<JobBoardRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${DASHBOARD_LIST_COLUMNS_FOR_BOARD},
              b.column_id AS board_column_id,
              b.position AS board_position,
              b.entered_at AS board_entered_at,
              b.updated_at AS board_updated_at,
              b.generating AS board_generating
       FROM job_board_items b
       INNER JOIN jobs j ON j.user_id = b.user_id AND j.id = b.job_id
       WHERE b.user_id = ?
       ORDER BY
         CASE b.column_id
           WHEN 'new' THEN 1
           WHEN 'applying' THEN 2
           WHEN 'applied' THEN 3
           WHEN 'interview' THEN 4
           WHEN 'rejected' THEN 5
           WHEN 'expired' THEN 6
           ELSE 7
         END,
         b.position ASC,
         b.entered_at DESC,
         b.job_id ASC`,
    )
    .bind(userId)
    .all<JobBoardRow>();
  return results ?? [];
}

export async function addBoardItem(
  db: D1Database,
  userId: string,
  jobId: string,
  columnId: JobBoardColumnId,
  now: number,
): Promise<boolean> {
  const exists = await db
    .prepare("SELECT id FROM jobs WHERE user_id = ? AND id = ?")
    .bind(userId, jobId)
    .first<{ id: string }>();
  if (!exists) return false;

  const position = await nextBoardPosition(db, userId, columnId);
  await db
    .prepare(
      `INSERT INTO job_board_items (user_id, job_id, column_id, position, entered_at, updated_at, generating)
       VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(user_id, job_id) DO UPDATE SET
         column_id = excluded.column_id,
         position = excluded.position,
         entered_at = excluded.entered_at,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, jobId, columnId, position, now, now)
    .run();
  return true;
}

export async function moveBoardItem(
  db: D1Database,
  userId: string,
  jobId: string,
  columnId: JobBoardColumnId,
  now: number,
): Promise<boolean> {
  const position = await nextBoardPosition(db, userId, columnId);
  const res = await db
    .prepare(
      `UPDATE job_board_items
       SET column_id = ?, position = ?, entered_at = ?, updated_at = ?
       WHERE user_id = ? AND job_id = ?`,
    )
    .bind(columnId, position, now, now, userId, jobId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function reorderBoardItems(
  db: D1Database,
  userId: string,
  columnId: JobBoardColumnId,
  orderedJobIds: string[],
  now: number,
): Promise<void> {
  if (orderedJobIds.length === 0) return;
  const stmts = orderedJobIds.map((jobId, idx) =>
    db
      .prepare(
        `UPDATE job_board_items SET position = ?, updated_at = ?
         WHERE user_id = ? AND job_id = ? AND column_id = ?`,
      )
      .bind(idx * 10, now, userId, jobId, columnId),
  );
  await db.batch(stmts);
}

export type BoardItemGeneratingClaim = "claimed" | "already" | "not_on_board";

/** Atomically mark a board item as generating (only when not already generating). */
export async function claimBoardItemGenerating(
  db: D1Database,
  userId: string,
  jobId: string,
  now: number,
): Promise<BoardItemGeneratingClaim> {
  const row = await db
    .prepare("SELECT generating FROM job_board_items WHERE user_id = ? AND job_id = ?")
    .bind(userId, jobId)
    .first<{ generating: number }>();
  if (!row) return "not_on_board";
  if (row.generating === 1) return "already";
  const res = await db
    .prepare(
      `UPDATE job_board_items
       SET generating = 1, updated_at = ?
       WHERE user_id = ? AND job_id = ? AND generating = 0`,
    )
    .bind(now, userId, jobId)
    .run();
  return (res.meta?.changes ?? 0) > 0 ? "claimed" : "already";
}

export async function setBoardItemGenerating(
  db: D1Database,
  userId: string,
  jobId: string,
  generating: boolean,
  now: number,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE job_board_items
       SET generating = ?, updated_at = ?
       WHERE user_id = ? AND job_id = ?`,
    )
    .bind(generating ? 1 : 0, now, userId, jobId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function removeBoardItem(db: D1Database, userId: string, jobId: string): Promise<number> {
  const res = await db
    .prepare("DELETE FROM job_board_items WHERE user_id = ? AND job_id = ?")
    .bind(userId, jobId)
    .run();
  return res.meta?.changes ?? 0;
}

export async function purgeExpiredRejectedBoardItems(
  db: D1Database,
  userId: string,
  now: number,
): Promise<number> {
  const cutoff = now - 3 * 86400;
  const res = await db
    .prepare("DELETE FROM job_board_items WHERE user_id = ? AND column_id = 'rejected' AND entered_at <= ?")
    .bind(userId, cutoff)
    .run();
  return res.meta?.changes ?? 0;
}

export async function importBoardSnapshot(
  db: D1Database,
  userId: string,
  snapshot: unknown,
  now: number,
): Promise<number> {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return 0;

  const stmts: D1PreparedStatement[] = [];
  const seen = new Set<string>();
  for (const columnId of JOB_BOARD_COLUMNS) {
    const arr = (snapshot as Record<string, unknown>)[columnId];
    if (!Array.isArray(arr)) continue;
    let pos = 0;
    for (const raw of arr) {
      const jobId = extractSnapshotJobId(raw);
      if (!jobId || seen.has(jobId)) continue;
      seen.add(jobId);
      stmts.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO job_board_items (user_id, job_id, column_id, position, entered_at, updated_at, generating)
             SELECT ?, j.id, ?, ?, ?, ?, 0
             FROM jobs j
             WHERE j.user_id = ? AND j.id = ?`,
          )
          .bind(userId, columnId, pos++, now, now, userId, jobId),
      );
    }
  }

  if (stmts.length === 0) return 0;
  let imported = 0;
  const batchSize = 80;
  for (let i = 0; i < stmts.length; i += batchSize) {
    const results = await db.batch(stmts.slice(i, i + batchSize));
    imported += results.reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
  }
  return imported;
}

/**
 * Return board items eligible for the daily expiration scan (columns: new, applying, applied).
 * Joins with jobs to get the URL and company fields needed by the detection module.
 */
export async function selectBoardItemsForExpirationScan(
  db: D1Database,
  userId: string,
): Promise<BoardItemForExpirationScan[]> {
  const placeholders = EXPIRATION_SCAN_COLUMNS.map(() => "?").join(",");
  const binds: string[] = [userId, ...EXPIRATION_SCAN_COLUMNS];
  const { results } = await db
    .prepare(
      `SELECT b.job_id,
              j.source,
              j.title,
              j.company,
              j.job_url,
              j.apply_url,
              j.normalized_json,
              json_extract(j.normalized_json, '$.searchCountryKey') AS search_country_key
       FROM job_board_items b
       INNER JOIN jobs j ON j.user_id = b.user_id AND j.id = b.job_id
       WHERE b.user_id = ? AND b.column_id IN (${placeholders})`,
    )
    .bind(...binds)
    .all<BoardItemForExpirationScan>();
  return results ?? [];
}

/**
 * Move a board item to the 'expired' column, resetting its entered_at to now
 * so the 3-day hard-delete countdown starts from the time of detection.
 */
export async function moveBoardItemToExpired(
  db: D1Database,
  userId: string,
  jobId: string,
  now: number,
): Promise<boolean> {
  return moveBoardItem(db, userId, jobId, "expired", now);
}

/**
 * Hard-delete jobs that have been in the 'expired' board column for ≥ 3 days.
 * Uses deleteJobsByIdsWithR2Cleanup so favorites, board items, and R2 docs are
 * all cleaned up atomically.
 */
export async function purgeExpiredBoardItemsHardDelete(
  env: Env,
  userId: string,
  now: number,
): Promise<{ deletedJobs: number; r2Deleted: number }> {
  const cutoff = now - 3 * 86400;
  const { results } = await env.DB
    .prepare(
      "SELECT job_id FROM job_board_items WHERE user_id = ? AND column_id = 'expired' AND entered_at <= ?",
    )
    .bind(userId, cutoff)
    .all<{ job_id: string }>();

  const ids = (results ?? []).map((r) => r.job_id).filter(Boolean);
  if (ids.length === 0) return { deletedJobs: 0, r2Deleted: 0 };

  const { r2Deleted } = await deleteJobsByIdsWithR2Cleanup(env.DB, env.DOCS_BUCKET, ids, userId);
  return { deletedJobs: ids.length, r2Deleted };
}

async function nextBoardPosition(db: D1Database, userId: string, columnId: JobBoardColumnId): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM job_board_items WHERE user_id = ? AND column_id = ?")
    .bind(userId, columnId)
    .first<{ next_position: number | null }>();
  const n = Number(row?.next_position ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function extractSnapshotJobId(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim() || null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = (raw as Record<string, unknown>).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

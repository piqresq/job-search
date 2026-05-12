import type { DashboardListRow } from "./jobs";

export type JobBoardColumnId = "new" | "applying" | "applied" | "interview" | "rejected";

export const JOB_BOARD_COLUMNS: readonly JobBoardColumnId[] = [
  "new",
  "applying",
  "applied",
  "interview",
  "rejected",
] as const;

export type JobBoardRow = DashboardListRow & {
  board_column_id: JobBoardColumnId;
  board_position: number;
  board_entered_at: number;
  board_updated_at: number;
  board_generating: number;
};

const DASHBOARD_LIST_COLUMNS_FOR_BOARD = `j.id AS id, j.title AS title, j.company AS company,
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
           ELSE 6
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
         updated_at = excluded.updated_at,
         generating = 0`,
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
       SET column_id = ?, position = ?, entered_at = ?, updated_at = ?, generating = 0
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

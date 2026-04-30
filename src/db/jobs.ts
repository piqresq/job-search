import { listingLogoFromUrls, type ListingLogoKind } from "../dashboard/listingLogo";
import { computeSalaryEurCache, type SalaryEurCache } from "../dashboard/salary";
import type { HardFilterFxRates } from "../pipeline/hardFilters";
import { parseScoringFromJson, type NormalizedJob, type ScoringResult } from "../types/job";

export type JobRow = {
  id: string;
  status: string;
  fit_score: number | null;
  recommendation: string | null;
  dash_bucket: string | null;
};

export type DashboardListRow = {
  id: string;
  title: string | null;
  company: string | null;
  job_url: string | null;
  apply_url: string | null;
  salary_raw: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  /** Persisted monthly NET EUR (see `computeSalaryEurCache`); null when unknown. */
  salary_monthly_eur: number | null;
  /** Persisted dashboard string ("3,210 NET" / "N/A"); null when cache not yet filled. */
  salary_display_eur: string | null;
  fit_score: number | null;
  recommendation: string | null;
  reasons_to_apply: string | null;
  risks: string | null;
  r2_cv_key: string | null;
  r2_cover_key: string | null;
  status: string | null;
  hard_reject_reasons: string | null;
  scoring_notes: string | null;
  /** From normalized_json (LinkedIn/JSearch). */
  country_name: string | null;
  employment_type: string | null;
  /** From normalized_json: Office | Remote | Hybrid (see workplaceTypeCanonical). */
  workplace_type: string | null;
  /** From normalized_json: pipeline role/query string used to fetch this row. */
  search_query: string | null;
  /** From normalized_json: planned-search tier (1 or 2) when present. */
  search_tier: number | null;
  /** From scoring_json: 3-sentence job summary from AI scoring. */
  position_summary: string | null;
  /** Full normalized job JSON (for ingestion facts in dashboard). */
  normalized_json: string | null;
  created_at: number;
  posted_at_unix: number | null;
  api_fetched_at_unix: number | null;
};

/** Pipeline callers pass the already-fetched FX so that list requests never need Frankfurter. */
function salaryEurCacheForJob(job: NormalizedJob, fx: HardFilterFxRates | null): SalaryEurCache | null {
  if (!fx) return null;
  return computeSalaryEurCache(
    {
      title: job.title ?? null,
      description: job.description ?? null,
      salary_raw: job.salaryRaw ?? null,
      salary_min: job.salaryMin ?? null,
      salary_max: job.salaryMax ?? null,
      salary_currency: job.salaryCurrency ?? null,
    },
    fx,
  );
}

export type DashboardJobListTab = "active" | "favorites" | "accepted" | "denied" | "filtered";
export type DashboardJobListSortRel = "high-first" | "low-first" | "as-fetched";
export type DashboardJobListSortSrc = "default" | "linkedin-first" | "google-first" | "other-first";
export type DashboardJobListSortSalary = "off" | "high-first" | "low-first";
export type DashboardJobListSortDate = "off" | "new-first" | "old-first";
/** Rolling window on pipeline ingest / fetch time (UTC), matching {@link DASHBOARD_JOB_INGEST_SORT_EXPR}. */
export type DashboardJobListFilterFetchAge = "off" | "24h" | "2d" | "3d" | "7d" | "14d" | "21d";

export type DashboardJobListPrefs = {
  src: { linkedin: boolean; google: boolean; other: boolean };
  rel: { high: boolean; medium: boolean; low: boolean; failed: boolean; none: boolean };
  contract: { ft: boolean; pt: boolean; temp: boolean; other: boolean };
  countries: Record<string, boolean>;
  roleQueries: Record<string, boolean>;
  sortRel: DashboardJobListSortRel;
  sortSrc: DashboardJobListSortSrc;
  sortSalary: DashboardJobListSortSalary;
  sortDate: DashboardJobListSortDate;
  filterFetchAge: DashboardJobListFilterFetchAge;
  listSearch: string;
};

export type DashboardJobListFacets = {
  countries: string[];
  roleQueries: string[];
};

export type DashboardJobListCursor = Record<string, string | number>;

export type DashboardJobListPage = {
  rows: DashboardListRow[];
  totalMatching: number;
  totalUnfiltered: number;
  hasMore: boolean;
  nextCursor: DashboardJobListCursor | null;
  facets: DashboardJobListFacets;
};

export function defaultDashboardJobListPrefs(): DashboardJobListPrefs {
  return {
    src: { linkedin: true, google: true, other: true },
    rel: { high: true, medium: true, low: true, failed: true, none: true },
    contract: { ft: true, pt: true, temp: true, other: true },
    countries: {},
    roleQueries: {},
    sortRel: "high-first",
    sortSrc: "default",
    sortSalary: "off",
    sortDate: "off",
    filterFetchAge: "off",
    listSearch: "",
  };
}

export async function getJob(db: D1Database, id: string): Promise<JobRow | null> {
  const row = await db
    .prepare(
      "SELECT id, status, fit_score, recommendation, dash_bucket FROM jobs WHERE id = ?",
    )
    .bind(id)
    .first<JobRow>();
  return row ?? null;
}

export async function loadNormalizedJob(db: D1Database, id: string) {
  const row = await db
    .prepare("SELECT normalized_json FROM jobs WHERE id = ?")
    .bind(id)
    .first<{ normalized_json: string }>();
  if (!row?.normalized_json) return null;
  try {
    return JSON.parse(row.normalized_json) as import("../types/job").NormalizedJob;
  } catch {
    return null;
  }
}

export async function loadScoringResult(
  db: D1Database,
  id: string,
): Promise<import("../types/job").ScoringResult | null> {
  const row = await db
    .prepare("SELECT scoring_json FROM jobs WHERE id = ?")
    .bind(id)
    .first<{ scoring_json: string | null }>();
  if (!row?.scoring_json) return null;
  try {
    return parseScoringFromJson(JSON.parse(row.scoring_json));
  } catch {
    return null;
  }
}

export async function upsertNormalizedJob(
  db: D1Database,
  id: string,
  job: NormalizedJob,
  now: number,
  contentDedupeHash: string | null = null,
  fx: HardFilterFxRates | null = null,
): Promise<void> {
  const normalizedJson = JSON.stringify(job);
  const salaryCache = salaryEurCacheForJob(job, fx);
  await db
    .prepare(
      `INSERT INTO jobs (
        id, source, external_id, title, company, job_url, apply_url, location, is_remote,
        description, salary_raw, salary_min, salary_max, salary_currency, normalized_json,
        hard_filter_passed, status, dash_bucket, created_at, updated_at, content_dedupe_hash,
        salary_monthly_eur, salary_display_eur
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,'imported','active',?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        company = excluded.company,
        job_url = excluded.job_url,
        apply_url = excluded.apply_url,
        location = excluded.location,
        is_remote = excluded.is_remote,
        description = excluded.description,
        salary_raw = excluded.salary_raw,
        salary_min = excluded.salary_min,
        salary_max = excluded.salary_max,
        salary_currency = excluded.salary_currency,
        normalized_json = excluded.normalized_json,
        content_dedupe_hash = excluded.content_dedupe_hash,
        dash_bucket = COALESCE(jobs.dash_bucket, 'active'),
        updated_at = excluded.updated_at,
        created_at = jobs.created_at,
        salary_monthly_eur = COALESCE(excluded.salary_monthly_eur, jobs.salary_monthly_eur),
        salary_display_eur = COALESCE(excluded.salary_display_eur, jobs.salary_display_eur)`,
    )
    .bind(
      id,
      job.source,
      job.externalId,
      job.title,
      job.company,
      job.jobUrl,
      job.applyUrl,
      job.location,
      job.isRemote ? 1 : 0,
      job.description,
      job.salaryRaw ?? null,
      job.salaryMin ?? null,
      job.salaryMax ?? null,
      job.salaryCurrency ?? null,
      normalizedJson,
      now,
      now,
      contentDedupeHash,
      salaryCache?.monthlyEur ?? null,
      salaryCache?.display ?? null,
    )
    .run();
}

/** Earliest-saved row wins; used to hard-reject later listings with the same content fingerprint. */
export async function findOtherJobIdWithContentDedupeHash(
  db: D1Database,
  hash: string,
  excludeId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT id FROM jobs
       WHERE content_dedupe_hash = ? AND id != ?
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    )
    .bind(hash, excludeId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** After AI scoring: persist description-derived salary into D1 and normalized_json. */
export async function updateNormalizedJobSalary(
  db: D1Database,
  id: string,
  job: NormalizedJob,
  now: number,
  fx: HardFilterFxRates | null = null,
): Promise<void> {
  const normalizedJson = JSON.stringify(job);
  const salaryCache = salaryEurCacheForJob(job, fx);
  await db
    .prepare(
      `UPDATE jobs SET
        salary_raw = ?,
        salary_min = ?,
        salary_max = ?,
        salary_currency = ?,
        normalized_json = ?,
        salary_monthly_eur = COALESCE(?, salary_monthly_eur),
        salary_display_eur = COALESCE(?, salary_display_eur),
        updated_at = ?
      WHERE id = ?`,
    )
    .bind(
      job.salaryRaw ?? null,
      job.salaryMin ?? null,
      job.salaryMax ?? null,
      job.salaryCurrency ?? null,
      normalizedJson,
      salaryCache?.monthlyEur ?? null,
      salaryCache?.display ?? null,
      now,
      id,
    )
    .run();
}

/** After AI scoring: persist `normalized_json` when only non-salary fields (e.g. workplace) changed. */
export async function updateNormalizedJobNormalizedJson(
  db: D1Database,
  id: string,
  job: NormalizedJob,
  now: number,
): Promise<void> {
  await db
    .prepare(`UPDATE jobs SET normalized_json = ?, updated_at = ? WHERE id = ?`)
    .bind(JSON.stringify(job), now, id)
    .run();
}

export async function markHardRejected(
  db: D1Database,
  id: string,
  reasons: string[],
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE jobs SET
        hard_filter_passed = 0,
        hard_reject_reasons = ?,
        status = 'hard_rejected',
        dash_bucket = 'filtered',
        dash_moved_at = NULL,
        updated_at = ?
      WHERE id = ?`,
    )
    .bind(JSON.stringify(reasons), now, id)
    .run();
}

export async function markHardPassed(db: D1Database, id: string, now: number): Promise<void> {
  await db
    .prepare(
      `UPDATE jobs SET
        hard_filter_passed = 1,
        hard_reject_reasons = NULL,
        dash_bucket = COALESCE(dash_bucket, 'active'),
        updated_at = ?
      WHERE id = ?`,
    )
    .bind(now, id)
    .run();
}

/**
 * Surface a partially processed row in the Filtered tab with a human-readable reason.
 * `failed` rows stay in the Filtered tab and can be retried from the dashboard.
 */
export async function markDashboardProcessingFailure(
  db: D1Database,
  id: string,
  reason: string,
  now: number,
): Promise<void> {
  const note = reason.trim().slice(0, 1800) || "Pipeline stopped before a final recommendation was stored.";
  await db
    .prepare(
      `UPDATE jobs SET
        status = 'failed',
        dash_bucket = 'filtered',
        dash_moved_at = NULL,
        fit_score = NULL,
        recommendation = NULL,
        scoring_json = NULL,
        reasons_to_apply = NULL,
        risks = NULL,
        hard_reject_reasons = NULL,
        scoring_notes = ?,
        updated_at = ?
      WHERE id = ?`,
    )
    .bind(note, now, id)
    .run();
}

export async function saveScoring(
  db: D1Database,
  id: string,
  scoring: ScoringResult,
  now: number,
): Promise<void> {
  const reject = scoring.recommendation === "reject";
  const rejectNote =
    reject && scoring.rejection_reason.trim() ? scoring.rejection_reason.trim() : null;
  await db
    .prepare(
      `UPDATE jobs SET
        fit_score = ?,
        recommendation = ?,
        scoring_json = ?,
        reasons_to_apply = ?,
        risks = ?,
        suggested_cv_variant = ?,
        cover_letter_angle = ?,
        scoring_notes = ?,
        status = CASE WHEN ? THEN 'rejected_by_ai' ELSE 'dashboard_open' END,
        dash_bucket = CASE WHEN ? THEN 'filtered' ELSE 'active' END,
        dash_moved_at = CASE WHEN ? THEN NULL ELSE dash_moved_at END,
        updated_at = ?
      WHERE id = ?`,
    )
    .bind(
      scoring.fit_score,
      scoring.recommendation,
      JSON.stringify(scoring),
      JSON.stringify(scoring.positives),
      JSON.stringify(scoring.negatives),
      "",
      "",
      rejectNote,
      reject ? 1 : 0,
      reject ? 1 : 0,
      reject ? 1 : 0,
      now,
      id,
    )
    .run();
}

export async function saveDraftsAndReview(
  db: D1Database,
  id: string,
  drafts: { cvDraft: string; coverLetter: string },
  tokenHash: string,
  expiresAt: number,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE jobs SET
        draft_cv = ?,
        draft_cover_letter = ?,
        review_token_hash = ?,
        review_token_expires_at = ?,
        status = 'review_email_sent',
        updated_at = ?
      WHERE id = ?`,
    )
    .bind(drafts.cvDraft, drafts.coverLetter, tokenHash, expiresAt, now, id)
    .run();
}

export async function setJobStatus(
  db: D1Database,
  id: string,
  status: string,
  now: number,
): Promise<void> {
  await db.prepare(`UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?`).bind(status, now, id).run();
}

export async function updateDrafts(
  db: D1Database,
  id: string,
  cv: string,
  letter: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE jobs SET draft_cv = ?, draft_cover_letter = ?, status = 'edit_pending', updated_at = ? WHERE id = ?`,
    )
    .bind(cv, letter, now, id)
    .run();
}

export async function getJobFull(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first<Record<string, unknown>>();
}

/**
 * Same column set as dashboard list rows; used by bucket list and id-lookup helpers.
 * `j.description` is intentionally *not* selected — it's KB per row and is no longer needed for
 * salary parsing (that now runs at ingest time and is cached on `salary_monthly_eur` /
 * `salary_display_eur`). `normalized_json` is still selected for ingestion-facts / API-raw panels.
 */
const DASHBOARD_LIST_COLUMNS = `id, title, company, job_url, apply_url, salary_raw, salary_min, salary_max,
              salary_currency, salary_monthly_eur, salary_display_eur, fit_score, recommendation,
              reasons_to_apply, risks, r2_cv_key, r2_cover_key, status, hard_reject_reasons,
              scoring_notes,
              created_at,
              json_extract(normalized_json, '$.country') AS country_name,
              json_extract(normalized_json, '$.employmentType') AS employment_type,
              json_extract(normalized_json, '$.workplaceType') AS workplace_type,
              json_extract(normalized_json, '$.searchQuery') AS search_query,
              CAST(json_extract(normalized_json, '$.searchTier') AS INTEGER) AS search_tier,
              json_extract(scoring_json, '$.position_summary') AS position_summary,
              normalized_json AS normalized_json,
              json_extract(normalized_json, '$.postedAtUnix') AS posted_at_unix,
              json_extract(normalized_json, '$.apiFetchedAtUnix') AS api_fetched_at_unix`;

const DASHBOARD_LIST_COLUMNS_ALIASED = `j.id AS id, j.title AS title, j.company AS company, j.job_url AS job_url,
              j.apply_url AS apply_url, j.salary_raw AS salary_raw,
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

async function listDashboardListRowsForJobIds(db: D1Database, ids: string[]): Promise<DashboardListRow[]> {
  if (ids.length === 0) return [];
  const chunkSize = 80;
  const byId = new Map<string, DashboardListRow>();
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize);
    const ph = slice.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT ${DASHBOARD_LIST_COLUMNS} FROM jobs WHERE id IN (${ph})`)
      .bind(...slice)
      .all<DashboardListRow>();
    for (const row of results ?? []) byId.set(row.id, row);
  }
  return ids.map((id) => byId.get(id)).filter((r): r is DashboardListRow => r != null);
}

/**
 * Active list is capped at 200 rows by `updated_at`, so starred jobs can fall off that page while still
 * appearing on the Favorites tab. This prepends any active favorited rows that are missing from that page.
 */
export async function listActiveJobsForDashboardWithFavoriteOverflow(db: D1Database): Promise<DashboardListRow[]> {
  const top = await listJobsByDashboardBucket(db, "active");
  const topIds = new Set(top.map((r) => r.id));

  const { results: favOrder } = await db
    .prepare(
      `SELECT f.job_id AS job_id FROM job_favorites f
       INNER JOIN jobs j ON j.id = f.job_id
       WHERE j.dash_bucket = 'active'
       ORDER BY f.created_at DESC`,
    )
    .all<{ job_id: string }>();

  const missingIds: string[] = [];
  const seen = new Set<string>();
  for (const r of favOrder ?? []) {
    const id = r.job_id;
    if (!id || topIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    missingIds.push(id);
  }

  if (missingIds.length === 0) return top;

  const extra = await listDashboardListRowsForJobIds(db, missingIds);
  return [...extra, ...top];
}

export async function listJobsByDashboardBucket(
  db: D1Database,
  bucket: "active" | "accepted" | "denied" | "filtered",
): Promise<DashboardListRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${DASHBOARD_LIST_COLUMNS}
       FROM jobs WHERE dash_bucket = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 200`,
    )
    .bind(bucket)
    .all<DashboardListRow>();
  return results ?? [];
}

/** Active jobs marked as favorites (same columns as {@link listJobsByDashboardBucket}). */
export async function listFavoriteJobsForDashboard(db: D1Database): Promise<DashboardListRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${DASHBOARD_LIST_COLUMNS_ALIASED}
       FROM jobs j
       INNER JOIN job_favorites f ON f.job_id = j.id
       WHERE j.dash_bucket = 'active'
       ORDER BY f.created_at DESC
       LIMIT 200`,
    )
    .all<DashboardListRow>();
  return results ?? [];
}

async function listAllJobsByDashboardBucket(
  db: D1Database,
  bucket: "active" | "accepted" | "denied" | "filtered",
): Promise<DashboardListRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${DASHBOARD_LIST_COLUMNS}
       FROM jobs WHERE dash_bucket = ?`,
    )
    .bind(bucket)
    .all<DashboardListRow>();
  return results ?? [];
}

async function listAllFavoriteJobsForDashboard(db: D1Database): Promise<DashboardListRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${DASHBOARD_LIST_COLUMNS_ALIASED}
       FROM jobs j
       INNER JOIN job_favorites f ON f.job_id = j.id
       WHERE j.dash_bucket = 'active'`,
    )
    .all<DashboardListRow>();
  return results ?? [];
}

type DashboardJobListSqlValue = string | number;

type DashboardJobListCursorFieldKey =
  | "salary_null_rank"
  | "salary_value"
  | "ingest"
  | "posted"
  | "relevance"
  | "source_rank"
  | "id";

type DashboardJobListSortDirection = "ASC" | "DESC";

type DashboardJobListOrderField = {
  key: DashboardJobListCursorFieldKey;
  expr: string;
  direction: DashboardJobListSortDirection;
};

type DashboardJobListScope = {
  fromSql: string;
  whereClauses: string[];
  params: DashboardJobListSqlValue[];
};

type DashboardJobListQuerySpec = DashboardJobListScope & {
  whereSql: string;
  orderBySql: string;
  orderFields: DashboardJobListOrderField[];
};

const DASHBOARD_JOB_SOURCE_EXPR = `CASE
  WHEN LOWER(COALESCE(j.job_url, '') || ' ' || COALESCE(j.apply_url, '')) LIKE '%linkedin.com%' THEN 'linkedin'
  WHEN LOWER(COALESCE(j.job_url, '') || ' ' || COALESCE(j.apply_url, '')) LIKE '%google.com%'
    OR LOWER(COALESCE(j.job_url, '') || ' ' || COALESCE(j.apply_url, '')) LIKE '%jobs.google%' THEN 'google'
  ELSE 'other'
END`;

const DASHBOARD_JOB_RECOMMENDATION_NORM_EXPR = `LOWER(REPLACE(TRIM(COALESCE(j.recommendation, '')), ' ', '_'))`;

/**
 * Keep half-processed imports off the main dashboard lists until a final recommendation is stored.
 * Otherwise they look like filtered rows without any explanation while OpenAI is still running (or failed).
 */
const DASHBOARD_JOB_VISIBLE_ACTIVE_SCOPE_EXPR = `j.dash_bucket = 'active'
  AND ${DASHBOARD_JOB_RECOMMENDATION_NORM_EXPR} IN ('high_priority_review', 'review', 'low_priority_review')`;

/**
 * Older pipeline failures can strand rows as `status='imported'` with no recommendation.
 * Treat only stale imports as filtered so in-flight scoring work stays hidden.
 */
const DASHBOARD_JOB_STALE_IMPORTED_SCOPE_EXPR = `(
  COALESCE(j.status, '') = 'imported'
  AND ${DASHBOARD_JOB_RECOMMENDATION_NORM_EXPR} = ''
  AND (CAST(strftime('%s', 'now') AS INTEGER) - COALESCE(NULLIF(j.updated_at, 0), j.created_at, 0)) >= 600
)`;

const DASHBOARD_JOB_FILTERED_SCOPE_EXPR = `(
  j.dash_bucket = 'filtered'
  OR COALESCE(j.status, '') IN ('hard_rejected', 'rejected_by_ai')
  OR ${DASHBOARD_JOB_RECOMMENDATION_NORM_EXPR} = 'reject'
  OR ${DASHBOARD_JOB_STALE_IMPORTED_SCOPE_EXPR}
)`;

const DASHBOARD_JOB_RELEVANCE_KEY_EXPR = `CASE
  WHEN COALESCE(j.status, '') = 'failed' THEN 'failed'
  WHEN ${DASHBOARD_JOB_RECOMMENDATION_NORM_EXPR} = 'high_priority_review' THEN 'high'
  WHEN ${DASHBOARD_JOB_RECOMMENDATION_NORM_EXPR} = 'review' THEN 'medium'
  WHEN ${DASHBOARD_JOB_RECOMMENDATION_NORM_EXPR} = 'low_priority_review' THEN 'low'
  ELSE 'none'
END`;

const DASHBOARD_JOB_RELEVANCE_SCORE_SORT_EXPR = `COALESCE(j.fit_score, 0)`;

const DASHBOARD_JOB_COUNTRY_KEY_EXPR = `CASE
  WHEN TRIM(COALESCE(json_extract(j.normalized_json, '$.country'), '')) = '' THEN '(None)'
  ELSE TRIM(COALESCE(json_extract(j.normalized_json, '$.country'), ''))
END`;

const DASHBOARD_JOB_SEARCH_TIER_EXPR = `CASE
  WHEN CAST(json_extract(j.normalized_json, '$.searchTier') AS INTEGER) IN (1, 2)
    THEN CAST(json_extract(j.normalized_json, '$.searchTier') AS INTEGER)
  ELSE NULL
END`;

const DASHBOARD_JOB_ROLE_QUERY_KEY_EXPR = `json_object(
  't',
  ${DASHBOARD_JOB_SEARCH_TIER_EXPR},
  'q',
  TRIM(COALESCE(json_extract(j.normalized_json, '$.searchQuery'), ''))
)`;

const DASHBOARD_JOB_EMPLOYMENT_NORM_EXPR = `REPLACE(REPLACE(LOWER(COALESCE(json_extract(j.normalized_json, '$.employmentType'), '')), '-', '_'), ' ', '_')`;

const DASHBOARD_JOB_CONTRACT_BUCKET_EXPR = `CASE
  WHEN ${DASHBOARD_JOB_EMPLOYMENT_NORM_EXPR} LIKE '%full%' THEN 'ft'
  WHEN ${DASHBOARD_JOB_EMPLOYMENT_NORM_EXPR} LIKE '%partner%' THEN 'other'
  WHEN ${DASHBOARD_JOB_EMPLOYMENT_NORM_EXPR} LIKE '%part_time%' OR ${DASHBOARD_JOB_EMPLOYMENT_NORM_EXPR} LIKE '%parttime%' THEN 'pt'
  WHEN ${DASHBOARD_JOB_EMPLOYMENT_NORM_EXPR} LIKE '%part%' THEN 'pt'
  WHEN ${DASHBOARD_JOB_EMPLOYMENT_NORM_EXPR} LIKE '%temp%'
    OR ${DASHBOARD_JOB_EMPLOYMENT_NORM_EXPR} LIKE '%contract%'
    OR ${DASHBOARD_JOB_EMPLOYMENT_NORM_EXPR} LIKE '%intern%'
    OR ${DASHBOARD_JOB_EMPLOYMENT_NORM_EXPR} LIKE '%freelance%' THEN 'temp'
  ELSE 'other'
END`;

const DASHBOARD_JOB_SEARCH_HAYSTACK_EXPR = `LOWER(COALESCE(j.title, '') || ' ' || COALESCE(j.company, ''))`;

const DASHBOARD_JOB_INGEST_SORT_EXPR = `CASE
  WHEN CAST(json_extract(j.normalized_json, '$.apiFetchedAtUnix') AS INTEGER) > 0
    THEN CAST(json_extract(j.normalized_json, '$.apiFetchedAtUnix') AS INTEGER)
  WHEN j.created_at > 0 THEN j.created_at
  WHEN CAST(json_extract(j.normalized_json, '$.postedAtUnix') AS INTEGER) > 0
    THEN CAST(json_extract(j.normalized_json, '$.postedAtUnix') AS INTEGER)
  ELSE 0
END`;

const DASHBOARD_JOB_FILTER_FETCH_AGE_SECONDS: Record<Exclude<DashboardJobListFilterFetchAge, "off">, number> = {
  "24h": 86400,
  "2d": 172800,
  "3d": 259200,
  "7d": 604800,
  "14d": 1209600,
  "21d": 1814400,
};

const DASHBOARD_JOB_LISTING_POSTED_SORT_EXPR = `CASE
  WHEN CAST(json_extract(j.normalized_json, '$.postedAtUnix') AS INTEGER) > 0
    THEN CAST(json_extract(j.normalized_json, '$.postedAtUnix') AS INTEGER)
  ELSE 0
END`;

function dashboardJobListScope(tab: DashboardJobListTab): DashboardJobListScope {
  if (tab === "favorites") {
    return {
      fromSql: `FROM jobs j INNER JOIN job_favorites f ON f.job_id = j.id`,
      whereClauses: [DASHBOARD_JOB_VISIBLE_ACTIVE_SCOPE_EXPR],
      params: [],
    };
  }
  if (tab === "active") {
    return {
      fromSql: `FROM jobs j`,
      whereClauses: [DASHBOARD_JOB_VISIBLE_ACTIVE_SCOPE_EXPR],
      params: [],
    };
  }
  if (tab === "filtered") {
    return {
      fromSql: `FROM jobs j`,
      whereClauses: [DASHBOARD_JOB_FILTERED_SCOPE_EXPR],
      params: [],
    };
  }
  return {
    fromSql: `FROM jobs j`,
    whereClauses: [`j.dash_bucket = ?`],
    params: [tab],
  };
}

function dashboardJobListPlaceholders(n: number): string {
  return new Array(n).fill("?").join(",");
}

function dashboardJobListCursorSelectAlias(key: DashboardJobListCursorFieldKey): string {
  return `__cursor_${key}`;
}

function buildDashboardJobListCursorSelectSql(orderFields: DashboardJobListOrderField[]): string {
  const seen = new Set<DashboardJobListCursorFieldKey>();
  const selects: string[] = [];
  for (const field of orderFields) {
    if (field.key === "id" || seen.has(field.key)) continue;
    seen.add(field.key);
    selects.push(`${field.expr} AS ${dashboardJobListCursorSelectAlias(field.key)}`);
  }
  return selects.join(", ");
}

function buildDashboardJobListCursorFilterClause(
  orderFields: DashboardJobListOrderField[],
  cursor: DashboardJobListCursor | null | undefined,
): { sql: string; params: DashboardJobListSqlValue[] } {
  if (!cursor) return { sql: "", params: [] };
  if (typeof cursor.id !== "string" || cursor.id.length === 0) {
    return { sql: "", params: [] };
  }

  const clauses: string[] = [];
  const params: DashboardJobListSqlValue[] = [];

  for (let i = 0; i < orderFields.length; i++) {
    const conjuncts: string[] = [];
    const conjunctParams: DashboardJobListSqlValue[] = [];

    for (let j = 0; j < i; j++) {
      const prev = orderFields[j]!;
      const prevValue = cursor[prev.key];
      if (typeof prevValue !== "string" && typeof prevValue !== "number") {
        return { sql: "", params: [] };
      }
      conjuncts.push(`${prev.expr} = ?`);
      conjunctParams.push(prevValue);
    }

    const field = orderFields[i]!;
    const fieldValue = cursor[field.key];
    if (typeof fieldValue !== "string" && typeof fieldValue !== "number") {
      return { sql: "", params: [] };
    }

    conjuncts.push(`${field.expr} ${field.direction === "ASC" ? ">" : "<"} ?`);
    conjunctParams.push(fieldValue);

    clauses.push(`(${conjuncts.join(" AND ")})`);
    params.push(...conjunctParams);
  }

  return {
    sql: clauses.length ? `(${clauses.join(" OR ")})` : "",
    params,
  };
}

function buildDashboardJobListCursorFromRow(
  row: DashboardListRow & Record<string, unknown>,
  orderFields: DashboardJobListOrderField[],
): DashboardJobListCursor | null {
  const cursor: DashboardJobListCursor = {};

  for (const field of orderFields) {
    if (field.key === "id") {
      if (typeof row.id !== "string" || row.id.length === 0) return null;
      cursor.id = row.id;
      continue;
    }

    const raw = row[dashboardJobListCursorSelectAlias(field.key)];
    const numeric = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(numeric)) return null;
    cursor[field.key] = numeric;
  }

  return typeof cursor.id === "string" && cursor.id.length > 0 ? cursor : null;
}

function dashboardJobListSourceRankExpr(mode: DashboardJobListSortSrc): string {
  if (mode === "linkedin-first") {
    return `CASE ${DASHBOARD_JOB_SOURCE_EXPR} WHEN 'linkedin' THEN 0 WHEN 'google' THEN 1 ELSE 2 END`;
  }
  if (mode === "google-first") {
    return `CASE ${DASHBOARD_JOB_SOURCE_EXPR} WHEN 'google' THEN 0 WHEN 'linkedin' THEN 1 ELSE 2 END`;
  }
  return `CASE ${DASHBOARD_JOB_SOURCE_EXPR} WHEN 'other' THEN 0 WHEN 'linkedin' THEN 1 ELSE 2 END`;
}

/**
 * Salary sort expression — trivially the persisted cache column. The earlier SQL re-derived
 * USD/GBP/EUR + annual/hourly/monthly heuristics (slow and required FX in every query build);
 * we now trust `jobs.salary_monthly_eur` (written by `upsertNormalizedJob` / `updateNormalizedJobSalary`,
 * or backfilled in the cron).
 */
const DASHBOARD_JOB_SALARY_SORT_EXPR = `j.salary_monthly_eur`;

function buildDashboardJobListQuerySpec(
  tab: DashboardJobListTab,
  prefs: DashboardJobListPrefs,
  cursor?: DashboardJobListCursor | null,
): DashboardJobListQuerySpec {
  const scope = dashboardJobListScope(tab);
  const whereClauses = [...scope.whereClauses];
  const params: DashboardJobListSqlValue[] = [...scope.params];

  const enabledSources = (["linkedin", "google", "other"] as const).filter((key) => prefs.src[key]);
  if (enabledSources.length === 0) {
    whereClauses.push(`1 = 0`);
  } else if (enabledSources.length < 3) {
    whereClauses.push(`${DASHBOARD_JOB_SOURCE_EXPR} IN (${dashboardJobListPlaceholders(enabledSources.length)})`);
    params.push(...enabledSources);
  }

  const enabledRel = (["high", "medium", "low", "failed", "none"] as const).filter((key) => prefs.rel[key]);
  if (enabledRel.length === 0) {
    whereClauses.push(`1 = 0`);
  } else if (enabledRel.length < 5) {
    whereClauses.push(`${DASHBOARD_JOB_RELEVANCE_KEY_EXPR} IN (${dashboardJobListPlaceholders(enabledRel.length)})`);
    params.push(...enabledRel);
  }

  const enabledContracts = (["ft", "pt", "temp", "other"] as const).filter((key) => prefs.contract[key]);
  if (enabledContracts.length === 0) {
    whereClauses.push(`1 = 0`);
  } else if (enabledContracts.length < 4) {
    whereClauses.push(`${DASHBOARD_JOB_CONTRACT_BUCKET_EXPR} IN (${dashboardJobListPlaceholders(enabledContracts.length)})`);
    params.push(...enabledContracts);
  }

  const excludedCountries = Object.entries(prefs.countries)
    .filter(([, value]) => value === false)
    .map(([key]) => key);
  if (excludedCountries.length > 0) {
    whereClauses.push(
      `${DASHBOARD_JOB_COUNTRY_KEY_EXPR} NOT IN (${dashboardJobListPlaceholders(excludedCountries.length)})`,
    );
    params.push(...excludedCountries);
  }

  const excludedRoleQueries = Object.entries(prefs.roleQueries)
    .filter(([, value]) => value === false)
    .map(([key]) => key);
  if (excludedRoleQueries.length > 0) {
    whereClauses.push(
      `${DASHBOARD_JOB_ROLE_QUERY_KEY_EXPR} NOT IN (${dashboardJobListPlaceholders(excludedRoleQueries.length)})`,
    );
    params.push(...excludedRoleQueries);
  }

  const searchTerms = String(prefs.listSearch ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  for (const term of searchTerms) {
    whereClauses.push(`${DASHBOARD_JOB_SEARCH_HAYSTACK_EXPR} LIKE ?`);
    params.push(`%${term}%`);
  }

  if (prefs.filterFetchAge !== "off") {
    const winSec = DASHBOARD_JOB_FILTER_FETCH_AGE_SECONDS[prefs.filterFetchAge];
    if (typeof winSec === "number" && Number.isFinite(winSec) && winSec > 0) {
      whereClauses.push(
        `${DASHBOARD_JOB_INGEST_SORT_EXPR} >= CAST(strftime('%s', 'now') AS INTEGER) - ?`,
      );
      params.push(winSec);
    }
  }

  const orderFields: DashboardJobListOrderField[] = [];
  if (prefs.sortSalary !== "off") {
    const salaryExpr = DASHBOARD_JOB_SALARY_SORT_EXPR;
    orderFields.push({
      key: "salary_null_rank",
      expr: `CASE WHEN ${salaryExpr} IS NULL THEN ${prefs.sortSalary === "high-first" ? 1 : 0} ELSE ${prefs.sortSalary === "high-first" ? 0 : 1} END`,
      direction: "ASC",
    });
    orderFields.push({
      key: "salary_value",
      expr: `COALESCE(${salaryExpr}, 0)`,
      direction: prefs.sortSalary === "high-first" ? "DESC" : "ASC",
    });
  } else if (prefs.sortDate !== "off") {
    const direction = prefs.sortDate === "new-first" ? "DESC" : "ASC";
    orderFields.push({ key: "ingest", expr: DASHBOARD_JOB_INGEST_SORT_EXPR, direction });
    orderFields.push({ key: "posted", expr: DASHBOARD_JOB_LISTING_POSTED_SORT_EXPR, direction });
  } else if (prefs.sortRel === "high-first") {
    orderFields.push({ key: "relevance", expr: DASHBOARD_JOB_RELEVANCE_SCORE_SORT_EXPR, direction: "DESC" });
  } else if (prefs.sortRel === "low-first") {
    orderFields.push({ key: "relevance", expr: DASHBOARD_JOB_RELEVANCE_SCORE_SORT_EXPR, direction: "ASC" });
  }

  if (prefs.sortSrc !== "default") {
    orderFields.push({ key: "source_rank", expr: dashboardJobListSourceRankExpr(prefs.sortSrc), direction: "ASC" });
  }

  if (prefs.sortSalary !== "off" || prefs.sortDate !== "off") {
    if (prefs.sortRel === "high-first") {
      orderFields.push({ key: "relevance", expr: DASHBOARD_JOB_RELEVANCE_SCORE_SORT_EXPR, direction: "DESC" });
    } else if (prefs.sortRel === "low-first") {
      orderFields.push({ key: "relevance", expr: DASHBOARD_JOB_RELEVANCE_SCORE_SORT_EXPR, direction: "ASC" });
    }
  }

  orderFields.push({ key: "id", expr: "j.id", direction: "ASC" });

  const cursorClause = buildDashboardJobListCursorFilterClause(orderFields, cursor);
  if (cursorClause.sql) {
    whereClauses.push(cursorClause.sql);
    params.push(...cursorClause.params);
  }

  return {
    fromSql: scope.fromSql,
    whereClauses,
    whereSql: whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "",
    params,
    orderBySql: orderFields.map((field) => `${field.expr} ${field.direction}`).join(", "),
    orderFields,
  };
}

async function countDashboardJobListRows(db: D1Database, scope: DashboardJobListScope): Promise<number> {
  const whereSql = scope.whereClauses.length ? `WHERE ${scope.whereClauses.join(" AND ")}` : "";
  const row = await db
    .prepare(`SELECT COUNT(*) AS count ${scope.fromSql} ${whereSql}`)
    .bind(...scope.params)
    .first<{ count: number | string }>();
  return Number(row?.count ?? 0) || 0;
}

async function listDashboardJobFacetCountries(db: D1Database, scope: DashboardJobListScope): Promise<string[]> {
  const whereSql = scope.whereClauses.length ? `WHERE ${scope.whereClauses.join(" AND ")}` : "";
  const { results } = await db
    .prepare(
      `SELECT DISTINCT ${DASHBOARD_JOB_COUNTRY_KEY_EXPR} AS value
       ${scope.fromSql}
       ${whereSql}
       ORDER BY CASE WHEN ${DASHBOARD_JOB_COUNTRY_KEY_EXPR} = '(None)' THEN 1 ELSE 0 END ASC,
                ${DASHBOARD_JOB_COUNTRY_KEY_EXPR} ASC`,
    )
    .bind(...scope.params)
    .all<{ value: string | null }>();
  return (results ?? []).map((row) => String(row.value ?? "(None)"));
}

async function listDashboardJobFacetRoleQueries(db: D1Database, scope: DashboardJobListScope): Promise<string[]> {
  const whereSql = scope.whereClauses.length ? `WHERE ${scope.whereClauses.join(" AND ")}` : "";
  const { results } = await db
    .prepare(
      `SELECT DISTINCT ${DASHBOARD_JOB_ROLE_QUERY_KEY_EXPR} AS value,
              CASE WHEN ${DASHBOARD_JOB_SEARCH_TIER_EXPR} IS NULL THEN 99 ELSE ${DASHBOARD_JOB_SEARCH_TIER_EXPR} END AS tier_sort,
              TRIM(COALESCE(json_extract(j.normalized_json, '$.searchQuery'), '')) AS query_sort
       ${scope.fromSql}
       ${whereSql}
       ORDER BY tier_sort ASC, query_sort ASC`,
    )
    .bind(...scope.params)
    .all<{ value: string | null }>();
  return (results ?? []).map((row) => String(row.value ?? '{"t":null,"q":""}'));
}

function dashboardRowLogo(row: DashboardListRow): ListingLogoKind {
  return listingLogoFromUrls(row.job_url ?? "", row.apply_url ?? "");
}

function dashboardRecommendationKey(row: DashboardListRow): "high" | "medium" | "low" | "failed" | "none" {
  if (String(row.status ?? "").trim().toLowerCase() === "failed") return "failed";
  const v = String(row.recommendation ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (v === "high_priority_review") return "high";
  if (v === "review") return "medium";
  if (v === "low_priority_review") return "low";
  return "none";
}

function dashboardRecommendationRank(row: DashboardListRow): number {
  const key = dashboardRecommendationKey(row);
  if (key === "failed") return 4;
  if (key === "high") return 3;
  if (key === "medium") return 2;
  if (key === "low") return 1;
  return 0;
}

function dashboardCountryFacetKey(row: DashboardListRow): string {
  return String(row.country_name ?? "").trim() || "(None)";
}

function dashboardRoleQueryKey(row: DashboardListRow): string {
  const tier = row.search_tier === 1 || row.search_tier === 2 ? row.search_tier : null;
  const query = String(row.search_query ?? "").trim();
  return JSON.stringify({ t: tier, q: query });
}

function dashboardRoleQueryKeyCompare(a: string, b: string): number {
  try {
    const pa = JSON.parse(a) as { t?: number | null; q?: string | null };
    const pb = JSON.parse(b) as { t?: number | null; q?: string | null };
    const ta = pa.t == null ? 99 : pa.t;
    const tb = pb.t == null ? 99 : pb.t;
    if (ta !== tb) return ta - tb;
    return String(pa.q ?? "").localeCompare(String(pb.q ?? ""));
  } catch {
    return String(a).localeCompare(String(b));
  }
}

function dashboardContractBucket(row: DashboardListRow): "ft" | "pt" | "temp" | "other" {
  const normalized = String(row.employment_type ?? "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (normalized.includes("full")) return "ft";
  if (normalized.includes("partner")) return "other";
  if (normalized.includes("part_time") || normalized.includes("parttime")) return "pt";
  if (normalized.includes("part")) return "pt";
  if (
    normalized.includes("temp") ||
    normalized.includes("contract") ||
    normalized.includes("intern") ||
    normalized.includes("freelance")
  ) {
    return "temp";
  }
  return "other";
}

function dashboardSearchMatches(row: DashboardListRow, searchLower: string): boolean {
  if (!searchLower) return true;
  const haystack = `${String(row.title ?? "")} ${String(row.company ?? "")}`.toLowerCase();
  const parts = searchLower.split(/\s+/).filter(Boolean);
  for (const part of parts) {
    if (!haystack.includes(part)) return false;
  }
  return true;
}

function dashboardSourceRank(logo: ListingLogoKind, mode: DashboardJobListSortSrc): number {
  const base = logo === "linkedin" ? 0 : logo === "google" ? 1 : 2;
  if (mode === "linkedin-first") return base;
  if (mode === "google-first") return base === 0 ? 1 : base === 1 ? 0 : 2;
  if (mode === "other-first") return base === 2 ? 0 : base === 0 ? 1 : 2;
  return base;
}

function dashboardListingPostedSortKey(row: DashboardListRow): number {
  return typeof row.posted_at_unix === "number" && Number.isFinite(row.posted_at_unix) && row.posted_at_unix > 0
    ? row.posted_at_unix
    : 0;
}

function dashboardIngestSortKey(row: DashboardListRow): number {
  if (
    typeof row.api_fetched_at_unix === "number" &&
    Number.isFinite(row.api_fetched_at_unix) &&
    row.api_fetched_at_unix > 0
  ) {
    return row.api_fetched_at_unix;
  }
  return row.created_at > 0 ? row.created_at : dashboardListingPostedSortKey(row);
}

function buildDashboardJobListFacets(rows: DashboardListRow[]): DashboardJobListFacets {
  const countries = new Set<string>();
  const roleQueries = new Set<string>();
  for (const row of rows) {
    countries.add(dashboardCountryFacetKey(row));
    roleQueries.add(dashboardRoleQueryKey(row));
  }
  const countryList = [...countries].sort((a, b) => {
    if (a === "(None)") return 1;
    if (b === "(None)") return -1;
    return a.localeCompare(b);
  });
  const roleQueryList = [...roleQueries].sort(dashboardRoleQueryKeyCompare);
  return { countries: countryList, roleQueries: roleQueryList };
}

function filterDashboardJobRows(rows: DashboardListRow[], prefs: DashboardJobListPrefs): DashboardListRow[] {
  const searchLower = String(prefs.listSearch ?? "").trim().toLowerCase();
  const hasRoleQueryPrefs = Object.keys(prefs.roleQueries).length > 0;
  return rows.filter((row) => {
    const logo = dashboardRowLogo(row);
    if (!prefs.src[logo]) return false;

    const relKey = dashboardRecommendationKey(row);
    if (relKey === "high" && !prefs.rel.high) return false;
    if (relKey === "medium" && !prefs.rel.medium) return false;
    if (relKey === "low" && !prefs.rel.low) return false;
    if (relKey === "failed" && !prefs.rel.failed) return false;
    if (relKey === "none" && !prefs.rel.none) return false;

    const countryKey = dashboardCountryFacetKey(row);
    if (Object.prototype.hasOwnProperty.call(prefs.countries, countryKey) && !prefs.countries[countryKey]) {
      return false;
    }

    const contractKey = dashboardContractBucket(row);
    if (contractKey === "ft" && !prefs.contract.ft) return false;
    if (contractKey === "pt" && !prefs.contract.pt) return false;
    if (contractKey === "temp" && !prefs.contract.temp) return false;
    if (contractKey === "other" && !prefs.contract.other) return false;

    const roleQueryKey = dashboardRoleQueryKey(row);
    if (
      hasRoleQueryPrefs &&
      Object.prototype.hasOwnProperty.call(prefs.roleQueries, roleQueryKey) &&
      !prefs.roleQueries[roleQueryKey]
    ) {
      return false;
    }

    if (prefs.filterFetchAge !== "off") {
      const winSec = DASHBOARD_JOB_FILTER_FETCH_AGE_SECONDS[prefs.filterFetchAge];
      if (typeof winSec === "number" && Number.isFinite(winSec) && winSec > 0) {
        const now = Math.floor(Date.now() / 1000);
        if (dashboardIngestSortKey(row) < now - winSec) return false;
      }
    }

    return dashboardSearchMatches(row, searchLower);
  });
}

/**
 * Lightweight in-memory caches keyed per-tab. TTL is short so dashboard mutations quickly reflect,
 * but facet DISTINCT and per-bucket COUNT(*) over 8k rows don't rerun on every scroll/filter tweak.
 * Invalidated by {@link invalidateDashboardListMemoCaches} after any mutation.
 */
const TAB_SCOPE_CACHE_TTL_MS = 30_000;

type TabScopeTotalCache = { expiresAt: number; total: number };
type TabFacetCache = {
  expiresAt: number;
  countries: string[];
  roleQueries: string[];
};

const tabScopeTotalCache = new Map<DashboardJobListTab, TabScopeTotalCache>();
const tabFacetCache = new Map<DashboardJobListTab, TabFacetCache>();

export function invalidateDashboardListMemoCaches(): void {
  tabScopeTotalCache.clear();
  tabFacetCache.clear();
}

const DASHBOARD_STALE_IMPORTED_AGE_SEC = 600;

async function surfaceStaleImportedJobsAsFiltered(db: D1Database): Promise<number> {
  const staleBefore = Math.floor(Date.now() / 1000) - DASHBOARD_STALE_IMPORTED_AGE_SEC;
  const { results } = await db
    .prepare(
      `UPDATE jobs SET
         status = 'failed',
         dash_bucket = 'filtered',
         dash_moved_at = NULL,
         fit_score = NULL,
         recommendation = NULL,
         scoring_json = NULL,
         reasons_to_apply = NULL,
         risks = NULL,
         hard_reject_reasons = NULL,
         scoring_notes = CASE
           WHEN TRIM(COALESCE(scoring_notes, '')) != '' THEN scoring_notes
           WHEN hard_filter_passed = 1
             THEN 'Hard filters passed, but the pipeline stopped before AI scoring saved a final recommendation.'
           WHEN hard_filter_passed = 0
             THEN 'The pipeline stopped before the hard-filter rejection reason could be saved.'
           ELSE 'The pipeline stopped before this job reached a final dashboard state.'
         END
       WHERE COALESCE(status, '') = 'imported'
         AND COALESCE(dash_bucket, 'active') = 'active'
         AND LOWER(REPLACE(TRIM(COALESCE(recommendation, '')), ' ', '_')) = ''
         AND COALESCE(NULLIF(updated_at, 0), created_at, 0) <= ?
       RETURNING id`,
    )
    .bind(staleBefore)
    .all<{ id: string }>();
  return (results ?? []).length;
}

async function getCachedTabScopeTotal(
  db: D1Database,
  tab: DashboardJobListTab,
  scope: DashboardJobListScope,
): Promise<number> {
  const cached = tabScopeTotalCache.get(tab);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.total;
  const total = await countDashboardJobListRows(db, scope);
  tabScopeTotalCache.set(tab, { expiresAt: now + TAB_SCOPE_CACHE_TTL_MS, total });
  return total;
}

async function getCachedTabFacets(
  db: D1Database,
  tab: DashboardJobListTab,
  scope: DashboardJobListScope,
): Promise<{ countries: string[]; roleQueries: string[] }> {
  const cached = tabFacetCache.get(tab);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return { countries: cached.countries, roleQueries: cached.roleQueries };
  }
  const [countries, roleQueries] = await Promise.all([
    listDashboardJobFacetCountries(db, scope),
    listDashboardJobFacetRoleQueries(db, scope),
  ]);
  tabFacetCache.set(tab, {
    expiresAt: now + TAB_SCOPE_CACHE_TTL_MS,
    countries,
    roleQueries,
  });
  return { countries, roleQueries };
}

export async function queryDashboardJobListPage(
  db: D1Database,
  tab: DashboardJobListTab,
  prefs: DashboardJobListPrefs,
  cursor: DashboardJobListCursor | null,
  limit: number,
): Promise<DashboardJobListPage> {
  if (tab === "active" || tab === "favorites" || tab === "filtered") {
    const surfaced = await surfaceStaleImportedJobsAsFiltered(db);
    if (surfaced > 0) invalidateDashboardListMemoCaches();
  }
  const scope = dashboardJobListScope(tab);
  const filteredQuery = buildDashboardJobListQuerySpec(tab, prefs);
  const pageQuery = cursor ? buildDashboardJobListQuerySpec(tab, prefs, cursor) : filteredQuery;
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const cursorSelectSql = buildDashboardJobListCursorSelectSql(pageQuery.orderFields);
  const selectSql = cursorSelectSql
    ? `${DASHBOARD_LIST_COLUMNS_ALIASED}, ${cursorSelectSql}`
    : DASHBOARD_LIST_COLUMNS_ALIASED;
  const [totalUnfiltered, totalMatching, facets, pageResult] = await Promise.all([
    getCachedTabScopeTotal(db, tab, scope),
    countDashboardJobListRows(db, filteredQuery),
    getCachedTabFacets(db, tab, scope),
    db
      .prepare(
        `SELECT ${selectSql}
         ${pageQuery.fromSql}
         ${pageQuery.whereSql}
         ORDER BY ${pageQuery.orderBySql}
         LIMIT ?`,
      )
      .bind(...pageQuery.params, safeLimit + 1)
      .all<DashboardListRow & Record<string, unknown>>(),
  ]);
  const pageRowsRaw = pageResult.results ?? [];
  const hasMore = pageRowsRaw.length > safeLimit;
  const pageRows = hasMore ? pageRowsRaw.slice(0, safeLimit) : pageRowsRaw;
  const lastRow = pageRows.length > 0 ? pageRows[pageRows.length - 1]! : null;
  return {
    rows: pageRows,
    totalMatching,
    totalUnfiltered,
    hasMore,
    nextCursor: hasMore && lastRow ? buildDashboardJobListCursorFromRow(lastRow, pageQuery.orderFields) : null,
    facets,
  };
}

export async function queryDashboardJobListIds(
  db: D1Database,
  tab: DashboardJobListTab,
  prefs: DashboardJobListPrefs,
): Promise<string[]> {
  if (tab === "active" || tab === "favorites" || tab === "filtered") {
    const surfaced = await surfaceStaleImportedJobsAsFiltered(db);
    if (surfaced > 0) invalidateDashboardListMemoCaches();
  }
  const query = buildDashboardJobListQuerySpec(tab, prefs);
  const { results } = await db
    .prepare(
      `SELECT j.id AS id
       ${query.fromSql}
       ${query.whereSql}
       ORDER BY ${query.orderBySql}`,
    )
    .bind(...query.params)
    .all<{ id: string }>();
  return (results ?? []).map((row) => row.id).filter((id): id is string => typeof id === "string" && id.length > 0);
}

export async function getFavoriteJobIdsSet(db: D1Database): Promise<Set<string>> {
  const { results } = await db.prepare(`SELECT job_id FROM job_favorites`).all<{ job_id: string }>();
  const s = new Set<string>();
  for (const r of results ?? []) s.add(r.job_id);
  return s;
}

export async function setJobFavorite(
  db: D1Database,
  jobId: string,
  favorite: boolean,
  now: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await getJob(db, jobId);
  if (!row) return { ok: false, error: "not_found" };
  if (row.dash_bucket !== "active") return { ok: false, error: "not_active" };
  if (favorite) {
    await db
      .prepare(
        `INSERT INTO job_favorites (job_id, created_at) VALUES (?, ?)
         ON CONFLICT(job_id) DO UPDATE SET created_at = excluded.created_at`,
      )
      .bind(jobId, now)
      .run();
  } else {
    await db.prepare(`DELETE FROM job_favorites WHERE job_id = ?`).bind(jobId).run();
  }
  return { ok: true };
}

async function deleteFavoriteForJob(db: D1Database, jobId: string): Promise<void> {
  await db.prepare(`DELETE FROM job_favorites WHERE job_id = ?`).bind(jobId).run();
}

export async function setDashboardDecision(
  db: D1Database,
  id: string,
  decision: "accepted" | "denied",
  now: number,
): Promise<void> {
  const status = decision === "accepted" ? "approved" : "rejected";
  await db
    .prepare(
      `UPDATE jobs SET dash_bucket = ?, dash_moved_at = ?, status = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(decision, now, status, now, id)
    .run();
  await deleteFavoriteForJob(db, id);
}

/** Move job from Applied / Rejected back to the main job list (active bucket). */
export async function restoreDashboardJobToActive(
  db: D1Database,
  id: string,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE jobs SET dash_bucket = 'active', dash_moved_at = ?, status = 'dashboard_open', updated_at = ?
       WHERE id = ? AND dash_bucket IN ('accepted', 'denied')`,
    )
    .bind(now, now, id)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** Move job from Filtered out back to the main list as Low priority (was AI/hard reject). */
/** Reject many jobs that are still on the dashboard active list (e.g. visible-filtered bulk deny). */
export async function bulkDenyActiveJobs(
  db: D1Database,
  ids: string[],
  now: number,
): Promise<string[]> {
  const uniq = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (uniq.length === 0) return [];
  const batchSize = 80;
  const updatedIds: string[] = [];
  for (let i = 0; i < uniq.length; i += batchSize) {
    const slice = uniq.slice(i, i + batchSize);
    const placeholders = slice.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `UPDATE jobs SET dash_bucket = 'denied', dash_moved_at = ?, status = 'rejected', updated_at = ?
         WHERE dash_bucket = 'active' AND id IN (${placeholders})
         RETURNING id`,
      )
      .bind(now, now, ...slice)
      .all<{ id: string }>();
    updatedIds.push(
      ...(results ?? [])
        .map((row) => row.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );
    await db
      .prepare(`DELETE FROM job_favorites WHERE job_id IN (${placeholders})`)
      .bind(...slice)
      .run();
  }
  return updatedIds;
}

/** Move many active jobs to Applied (same rules as single accept). */
export async function bulkAcceptActiveJobs(
  db: D1Database,
  ids: string[],
  now: number,
): Promise<string[]> {
  const uniq = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (uniq.length === 0) return [];
  const batchSize = 80;
  const updatedIds: string[] = [];
  for (let i = 0; i < uniq.length; i += batchSize) {
    const slice = uniq.slice(i, i + batchSize);
    const placeholders = slice.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `UPDATE jobs SET dash_bucket = 'accepted', dash_moved_at = ?, status = 'approved', updated_at = ?
         WHERE dash_bucket = 'active' AND id IN (${placeholders})
         RETURNING id`,
      )
      .bind(now, now, ...slice)
      .all<{ id: string }>();
    updatedIds.push(
      ...(results ?? [])
        .map((row) => row.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );
    await db
      .prepare(`DELETE FROM job_favorites WHERE job_id IN (${placeholders})`)
      .bind(...slice)
      .run();
  }
  return updatedIds;
}

/** Restore jobs from Applied / Reject / Filtered out to the main list (per-row bucket rules). */
export async function bulkRestoreJobs(db: D1Database, ids: string[], now: number): Promise<string[]> {
  const uniq = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (uniq.length === 0) return [];
  const batchSize = 80;
  const updatedIds: string[] = [];
  for (let i = 0; i < uniq.length; i += batchSize) {
    const slice = uniq.slice(i, i + batchSize);
    const placeholders = slice.map(() => "?").join(",");
    const archived = await db
      .prepare(
        `UPDATE jobs SET dash_bucket = 'active', dash_moved_at = ?, status = 'dashboard_open', updated_at = ?
         WHERE id IN (${placeholders}) AND dash_bucket IN ('accepted', 'denied')
         RETURNING id`,
      )
      .bind(now, now, ...slice)
      .all<{ id: string }>();
    updatedIds.push(
      ...((archived.results ?? [])
        .map((row) => row.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)),
    );
    const filtered = await db
      .prepare(
        `UPDATE jobs SET
          dash_bucket = 'active',
          dash_moved_at = ?,
          status = 'dashboard_open',
          recommendation = 'low_priority_review',
          hard_filter_passed = 1,
          hard_reject_reasons = NULL,
          fit_score = CASE WHEN COALESCE(fit_score, 0) < 60 THEN 60 ELSE fit_score END,
          updated_at = ?
         WHERE id IN (${placeholders}) AND dash_bucket = 'filtered'
         RETURNING id`,
      )
      .bind(now, now, ...slice)
      .all<{ id: string }>();
    updatedIds.push(
      ...((filtered.results ?? [])
        .map((row) => row.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)),
    );
  }
  return updatedIds;
}

export async function restoreFilteredJobToActive(
  db: D1Database,
  id: string,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE jobs SET
        dash_bucket = 'active',
        dash_moved_at = ?,
        status = 'dashboard_open',
        recommendation = 'low_priority_review',
        hard_filter_passed = 1,
        hard_reject_reasons = NULL,
        fit_score = CASE WHEN COALESCE(fit_score, 0) < 60 THEN 60 ELSE fit_score END,
        updated_at = ?
      WHERE id = ? AND dash_bucket = 'filtered'`,
    )
    .bind(now, now, id)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function saveGeneratedDrafts(
  db: D1Database,
  id: string,
  drafts: { cvDraft: string; coverLetter: string },
  r2CvKey: string,
  r2CoverKey: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE jobs SET
        draft_cv = ?,
        draft_cover_letter = ?,
        r2_cv_key = ?,
        r2_cover_key = ?,
        updated_at = ?
      WHERE id = ?`,
    )
    .bind(drafts.cvDraft, drafts.coverLetter, r2CvKey, r2CoverKey, now, id)
    .run();
}

export async function getJobR2Keys(
  db: D1Database,
  id: string,
): Promise<{ r2_cv_key: string | null; r2_cover_key: string | null } | null> {
  return db
    .prepare("SELECT r2_cv_key, r2_cover_key FROM jobs WHERE id = ?")
    .bind(id)
    .first<{ r2_cv_key: string | null; r2_cover_key: string | null }>();
}

export async function getJobCompany(
  db: D1Database,
  id: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT company FROM jobs WHERE id = ?")
    .bind(id)
    .first<{ company: string | null }>();
  return row?.company ?? null;
}

/** Remove generated .docx objects for these jobs (best-effort). Call before deleting D1 rows. */
export async function deleteR2DocObjectsForJobs(
  bucket: R2Bucket | undefined,
  db: D1Database,
  ids: string[],
): Promise<number> {
  if (!bucket || ids.length === 0) return 0;
  let n = 0;
  for (const id of ids) {
    const row = await getJobR2Keys(db, id);
    for (const key of [row?.r2_cv_key, row?.r2_cover_key]) {
      if (!key) continue;
      try {
        await bucket.delete(key);
        n++;
      } catch (e) {
        console.warn("[jobs] R2 delete failed", key, e);
      }
    }
  }
  return n;
}

async function deleteJobFavoritesForJobIds(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const batchSize = 80;
  for (let i = 0; i < ids.length; i += batchSize) {
    const slice = ids.slice(i, i + batchSize);
    const placeholders = slice.map(() => "?").join(",");
    await db
      .prepare(`DELETE FROM job_favorites WHERE job_id IN (${placeholders})`)
      .bind(...slice)
      .run();
  }
}

/** Deletes D1 rows only. Prefer `deleteJobsByIdsWithR2Cleanup` when CV/cover docs may exist in R2. */
export async function deleteJobsByIds(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await deleteJobFavoritesForJobIds(db, ids);
  const batchSize = 80;
  for (let i = 0; i < ids.length; i += batchSize) {
    const slice = ids.slice(i, i + batchSize);
    const placeholders = slice.map(() => "?").join(",");
    await db
      .prepare(`DELETE FROM jobs WHERE id IN (${placeholders})`)
      .bind(...slice)
      .run();
  }
}

/** Deletes D1 jobs, then best-effort removes related R2 docs using returned keys. */
export async function deleteJobsByIdsWithR2Cleanup(
  db: D1Database,
  bucket: R2Bucket | undefined,
  ids: string[],
): Promise<{ deletedIds: string[]; r2Deleted: number }> {
  const uniq = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (uniq.length === 0) return { deletedIds: [], r2Deleted: 0 };
  await deleteJobFavoritesForJobIds(db, uniq);
  const batchSize = 80;
  const deletedIds: string[] = [];
  let r2Deleted = 0;
  for (let i = 0; i < uniq.length; i += batchSize) {
    const slice = uniq.slice(i, i + batchSize);
    const placeholders = slice.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `DELETE FROM jobs
         WHERE id IN (${placeholders})
         RETURNING id, r2_cv_key, r2_cover_key`,
      )
      .bind(...slice)
      .all<{ id: string; r2_cv_key: string | null; r2_cover_key: string | null }>();
    for (const row of results ?? []) {
      if (typeof row.id === "string" && row.id.length > 0) deletedIds.push(row.id);
      if (!bucket) continue;
      for (const key of [row.r2_cv_key, row.r2_cover_key]) {
        if (!key) continue;
        try {
          await bucket.delete(key);
          r2Deleted++;
        } catch (e) {
          console.warn("[jobs] R2 delete failed", key, e);
        }
      }
    }
  }
  return { deletedIds, r2Deleted };
}

/**
 * Four-week retention for transient dashboard buckets only.
 * - `accepted` / Applied rows are never auto-deleted; they are the user's application history.
 * - Favorited rows are never auto-deleted; a star pins the job until the user unstars it.
 * - For `denied`, the 4-week clock starts at `dash_moved_at` (when the user made the decision),
 *   falling back to `created_at` / `updated_at` if the column is NULL.
 * - For `active` / `filtered` it is based on `created_at` (ingest time).
 */
export async function selectExpiredDashboardJobs(db: D1Database, now: number): Promise<string[]> {
  const fourWeeks = 28 * 24 * 60 * 60;

  const { results: denied } = await db
    .prepare(
      `SELECT id FROM jobs
       WHERE dash_bucket = 'denied'
         AND (? - COALESCE(dash_moved_at, updated_at, created_at)) > ?
         AND NOT EXISTS (SELECT 1 FROM job_favorites f WHERE f.job_id = jobs.id)`,
    )
    .bind(now, fourWeeks)
    .all<{ id: string }>();

  const { results: active } = await db
    .prepare(
      `SELECT id FROM jobs
       WHERE dash_bucket = 'active'
         AND (? - created_at) > ?
         AND NOT EXISTS (SELECT 1 FROM job_favorites f WHERE f.job_id = jobs.id)`,
    )
    .bind(now, fourWeeks)
    .all<{ id: string }>();

  const { results: filtered } = await db
    .prepare(
      `SELECT id FROM jobs
       WHERE dash_bucket = 'filtered'
         AND (? - created_at) > ?
         AND NOT EXISTS (SELECT 1 FROM job_favorites f WHERE f.job_id = jobs.id)`,
    )
    .bind(now, fourWeeks)
    .all<{ id: string }>();

  const set = new Set<string>();
  for (const r of denied ?? []) set.add(r.id);
  for (const r of active ?? []) set.add(r.id);
  for (const r of filtered ?? []) set.add(r.id);
  return [...set];
}

/**
 * Fills `salary_monthly_eur` / `salary_display_eur` for existing rows whose cache is NULL so that
 * the dashboard list API never has to call Frankfurter per request. Runs in small batches so
 * Worker CPU remains bounded; repeated invocations (cron + light waitUntil nudges) converge.
 */
export async function backfillSalaryEurCacheBatch(
  db: D1Database,
  fx: HardFilterFxRates,
  now: number,
  limit: number,
): Promise<{ inspected: number; written: number }> {
  const safeLimit = Math.max(1, Math.min(5000, Math.floor(limit)));
  const { results } = await db
    .prepare(
      `SELECT id, title, description, salary_raw, salary_min, salary_max, salary_currency
       FROM jobs
       WHERE salary_display_eur IS NULL
       LIMIT ?`,
    )
    .bind(safeLimit)
    .all<{
      id: string;
      title: string | null;
      description: string | null;
      salary_raw: string | null;
      salary_min: number | null;
      salary_max: number | null;
      salary_currency: string | null;
    }>();

  const rows = results ?? [];
  if (rows.length === 0) return { inspected: 0, written: 0 };

  // D1 `.batch()` collapses many UPDATEs into a single round-trip. This turns an N*~50ms
  // serial loop into essentially one request and is the difference between finishing in
  // seconds vs being killed by the CPU budget mid-backfill.
  const chunkSize = 200;
  let written = 0;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const slice = rows.slice(offset, offset + chunkSize);
    const statements = slice.map((row) => {
      const cache = computeSalaryEurCache(
        {
          title: row.title ?? null,
          description: row.description ?? null,
          salary_raw: row.salary_raw ?? null,
          salary_min: row.salary_min ?? null,
          salary_max: row.salary_max ?? null,
          salary_currency: row.salary_currency ?? null,
        },
        fx,
      );
      return db
        .prepare(
          `UPDATE jobs SET salary_monthly_eur = ?, salary_display_eur = ?, updated_at = COALESCE(updated_at, ?)
           WHERE id = ?`,
        )
        .bind(cache.monthlyEur, cache.display, now, row.id);
    });
    await db.batch(statements);
    written += slice.length;
  }
  return { inspected: rows.length, written };
}

export async function countJobsMissingSalaryEurCache(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE salary_display_eur IS NULL`)
    .first<{ n: number | string }>();
  return Number(row?.n ?? 0) || 0;
}

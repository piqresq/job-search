import type { JobSourceId } from "../types/job";

export type TitleQueryHealthExample = {
  score: number;
  band: string;
  canonicalQuery: string;
  title: string;
  jobId: string;
};

export type TitleQueryHealthVendorAggregate = {
  providerId: JobSourceId;
  sampleCount: number;
  averageScore: number;
  medianScore: number;
  pctScoreGte8: number;
  pctScoreLte4: number;
  distribution: {
    exact: number;
    strong: number;
    good: number;
    moderate: number;
    weak: number;
    poor: number;
    unrelated: number;
  };
  lowestExamples: TitleQueryHealthExample[];
  highestExamples: TitleQueryHealthExample[];
};

function utcDayStartUnix(ymd: string): number {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  return Math.floor(Date.UTC(y, m - 1, d) / 1000);
}

function utcDayEndUnix(ymd: string): number {
  return utcDayStartUnix(ymd) + 86400 - 1;
}

/** Shared filter for title-query health rows in a date window. */
const TITLE_HEALTH_TIME_FILTER = `j.user_id = ?
  AND COALESCE(
    CAST(json_extract(j.normalized_json, '$.apiFetchedAtUnix') AS INTEGER),
    j.created_at
  ) BETWEEN ? AND ?
  AND json_extract(j.normalized_json, '$.titleQueryHealthScore') IS NOT NULL`;

type AggRow = {
  source: string;
  n: number;
  sumscore: number;
  gte8: number;
  lte4: number;
  dist_exact: number;
  dist_strong: number;
  dist_good: number;
  dist_moderate: number;
  dist_weak: number;
  dist_poor: number;
  dist_unrelated: number;
  medianScore: number;
};

type ExampleRow = {
  id: string;
  source: string;
  score: number | null;
  band: string | null;
  canonical_query: string | null;
  title: string | null;
};

function mapExample(r: ExampleRow): TitleQueryHealthExample {
  return {
    score: r.score as number,
    band: String(r.band ?? ""),
    canonicalQuery: String(r.canonical_query ?? ""),
    title: String(r.title ?? ""),
    jobId: r.id,
  };
}

/**
 * Per-vendor title↔query health rollups for the statistics API.
 * Uses SQL windowing for median and distribution so large date ranges do not load every row into Worker memory.
 * Lowest / highest examples use bounded `LIMIT` queries per source.
 */
export async function aggregateTitleQueryHealthByVendor(
  db: D1Database,
  userId: string,
  fromYmd: string,
  toYmd: string,
): Promise<TitleQueryHealthVendorAggregate[]> {
  const startUnix = utcDayStartUnix(fromYmd);
  const endUnix = utcDayEndUnix(toYmd);

  const aggRes = await db
    .prepare(
      `WITH base AS (
        SELECT
          j.source AS source,
          CAST(json_extract(j.normalized_json, '$.titleQueryHealthScore') AS REAL) AS score
        FROM jobs j
        WHERE ${TITLE_HEALTH_TIME_FILTER}
      ),
      ranked AS (
        SELECT source, score,
          ROW_NUMBER() OVER (PARTITION BY source ORDER BY score) AS rn,
          COUNT(*) OVER (PARTITION BY source) AS cnt
        FROM base
        WHERE score IS NOT NULL AND score = score
      ),
      median_rows AS (
        SELECT source, score
        FROM ranked
        WHERE rn BETWEEN (cnt + 1) / 2 AND (cnt + 2) / 2
      ),
      median_by_source AS (
        SELECT source, AVG(score) AS medianScore
        FROM median_rows
        GROUP BY source
      ),
      agg AS (
        SELECT
          source,
          COUNT(*) AS n,
          SUM(score) AS sumscore,
          SUM(CASE WHEN score >= 8 THEN 1 ELSE 0 END) AS gte8,
          SUM(CASE WHEN score <= 4 THEN 1 ELSE 0 END) AS lte4,
          SUM(CASE WHEN score >= 10 THEN 1 ELSE 0 END) AS dist_exact,
          SUM(CASE WHEN score >= 9 AND score < 10 THEN 1 ELSE 0 END) AS dist_strong,
          SUM(CASE WHEN score >= 7 AND score < 9 THEN 1 ELSE 0 END) AS dist_good,
          SUM(CASE WHEN score >= 6 AND score < 7 THEN 1 ELSE 0 END) AS dist_moderate,
          SUM(CASE WHEN score >= 4 AND score < 6 THEN 1 ELSE 0 END) AS dist_weak,
          SUM(CASE WHEN score >= 2 AND score < 4 THEN 1 ELSE 0 END) AS dist_poor,
          SUM(CASE WHEN score < 2 THEN 1 ELSE 0 END) AS dist_unrelated
        FROM base
        WHERE score IS NOT NULL AND score = score
        GROUP BY source
      )
      SELECT
        agg.source AS source,
        agg.n AS n,
        agg.sumscore AS sumscore,
        agg.gte8 AS gte8,
        agg.lte4 AS lte4,
        agg.dist_exact AS dist_exact,
        agg.dist_strong AS dist_strong,
        agg.dist_good AS dist_good,
        agg.dist_moderate AS dist_moderate,
        agg.dist_weak AS dist_weak,
        agg.dist_poor AS dist_poor,
        agg.dist_unrelated AS dist_unrelated,
        median_by_source.medianScore AS medianScore
      FROM agg
      INNER JOIN median_by_source ON median_by_source.source = agg.source
      ORDER BY agg.source`,
    )
    .bind(userId, startUnix, endUnix)
    .all<AggRow>();

  const aggRows = (aggRes.results ?? []).filter(
    (r) =>
      typeof r.source === "string" &&
      r.source.length > 0 &&
      typeof r.n === "number" &&
      r.n > 0 &&
      Number.isFinite(r.sumscore) &&
      Number.isFinite(r.medianScore),
  );

  const exampleSelect = `SELECT
          j.id AS id,
          j.source AS source,
          CAST(json_extract(j.normalized_json, '$.titleQueryHealthScore') AS REAL) AS score,
          json_extract(j.normalized_json, '$.titleQueryHealthBand') AS band,
          COALESCE(
            NULLIF(TRIM(json_extract(j.normalized_json, '$.canonicalSearchRole')), ''),
            NULLIF(TRIM(json_extract(j.normalized_json, '$.searchQuery')), '')
          ) AS canonical_query,
          j.title AS title
        FROM jobs j
        WHERE ${TITLE_HEALTH_TIME_FILTER}
          AND j.source = ?
          AND CAST(json_extract(j.normalized_json, '$.titleQueryHealthScore') AS REAL) = CAST(json_extract(j.normalized_json, '$.titleQueryHealthScore') AS REAL)`;

  const out: TitleQueryHealthVendorAggregate[] = [];

  for (const row of aggRows) {
    const providerId = row.source;
    const n = row.n;
    const sum = row.sumscore;

    const [lowRes, highRes] = await Promise.all([
      db
        .prepare(`${exampleSelect} ORDER BY score ASC, j.id ASC LIMIT 5`)
        .bind(userId, startUnix, endUnix, providerId)
        .all<ExampleRow>(),
      db
        .prepare(`${exampleSelect} ORDER BY score DESC, j.id ASC LIMIT 3`)
        .bind(userId, startUnix, endUnix, providerId)
        .all<ExampleRow>(),
    ]);

    const lowestExamples = (lowRes.results ?? [])
      .filter((r) => r.score != null && Number.isFinite(r.score))
      .map(mapExample);
    const highestExamples = (highRes.results ?? [])
      .filter((r) => r.score != null && Number.isFinite(r.score))
      .map(mapExample);

    out.push({
      providerId: providerId as JobSourceId,
      sampleCount: n,
      averageScore: Math.round((sum / n) * 10) / 10,
      medianScore: Math.round(row.medianScore * 10) / 10,
      pctScoreGte8: Math.round((row.gte8 / n) * 1000) / 10,
      pctScoreLte4: Math.round((row.lte4 / n) * 1000) / 10,
      distribution: {
        exact: row.dist_exact,
        strong: row.dist_strong,
        good: row.dist_good,
        moderate: row.dist_moderate,
        weak: row.dist_weak,
        poor: row.dist_poor,
        unrelated: row.dist_unrelated,
      },
      lowestExamples,
      highestExamples,
    });
  }

  out.sort((a, b) => a.providerId.localeCompare(b.providerId));
  return out;
}

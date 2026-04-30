-- Per-job favorites for the dashboard (active jobs only; rows removed when job leaves active bucket).
CREATE TABLE IF NOT EXISTS job_favorites (
  job_id TEXT NOT NULL PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_job_favorites_created ON job_favorites (created_at);

-- Jobs collected and processed through the pipeline
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT,
  company TEXT,
  job_url TEXT,
  apply_url TEXT,
  location TEXT,
  is_remote INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  salary_raw TEXT,
  salary_min REAL,
  salary_max REAL,
  salary_currency TEXT,
  normalized_json TEXT NOT NULL,
  hard_filter_passed INTEGER NOT NULL DEFAULT 0,
  hard_reject_reasons TEXT,
  fit_score INTEGER,
  recommendation TEXT,
  scoring_json TEXT,
  reasons_to_apply TEXT,
  risks TEXT,
  suggested_cv_variant TEXT,
  cover_letter_angle TEXT,
  scoring_notes TEXT,
  draft_cv TEXT,
  draft_cover_letter TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  review_token_hash TEXT,
  review_token_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX jobs_source_external ON jobs (source, external_id);
CREATE INDEX jobs_status ON jobs (status);
CREATE INDEX jobs_created ON jobs (created_at);

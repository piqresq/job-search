-- 0022_multiuser.sql
-- Multi-user system: users table, global_settings table, user_id on all per-user tables.
-- Existing rows are attributed to the bootstrap admin (id = 'piqresq').

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. USERS TABLE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          TEXT    NOT NULL PRIMARY KEY,
  username    TEXT    NOT NULL UNIQUE,
  password_hash TEXT  NOT NULL,
  password_salt TEXT  NOT NULL,
  role        TEXT    NOT NULL DEFAULT 'user',
  status      TEXT    NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. GLOBAL_SETTINGS TABLE (admin-managed, NOT per-user)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS global_settings (
  key        TEXT    NOT NULL PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. JOBS — add user_id (PK stays 'id', but meaning changes to include user scope)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE jobs ADD COLUMN user_id TEXT NOT NULL DEFAULT 'piqresq';
DROP INDEX IF EXISTS jobs_source_external;
CREATE UNIQUE INDEX jobs_source_external ON jobs (user_id, source, external_id);
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. APP_LOGS — add user_id
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE app_logs ADD COLUMN user_id TEXT NOT NULL DEFAULT 'piqresq';
CREATE INDEX IF NOT EXISTS idx_app_logs_user_id_ts ON app_logs (user_id, ts DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. AI_INSTRUCTION_REVISIONS — add user_id
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ai_instruction_revisions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'piqresq';
DROP INDEX IF EXISTS idx_ai_instruction_revisions_created;
CREATE INDEX IF NOT EXISTS idx_ai_instruction_revisions_user ON ai_instruction_revisions (user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. SEARCH_ROLE_REVISIONS — add user_id
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE search_role_revisions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'piqresq';
DROP INDEX IF EXISTS idx_search_role_revisions_created;
CREATE INDEX IF NOT EXISTS idx_search_role_revisions_user ON search_role_revisions (user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. APP_SETTINGS — PK changes from (key) to (user_id, key)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE app_settings_new (
  user_id TEXT NOT NULL,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
INSERT INTO app_settings_new (user_id, key, value)
  SELECT 'piqresq', key, value FROM app_settings;
DROP TABLE app_settings;
ALTER TABLE app_settings_new RENAME TO app_settings;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. PIPELINE_STATE — PK changes from (k) to (user_id, k)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE pipeline_state_new (
  user_id    TEXT    NOT NULL,
  k          TEXT    NOT NULL,
  v          TEXT    NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, k)
);
INSERT INTO pipeline_state_new (user_id, k, v, updated_at)
  SELECT 'piqresq', k, v, updated_at FROM pipeline_state;
DROP TABLE pipeline_state;
ALTER TABLE pipeline_state_new RENAME TO pipeline_state;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. PROVIDER_SCHEDULER_STATE — PK changes from (provider_id) to (user_id, provider_id)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE provider_scheduler_state_new (
  user_id          TEXT    NOT NULL,
  provider_id      TEXT    NOT NULL,
  cycle_id         TEXT    NOT NULL,
  plan_hash        TEXT    NOT NULL,
  country_cursor   INTEGER NOT NULL DEFAULT 0,
  updated_at       INTEGER NOT NULL DEFAULT 0,
  tier1_pick_count INTEGER NOT NULL DEFAULT 0,
  tier2_pick_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, provider_id)
);
INSERT INTO provider_scheduler_state_new
  (user_id, provider_id, cycle_id, plan_hash, country_cursor, updated_at, tier1_pick_count, tier2_pick_count)
  SELECT 'piqresq', provider_id, cycle_id, plan_hash, country_cursor, updated_at, tier1_pick_count, tier2_pick_count
  FROM provider_scheduler_state;
DROP TABLE provider_scheduler_state;
ALTER TABLE provider_scheduler_state_new RENAME TO provider_scheduler_state;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. PROVIDER_COUNTRY_STATE — PK changes to (user_id, provider_id, country_key)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE provider_country_state_new (
  user_id         TEXT    NOT NULL,
  provider_id     TEXT    NOT NULL,
  country_key     TEXT    NOT NULL,
  cycle_id        TEXT    NOT NULL,
  schedule_pos    INTEGER NOT NULL DEFAULT 0,
  tier1_cursor    INTEGER NOT NULL DEFAULT 0,
  tier2_cursor    INTEGER NOT NULL DEFAULT 0,
  exhausted       INTEGER NOT NULL DEFAULT 0,
  next_eligible_at INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  updated_at      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, provider_id, country_key)
);
INSERT INTO provider_country_state_new
  (user_id, provider_id, country_key, cycle_id, schedule_pos, tier1_cursor, tier2_cursor, exhausted, next_eligible_at, last_error, updated_at)
  SELECT 'piqresq', provider_id, country_key, cycle_id, schedule_pos, tier1_cursor, tier2_cursor, exhausted, next_eligible_at, last_error, updated_at
  FROM provider_country_state;
DROP TABLE provider_country_state;
ALTER TABLE provider_country_state_new RENAME TO provider_country_state;
DROP INDEX IF EXISTS idx_provider_country_state_provider_cycle;
CREATE INDEX IF NOT EXISTS idx_provider_country_state_provider_cycle
  ON provider_country_state (user_id, provider_id, cycle_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. PROVIDER_QUERY_UNIT_STATE — PK changes to (user_id, provider_id, country_key, unit_id)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE provider_query_unit_state_new (
  user_id          TEXT    NOT NULL,
  provider_id      TEXT    NOT NULL,
  country_key      TEXT    NOT NULL,
  unit_id          TEXT    NOT NULL,
  cycle_id         TEXT    NOT NULL,
  tier             INTEGER NOT NULL,
  query_value      TEXT    NOT NULL,
  pagination_cursor TEXT,
  exhausted        INTEGER NOT NULL DEFAULT 0,
  next_eligible_at INTEGER NOT NULL DEFAULT 0,
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  updated_at       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, provider_id, country_key, unit_id)
);
INSERT INTO provider_query_unit_state_new
  (user_id, provider_id, country_key, unit_id, cycle_id, tier, query_value, pagination_cursor, exhausted, next_eligible_at, consecutive_errors, last_error, updated_at)
  SELECT 'piqresq', provider_id, country_key, unit_id, cycle_id, tier, query_value, pagination_cursor, exhausted, next_eligible_at, consecutive_errors, last_error, updated_at
  FROM provider_query_unit_state;
DROP TABLE provider_query_unit_state;
ALTER TABLE provider_query_unit_state_new RENAME TO provider_query_unit_state;
DROP INDEX IF EXISTS idx_provider_query_unit_state_provider_cycle;
CREATE INDEX IF NOT EXISTS idx_provider_query_unit_state_provider_cycle
  ON provider_query_unit_state (user_id, provider_id, cycle_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. LINKEDIN_COUNTRY_OFFSET — PK changes from (country) to (user_id, country)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE linkedin_country_offset_new (
  user_id    TEXT    NOT NULL,
  country    TEXT    NOT NULL,
  offset     INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  drained    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, country)
);
INSERT INTO linkedin_country_offset_new (user_id, country, offset, updated_at, drained)
  SELECT 'piqresq', country, offset, updated_at, drained FROM linkedin_country_offset;
DROP TABLE linkedin_country_offset;
ALTER TABLE linkedin_country_offset_new RENAME TO linkedin_country_offset;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. JSEARCH_ROTATION — PK changes from (id) to (user_id, id)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE jsearch_rotation_new (
  user_id TEXT    NOT NULL,
  id      TEXT    NOT NULL,
  seq     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);
INSERT INTO jsearch_rotation_new (user_id, id, seq)
  SELECT 'piqresq', id, seq FROM jsearch_rotation;
DROP TABLE jsearch_rotation;
ALTER TABLE jsearch_rotation_new RENAME TO jsearch_rotation;

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. STATISTICS_DAILY_PROVIDER — PK gains user_id prefix
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE statistics_daily_provider_new (
  user_id         TEXT    NOT NULL,
  day_utc         TEXT    NOT NULL,
  provider_id     TEXT    NOT NULL,
  request_count   INTEGER NOT NULL DEFAULT 0,
  jobs_received   INTEGER NOT NULL DEFAULT 0,
  jobs_kept       INTEGER NOT NULL DEFAULT 0,
  jobs_processed  INTEGER NOT NULL DEFAULT 0,
  jobs_high       INTEGER NOT NULL DEFAULT 0,
  jobs_medium     INTEGER NOT NULL DEFAULT 0,
  jobs_low        INTEGER NOT NULL DEFAULT 0,
  jobs_filtered   INTEGER NOT NULL DEFAULT 0,
  jobs_hard_rejected INTEGER NOT NULL DEFAULT 0,
  jobs_ai_rejected   INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, day_utc, provider_id)
);
INSERT INTO statistics_daily_provider_new
  (user_id, day_utc, provider_id, request_count, jobs_received, jobs_kept, jobs_processed,
   jobs_high, jobs_medium, jobs_low, jobs_filtered, jobs_hard_rejected, jobs_ai_rejected, updated_at)
  SELECT 'piqresq', day_utc, provider_id, request_count, jobs_received, jobs_kept, jobs_processed,
         jobs_high, jobs_medium, jobs_low, jobs_filtered, jobs_hard_rejected, jobs_ai_rejected, updated_at
  FROM statistics_daily_provider;
DROP TABLE statistics_daily_provider;
ALTER TABLE statistics_daily_provider_new RENAME TO statistics_daily_provider;
DROP INDEX IF EXISTS idx_statistics_daily_provider_provider_day;
CREATE INDEX IF NOT EXISTS idx_statistics_daily_provider_provider_day
  ON statistics_daily_provider (user_id, provider_id, day_utc DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. STATISTICS_DAILY_VARIANT — PK gains user_id prefix
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE statistics_daily_variant_new (
  user_id         TEXT    NOT NULL,
  day_utc         TEXT    NOT NULL,
  provider_id     TEXT    NOT NULL,
  search_query    TEXT    NOT NULL,
  tier            INTEGER NOT NULL DEFAULT 0,
  country_key     TEXT    NOT NULL DEFAULT '',
  country_label   TEXT    NOT NULL DEFAULT '',
  request_count   INTEGER NOT NULL DEFAULT 0,
  jobs_received   INTEGER NOT NULL DEFAULT 0,
  jobs_kept       INTEGER NOT NULL DEFAULT 0,
  jobs_processed  INTEGER NOT NULL DEFAULT 0,
  jobs_high       INTEGER NOT NULL DEFAULT 0,
  jobs_medium     INTEGER NOT NULL DEFAULT 0,
  jobs_low        INTEGER NOT NULL DEFAULT 0,
  jobs_filtered   INTEGER NOT NULL DEFAULT 0,
  jobs_hard_rejected INTEGER NOT NULL DEFAULT 0,
  jobs_ai_rejected   INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, day_utc, provider_id, search_query, tier, country_key)
);
INSERT INTO statistics_daily_variant_new
  (user_id, day_utc, provider_id, search_query, tier, country_key, country_label,
   request_count, jobs_received, jobs_kept, jobs_processed, jobs_high, jobs_medium,
   jobs_low, jobs_filtered, jobs_hard_rejected, jobs_ai_rejected, updated_at)
  SELECT 'piqresq', day_utc, provider_id, search_query, tier, country_key, country_label,
         request_count, jobs_received, jobs_kept, jobs_processed, jobs_high, jobs_medium,
         jobs_low, jobs_filtered, jobs_hard_rejected, jobs_ai_rejected, updated_at
  FROM statistics_daily_variant;
DROP TABLE statistics_daily_variant;
ALTER TABLE statistics_daily_variant_new RENAME TO statistics_daily_variant;
DROP INDEX IF EXISTS idx_statistics_daily_variant_lookup;
CREATE INDEX IF NOT EXISTS idx_statistics_daily_variant_lookup
  ON statistics_daily_variant (user_id, provider_id, day_utc DESC, tier, country_key);

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. JOB_FAVORITES — PK changes from (job_id) to (user_id, job_id)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE job_favorites_new (
  user_id    TEXT    NOT NULL,
  job_id     TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, job_id)
);
INSERT INTO job_favorites_new (user_id, job_id, created_at)
  SELECT 'piqresq', job_id, created_at FROM job_favorites;
DROP TABLE job_favorites;
ALTER TABLE job_favorites_new RENAME TO job_favorites;
DROP INDEX IF EXISTS idx_job_favorites_created;
CREATE INDEX IF NOT EXISTS idx_job_favorites_user_created ON job_favorites (user_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. PROVIDER_UNIT_SCHEDULE_STATE — PK changes to (user_id, provider_id, unit_id)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE provider_unit_schedule_state_new (
  user_id       TEXT    NOT NULL,
  provider_id   TEXT    NOT NULL,
  unit_id       TEXT    NOT NULL,
  plan_hash     TEXT    NOT NULL,
  tier          INTEGER NOT NULL,
  query_value   TEXT    NOT NULL,
  pick_count    INTEGER NOT NULL DEFAULT 0,
  last_picked_at INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, provider_id, unit_id)
);
INSERT INTO provider_unit_schedule_state_new
  (user_id, provider_id, unit_id, plan_hash, tier, query_value, pick_count, last_picked_at, updated_at)
  SELECT 'piqresq', provider_id, unit_id, plan_hash, tier, query_value, pick_count, last_picked_at, updated_at
  FROM provider_unit_schedule_state;
DROP TABLE provider_unit_schedule_state;
ALTER TABLE provider_unit_schedule_state_new RENAME TO provider_unit_schedule_state;
DROP INDEX IF EXISTS idx_provider_unit_schedule_state_provider_plan;
CREATE INDEX IF NOT EXISTS idx_provider_unit_schedule_state_provider_plan
  ON provider_unit_schedule_state (user_id, provider_id, plan_hash, tier);

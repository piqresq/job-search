CREATE TABLE IF NOT EXISTS provider_scheduler_state (
  provider_id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  country_cursor INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS provider_country_state (
  provider_id TEXT NOT NULL,
  country_key TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  schedule_pos INTEGER NOT NULL DEFAULT 0,
  tier1_cursor INTEGER NOT NULL DEFAULT 0,
  tier2_cursor INTEGER NOT NULL DEFAULT 0,
  exhausted INTEGER NOT NULL DEFAULT 0,
  next_eligible_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider_id, country_key)
);

CREATE TABLE IF NOT EXISTS provider_query_unit_state (
  provider_id TEXT NOT NULL,
  country_key TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  tier INTEGER NOT NULL,
  query_value TEXT NOT NULL,
  pagination_cursor TEXT,
  exhausted INTEGER NOT NULL DEFAULT 0,
  next_eligible_at INTEGER NOT NULL DEFAULT 0,
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider_id, country_key, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_country_state_provider_cycle
  ON provider_country_state(provider_id, cycle_id);

CREATE INDEX IF NOT EXISTS idx_provider_query_unit_state_provider_cycle
  ON provider_query_unit_state(provider_id, cycle_id);

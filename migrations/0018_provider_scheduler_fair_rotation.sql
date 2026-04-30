ALTER TABLE provider_scheduler_state
  ADD COLUMN tier1_pick_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE provider_scheduler_state
  ADD COLUMN tier2_pick_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS provider_unit_schedule_state (
  provider_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  tier INTEGER NOT NULL,
  query_value TEXT NOT NULL,
  pick_count INTEGER NOT NULL DEFAULT 0,
  last_picked_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_unit_schedule_state_provider_plan
  ON provider_unit_schedule_state(provider_id, plan_hash, tier);

-- Pipeline state (key/value) for LinkedIn drain, freeze, RR cursor, RapidAPI key index.
CREATE TABLE IF NOT EXISTS pipeline_state (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);

-- Per-country: pagination offset + drained flag for 24h slice exhaustion.
ALTER TABLE linkedin_country_offset ADD COLUMN drained INTEGER NOT NULL DEFAULT 0;

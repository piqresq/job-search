-- Per-country pagination offset for LinkedIn 7-day API (`offset` must align with `limit`).
CREATE TABLE IF NOT EXISTS linkedin_country_offset (
  country TEXT PRIMARY KEY,
  offset INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

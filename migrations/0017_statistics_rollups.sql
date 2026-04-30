CREATE TABLE statistics_daily_provider (
  day_utc TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  jobs_received INTEGER NOT NULL DEFAULT 0,
  jobs_kept INTEGER NOT NULL DEFAULT 0,
  jobs_processed INTEGER NOT NULL DEFAULT 0,
  jobs_high INTEGER NOT NULL DEFAULT 0,
  jobs_medium INTEGER NOT NULL DEFAULT 0,
  jobs_low INTEGER NOT NULL DEFAULT 0,
  jobs_filtered INTEGER NOT NULL DEFAULT 0,
  jobs_hard_rejected INTEGER NOT NULL DEFAULT 0,
  jobs_ai_rejected INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day_utc, provider_id)
);

CREATE INDEX idx_statistics_daily_provider_provider_day
  ON statistics_daily_provider (provider_id, day_utc DESC);

CREATE TABLE statistics_daily_variant (
  day_utc TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  search_query TEXT NOT NULL,
  tier INTEGER NOT NULL DEFAULT 0,
  country_key TEXT NOT NULL DEFAULT '',
  country_label TEXT NOT NULL DEFAULT '',
  request_count INTEGER NOT NULL DEFAULT 0,
  jobs_received INTEGER NOT NULL DEFAULT 0,
  jobs_kept INTEGER NOT NULL DEFAULT 0,
  jobs_processed INTEGER NOT NULL DEFAULT 0,
  jobs_high INTEGER NOT NULL DEFAULT 0,
  jobs_medium INTEGER NOT NULL DEFAULT 0,
  jobs_low INTEGER NOT NULL DEFAULT 0,
  jobs_filtered INTEGER NOT NULL DEFAULT 0,
  jobs_hard_rejected INTEGER NOT NULL DEFAULT 0,
  jobs_ai_rejected INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day_utc, provider_id, search_query, tier, country_key)
);

CREATE INDEX idx_statistics_daily_variant_lookup
  ON statistics_daily_variant (provider_id, day_utc DESC, tier, country_key);

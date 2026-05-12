-- Collapse search role tiering: legacy tier 2 roles are appended into tier 1
-- and all persisted planner/statistics rows should be treated as tier 1.

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('search_roles_tier1', '[]');
UPDATE app_settings
SET value = COALESCE(
  (
    SELECT json_group_array(value)
    FROM (
      SELECT value, MIN(ord) AS ord
      FROM (
    SELECT
      json_each.value AS value,
      0 AS bucket,
      json_each.key AS ord
    FROM app_settings, json_each(CASE WHEN json_valid(app_settings.value) THEN app_settings.value ELSE '[]' END)
    WHERE app_settings.key = 'search_roles_tier1'
      AND json_each.type = 'text'
      AND TRIM(json_each.value) <> ''

    UNION ALL

    SELECT
      json_each.value AS value,
      1000000 AS bucket,
      json_each.key + 1000000 AS ord
    FROM app_settings, json_each(CASE WHEN json_valid(app_settings.value) THEN app_settings.value ELSE '[]' END)
    WHERE app_settings.key = 'search_roles_tier2'
      AND json_each.type = 'text'
      AND TRIM(json_each.value) <> ''
      )
      GROUP BY LOWER(value)
      ORDER BY MIN(bucket), ord
    )
  ),
  '[]'
)
WHERE key = 'search_roles_tier1';

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('search_roles_tier2', '[]');
UPDATE app_settings SET value = '[]' WHERE key = 'search_roles_tier2';

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('search_roles_query_cache_quoted_or_tier1', '');
UPDATE app_settings
SET value = COALESCE(
  (
    SELECT GROUP_CONCAT('"' || REPLACE(value, '"', '') || '"', ' OR ')
    FROM json_each((SELECT value FROM app_settings WHERE key = 'search_roles_tier1'))
    WHERE type = 'text'
      AND TRIM(value) <> ''
  ),
  ''
)
WHERE key = 'search_roles_query_cache_quoted_or_tier1';

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('search_roles_query_cache_quoted_or_tier2', '');
UPDATE app_settings SET value = '' WHERE key = 'search_roles_query_cache_quoted_or_tier2';

UPDATE provider_query_unit_state SET tier = 1 WHERE tier <> 1;
UPDATE provider_unit_schedule_state SET tier = 1 WHERE tier <> 1;
UPDATE provider_scheduler_state
SET tier1_pick_count = tier1_pick_count + tier2_pick_count,
    tier2_pick_count = 0;

DROP TABLE IF EXISTS _statistics_daily_variant_tier_collapse;
CREATE TABLE _statistics_daily_variant_tier_collapse AS
SELECT
  day_utc,
  provider_id,
  search_query,
  1 AS tier,
  country_key,
  MAX(country_label) AS country_label,
  SUM(request_count) AS request_count,
  SUM(jobs_received) AS jobs_received,
  SUM(jobs_kept) AS jobs_kept,
  SUM(jobs_processed) AS jobs_processed,
  SUM(jobs_high) AS jobs_high,
  SUM(jobs_medium) AS jobs_medium,
  SUM(jobs_low) AS jobs_low,
  SUM(jobs_filtered) AS jobs_filtered,
  SUM(jobs_hard_rejected) AS jobs_hard_rejected,
  SUM(jobs_ai_rejected) AS jobs_ai_rejected,
  MAX(updated_at) AS updated_at
FROM statistics_daily_variant
GROUP BY day_utc, provider_id, search_query, country_key;

DELETE FROM statistics_daily_variant;

INSERT INTO statistics_daily_variant (
  day_utc,
  provider_id,
  search_query,
  tier,
  country_key,
  country_label,
  request_count,
  jobs_received,
  jobs_kept,
  jobs_processed,
  jobs_high,
  jobs_medium,
  jobs_low,
  jobs_filtered,
  jobs_hard_rejected,
  jobs_ai_rejected,
  updated_at
)
SELECT
  day_utc,
  provider_id,
  search_query,
  tier,
  country_key,
  country_label,
  request_count,
  jobs_received,
  jobs_kept,
  jobs_processed,
  jobs_high,
  jobs_medium,
  jobs_low,
  jobs_filtered,
  jobs_hard_rejected,
  jobs_ai_rejected,
  updated_at
FROM _statistics_daily_variant_tier_collapse;

DROP TABLE _statistics_daily_variant_tier_collapse;

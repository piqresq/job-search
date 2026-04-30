-- Pipeline vendor list for round-robin (overridden by dashboard; see app_settings.enabled_job_sources).
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('enabled_job_sources', '["linkedin_jobs","jsearch"]');

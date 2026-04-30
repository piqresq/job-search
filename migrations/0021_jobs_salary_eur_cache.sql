-- Pre-computed dashboard salary values so the list request never calls Frankfurter.
-- `salary_monthly_eur`: gross→net LV monthly amount in EUR (same formula the dashboard used at ingest time).
-- `salary_display_eur`: the exact string rendered in the list ("3,210 NET" or "N/A").
-- Rows are populated during ingest / salary updates and backfilled lazily by the scheduled cron.
ALTER TABLE jobs ADD COLUMN salary_monthly_eur REAL;
ALTER TABLE jobs ADD COLUMN salary_display_eur TEXT;

-- Keeps salary sort fast for progressive loading (NULL first, numeric after).
CREATE INDEX IF NOT EXISTS idx_jobs_salary_monthly_eur ON jobs(salary_monthly_eur);

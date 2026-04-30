ALTER TABLE app_logs ADD COLUMN severity TEXT;
ALTER TABLE app_logs ADD COLUMN category TEXT;
ALTER TABLE app_logs ADD COLUMN event_type TEXT;
ALTER TABLE app_logs ADD COLUMN provider_id TEXT;
ALTER TABLE app_logs ADD COLUMN job_id TEXT;
ALTER TABLE app_logs ADD COLUMN cycle_id TEXT;
ALTER TABLE app_logs ADD COLUMN phase TEXT;
ALTER TABLE app_logs ADD COLUMN fingerprint TEXT;
ALTER TABLE app_logs ADD COLUMN status_kind TEXT;

CREATE INDEX idx_app_logs_severity_ts ON app_logs (severity, ts DESC);
CREATE INDEX idx_app_logs_fingerprint_ts ON app_logs (fingerprint, ts DESC);

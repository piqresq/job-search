-- Dashboard Settings (API extraction master switch) and persisted app logs for Textbot.
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE app_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  scope TEXT NOT NULL,
  message TEXT NOT NULL,
  meta TEXT
);

CREATE INDEX idx_app_logs_ts ON app_logs (ts DESC);

-- Default: API extraction off (master switch).
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('api_extraction_enabled', '0');

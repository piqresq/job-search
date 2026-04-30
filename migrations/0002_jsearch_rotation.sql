-- Monotonic counters for JSearch query rotation (EU/US, language, employment mix over time)
CREATE TABLE IF NOT EXISTS jsearch_rotation (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0
);

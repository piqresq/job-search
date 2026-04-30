-- Fingerprint dedupe: SHA-256-derived hex (32 chars) over company|title|workplace|country|employment|salary.
ALTER TABLE jobs ADD COLUMN content_dedupe_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_jobs_content_dedupe_hash ON jobs(content_dedupe_hash);

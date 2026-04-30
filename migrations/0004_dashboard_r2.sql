-- Dashboard tabs, retention timestamps, R2 keys for generated DOCX
ALTER TABLE jobs ADD COLUMN dash_bucket TEXT;
ALTER TABLE jobs ADD COLUMN dash_moved_at INTEGER;
ALTER TABLE jobs ADD COLUMN r2_cv_key TEXT;
ALTER TABLE jobs ADD COLUMN r2_cover_key TEXT;

-- Backfill tab buckets from legacy rows
UPDATE jobs SET dash_bucket = 'filtered'
WHERE status IN ('hard_rejected', 'rejected_by_ai')
   OR recommendation = 'reject';

UPDATE jobs SET dash_bucket = 'active'
WHERE dash_bucket IS NULL
  AND scoring_json IS NOT NULL
  AND (recommendation IS NULL OR recommendation != 'reject')
  AND status NOT IN ('hard_rejected', 'rejected_by_ai');

UPDATE jobs SET dash_bucket = 'active'
WHERE dash_bucket IS NULL
  AND status IN ('pending_materials', 'review_email_sent', 'dashboard_open');

UPDATE jobs SET dash_bucket = 'accepted', dash_moved_at = updated_at
WHERE status = 'approved' AND dash_bucket IS NULL;

UPDATE jobs SET dash_bucket = 'denied', dash_moved_at = updated_at
WHERE status = 'rejected' AND dash_bucket IS NULL;

UPDATE jobs SET dash_bucket = 'active', status = 'dashboard_open'
WHERE dash_bucket IS NULL AND status = 'pending_materials';

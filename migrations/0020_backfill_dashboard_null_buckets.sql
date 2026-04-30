UPDATE jobs
SET
  dash_bucket = CASE
    WHEN status = 'hard_rejected' THEN 'filtered'
    WHEN status = 'rejected_by_ai' THEN 'filtered'
    WHEN status = 'approved' THEN 'accepted'
    WHEN status = 'rejected' THEN 'denied'
    ELSE 'active'
  END,
  dash_moved_at = CASE
    WHEN status IN ('approved', 'rejected') THEN COALESCE(dash_moved_at, updated_at, created_at)
    ELSE dash_moved_at
  END
WHERE dash_bucket IS NULL;

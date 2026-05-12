-- Persist Dashboard v2 kanban board state in D1 instead of browser localStorage.
-- Board membership is user-scoped and separate from the jobs dashboard buckets
-- (active / accepted / denied / filtered).

CREATE TABLE IF NOT EXISTS job_board_items (
  user_id    TEXT    NOT NULL,
  job_id     TEXT    NOT NULL,
  column_id  TEXT    NOT NULL CHECK (column_id IN ('new', 'applying', 'applied', 'interview', 'rejected')),
  position   INTEGER NOT NULL DEFAULT 0,
  entered_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  generating INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_job_board_items_column_position
  ON job_board_items (user_id, column_id, position);

CREATE INDEX IF NOT EXISTS idx_job_board_items_column_entered
  ON job_board_items (user_id, column_id, entered_at);

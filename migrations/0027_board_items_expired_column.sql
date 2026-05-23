-- Extend job_board_items.column_id CHECK constraint to include 'expired'.
-- SQLite does not support ALTER COLUMN, so we recreate the table.

CREATE TABLE IF NOT EXISTS job_board_items_new (
  user_id    TEXT    NOT NULL,
  job_id     TEXT    NOT NULL,
  column_id  TEXT    NOT NULL CHECK (column_id IN ('new', 'applying', 'applied', 'interview', 'rejected', 'expired')),
  position   INTEGER NOT NULL DEFAULT 0,
  entered_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  generating INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, job_id)
);

INSERT INTO job_board_items_new
  SELECT user_id, job_id, column_id, position, entered_at, updated_at, generating
  FROM job_board_items;

DROP TABLE job_board_items;

ALTER TABLE job_board_items_new RENAME TO job_board_items;

CREATE INDEX IF NOT EXISTS idx_job_board_items_column_position
  ON job_board_items (user_id, column_id, position);

CREATE INDEX IF NOT EXISTS idx_job_board_items_column_entered
  ON job_board_items (user_id, column_id, entered_at);

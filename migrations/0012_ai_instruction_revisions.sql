-- Append-only history for dashboard AI prompts (scoring + drafts snapshots).
CREATE TABLE ai_instruction_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  scoring TEXT NOT NULL,
  drafts TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'save'
);

CREATE INDEX idx_ai_instruction_revisions_created ON ai_instruction_revisions (created_at DESC);

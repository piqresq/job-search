-- Append-only history for dashboard job role tiers (tier1 + tier2 snapshots).

CREATE TABLE search_role_revisions (

  id INTEGER PRIMARY KEY AUTOINCREMENT,

  created_at INTEGER NOT NULL,

  tier1_json TEXT NOT NULL,

  tier2_json TEXT NOT NULL,

  source TEXT NOT NULL DEFAULT 'save',

  note TEXT NOT NULL DEFAULT ''

);



CREATE INDEX idx_search_role_revisions_created ON search_role_revisions (created_at DESC);



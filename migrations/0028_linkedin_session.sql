-- LinkedIn session storage for expiration scans.
-- Single row (id = 'global') holds the current li_at cookie blob and
-- control flags used by the tiered Worker-IP → Bright-Data scan path.

CREATE TABLE IF NOT EXISTS linkedin_session (
  id                              TEXT    PRIMARY KEY,
  cookies_json                    TEXT    NOT NULL DEFAULT '{}',
  li_at_expires_at                INTEGER NOT NULL DEFAULT 0,
  last_refresh_at                 INTEGER NOT NULL DEFAULT 0,
  refresh_count                   INTEGER NOT NULL DEFAULT 0,
  last_status                     TEXT    NOT NULL DEFAULT 'unknown',
  last_error                      TEXT    NULL,
  last_error_detail               TEXT    NULL,
  last_error_at                   INTEGER NULL,
  disabled_until_next_cron        INTEGER NOT NULL DEFAULT 0,
  force_brightdata_scans_until    INTEGER NOT NULL DEFAULT 0
);

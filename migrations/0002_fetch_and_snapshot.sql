-- What a fetch learns about a link, its stored reader-view text and its fetch events.

ALTER TABLE links ADD COLUMN final_url TEXT;
ALTER TABLE links ADD COLUMN http_status INTEGER;
ALTER TABLE links ADD COLUMN description TEXT;
ALTER TABLE links ADD COLUMN favicon_url TEXT;
ALTER TABLE links ADD COLUMN language TEXT;
ALTER TABLE links ADD COLUMN fetched_at TEXT;
-- Failed attempts of the first fetch; the third makes the link unreachable.
ALTER TABLE links ADD COLUMN fetch_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE links ADD COLUMN state_reason TEXT;
-- A JSON array of short notes, such as "truncated".
ALTER TABLE links ADD COLUMN notes TEXT NOT NULL DEFAULT '[]';
-- 'html', 'pdf' or 'other' once fetched.
ALTER TABLE links ADD COLUMN content_kind TEXT;
ALTER TABLE links ADD COLUMN has_snapshot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE links ADD COLUMN reader_empty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE links ADD COLUMN refresh_requested_at TEXT;
-- Set by every write to the link; read by the stream's change feed.
ALTER TABLE links ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE links SET updated_at = last_used_at;
CREATE INDEX links_updated ON links (user_id, updated_at);

-- The reader view's plain text, at most 500,000 characters, for search and enrichment.
CREATE TABLE link_texts (
  link_id TEXT PRIMARY KEY REFERENCES links (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  text TEXT NOT NULL
);

-- One row per fetch attempt.
CREATE TABLE link_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id TEXT NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  http_status INTEGER,
  reason TEXT
);
CREATE INDEX link_events_link ON link_events (link_id, at DESC, id DESC);

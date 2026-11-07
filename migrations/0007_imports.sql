-- Imports: one upload of a plain-text list of URLs, its report, and the links
-- it added, which are dispatched to the fetch worker through the throttle.

CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  url_lines INTEGER NOT NULL,
  added INTEGER NOT NULL,
  duplicates INTEGER NOT NULL,
  invalid INTEGER NOT NULL,
  not_imported INTEGER NOT NULL,
  -- JSON arrays: [{line, text}] and [{line, url}].
  invalid_lines TEXT NOT NULL,
  duplicate_lines TEXT NOT NULL,
  -- The first line not imported because the library was full, or NULL.
  stopped_line INTEGER
);
CREATE INDEX imports_user ON imports (user_id, created_at, id);

CREATE TABLE import_links (
  import_id TEXT NOT NULL REFERENCES imports (id) ON DELETE CASCADE,
  link_id TEXT NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  line INTEGER NOT NULL,
  -- When the link was sent to the fetch worker (the throttle slot it got), or NULL while it waits.
  dispatched_at TEXT,
  PRIMARY KEY (import_id, link_id)
);
CREATE INDEX import_links_link ON import_links (link_id);
CREATE INDEX import_links_waiting ON import_links (import_id, line) WHERE dispatched_at IS NULL;

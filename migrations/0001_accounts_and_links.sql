-- Accounts, sessions, personal access tokens, links and their uses.
-- Times are ISO 8601 strings in UTC with milliseconds, which sort as they compare.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  -- Lower-cased, as compared with the allow-list.
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- A session is stored by the SHA-256 hash of its identifier, never the identifier.
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- A token is stored by the SHA-256 hash of its secret, never the secret.
CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX tokens_user ON tokens (user_id, created_at);

CREATE TABLE links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The normalised URL, unique per user.
  url TEXT NOT NULL,
  -- The URL as it was given.
  original_url TEXT NOT NULL,
  host TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  added_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  -- 1..n within the user's pinned links, NULL when not pinned.
  pin_position INTEGER
);
CREATE UNIQUE INDEX links_user_url ON links (user_id, url);
CREATE INDEX links_stream ON links (user_id, last_used_at DESC, id DESC);
CREATE INDEX links_pinned ON links (user_id, pin_position) WHERE pin_position IS NOT NULL;

-- Every recorded use of a link, the source of its history.
CREATE TABLE link_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id TEXT NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  at TEXT NOT NULL
);
CREATE INDEX link_uses_link ON link_uses (link_id, at DESC, id DESC);

-- Requests per user per minute, for the API's rate limit.
CREATE TABLE rate_limits (
  user_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, window_start)
);

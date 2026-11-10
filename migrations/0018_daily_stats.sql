-- The daily record: per user and UTC day, how many events of each kind
-- happened, the library's size at the end of the day, and the AI token usage
-- of the user's provider calls. A counter only ever grows; deleting what it
-- counted leaves it as it is. Both tables carry user_id, so deleting the
-- account deletes them.

CREATE TABLE daily_stats (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- 'YYYY-MM-DD', a UTC day.
  day TEXT NOT NULL,
  added INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  expired INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  unarchived INTEGER NOT NULL DEFAULT 0,
  restored INTEGER NOT NULL DEFAULT 0,
  fetch_ok INTEGER NOT NULL DEFAULT 0,
  fetch_failed INTEGER NOT NULL DEFAULT 0,
  enriched INTEGER NOT NULL DEFAULT 0,
  enrichment_failed INTEGER NOT NULL DEFAULT 0,
  asks INTEGER NOT NULL DEFAULT 0,
  -- The library's size at the end of the day, NULL until recorded.
  size_total INTEGER,
  size_pending INTEGER,
  size_active INTEGER,
  size_unreachable INTEGER,
  size_expired INTEGER,
  size_archived INTEGER,
  PRIMARY KEY (user_id, day)
);

-- One row per user, UTC day, purpose (enrich, split, ask, key_test) and model.
CREATE TABLE daily_ai_usage (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  -- Calls whose answer reported no usage: failures, timeouts.
  calls_without_usage INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, purpose, model)
);

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

-- The counters the library's own writes move are counted by triggers, in the
-- same transaction as the write: a write that fails or is rolled back counts
-- nothing, and a stored one counts once, whichever path made it. The day is
-- the UTC day of the time the write stores (added_at, at, updated_at).

-- A new link, by pasting, the API, the MCP server or an import; a re-paste of
-- a link already there updates it instead, and adds nothing.
CREATE TRIGGER daily_link_added AFTER INSERT ON links
BEGIN
  INSERT INTO daily_stats (user_id, day, added) VALUES (new.user_id, substr(new.added_at, 1, 10), 1)
  ON CONFLICT (user_id, day) DO UPDATE SET added = added + 1;
END;

CREATE TRIGGER daily_link_used AFTER INSERT ON link_uses
BEGIN
  INSERT INTO daily_stats (user_id, day, used) VALUES (new.user_id, substr(new.at, 1, 10), 1)
  ON CONFLICT (user_id, day) DO UPDATE SET used = used + 1;
END;

-- An expired link made active again: by a use, a re-paste or the restore route.
CREATE TRIGGER daily_link_restored AFTER UPDATE OF state ON links
WHEN old.state = 'expired' AND new.state = 'active'
BEGIN
  INSERT INTO daily_stats (user_id, day, restored)
  VALUES (new.user_id, substr(new.updated_at, 1, 10), 1)
  ON CONFLICT (user_id, day) DO UPDATE SET restored = restored + 1;
END;

CREATE TRIGGER daily_link_archived AFTER UPDATE OF state ON links
WHEN old.state <> 'archived' AND new.state = 'archived'
BEGIN
  INSERT INTO daily_stats (user_id, day, archived)
  VALUES (new.user_id, substr(new.updated_at, 1, 10), 1)
  ON CONFLICT (user_id, day) DO UPDATE SET archived = archived + 1;
END;

CREATE TRIGGER daily_link_unarchived AFTER UPDATE OF state ON links
WHEN old.state = 'archived' AND new.state <> 'archived'
BEGIN
  INSERT INTO daily_stats (user_id, day, unarchived)
  VALUES (new.user_id, substr(new.updated_at, 1, 10), 1)
  ON CONFLICT (user_id, day) DO UPDATE SET unarchived = unarchived + 1;
END;

-- Decay is the only write that makes a link expired.
CREATE TRIGGER daily_link_expired AFTER UPDATE OF state ON links
WHEN old.state <> 'expired' AND new.state = 'expired'
BEGIN
  INSERT INTO daily_stats (user_id, day, expired)
  VALUES (new.user_id, substr(new.updated_at, 1, 10), 1)
  ON CONFLICT (user_id, day) DO UPDATE SET expired = expired + 1;
END;

-- Every fetch attempt recorded, by the fetch worker or the archive refresh.
CREATE TRIGGER daily_fetch_event AFTER INSERT ON link_events
WHEN new.kind = 'fetch'
BEGIN
  INSERT INTO daily_stats (user_id, day, fetch_ok, fetch_failed)
  VALUES (new.user_id, substr(new.at, 1, 10), new.outcome = 'ok', new.outcome <> 'ok')
  ON CONFLICT (user_id, day) DO UPDATE SET
    fetch_ok = fetch_ok + excluded.fetch_ok, fetch_failed = fetch_failed + excluded.fetch_failed;
END;

-- An enrichment's result stored: every store sets a new enriched_at.
CREATE TRIGGER daily_link_enriched AFTER UPDATE OF enriched_at ON links
WHEN new.enriched_at IS NOT NULL AND new.enriched_at IS NOT old.enriched_at
BEGIN
  INSERT INTO daily_stats (user_id, day, enriched)
  VALUES (new.user_id, substr(new.enriched_at, 1, 10), 1)
  ON CONFLICT (user_id, day) DO UPDATE SET enriched = enriched + 1;
END;

-- An enrichment's failure stored: each failed attempt writes the status again.
CREATE TRIGGER daily_link_enrichment_failed AFTER UPDATE OF enrichment_status ON links
WHEN new.enrichment_status = 'failed'
BEGIN
  INSERT INTO daily_stats (user_id, day, enrichment_failed)
  VALUES (new.user_id, substr(new.updated_at, 1, 10), 1)
  ON CONFLICT (user_id, day) DO UPDATE SET enrichment_failed = enrichment_failed + 1;
END;

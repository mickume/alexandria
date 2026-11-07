-- The owner's AI provider and key, the background throttle, and each link's
-- summary, tags and topic.

ALTER TABLE users ADD COLUMN ai_provider TEXT;
ALTER TABLE users ADD COLUMN ai_model TEXT;
-- AES-GCM ciphertext and IV of the key, both base64; never the key itself.
ALTER TABLE users ADD COLUMN ai_key_ciphertext TEXT;
ALTER TABLE users ADD COLUMN ai_key_iv TEXT;
ALTER TABLE users ADD COLUMN ai_key_last4 TEXT;
-- 'verified' or 'rejected'.
ALTER TABLE users ADD COLUMN ai_key_status TEXT;
ALTER TABLE users ADD COLUMN ai_key_rejected_message TEXT;
-- Milliseconds since the epoch of the user's next free background slot.
ALTER TABLE users ADD COLUMN throttle_next_at INTEGER;
-- When the user's last background job actually started, so that starts stay 3 seconds apart.
ALTER TABLE users ADD COLUMN throttle_last_start INTEGER;

ALTER TABLE links ADD COLUMN summary TEXT;
ALTER TABLE links ADD COLUMN topic_id TEXT;
ALTER TABLE links ADD COLUMN enriched_at TEXT;
-- no_key, queued, enriched, failed, skipped or waiting_for_key; NULL before the first fetch.
ALTER TABLE links ADD COLUMN enrichment_status TEXT;
ALTER TABLE links ADD COLUMN enrichment_reason TEXT;
-- A JSON array of the fields the owner has set by hand.
ALTER TABLE links ADD COLUMN edited_fields TEXT NOT NULL DEFAULT '[]';
CREATE INDEX links_enrichment ON links (user_id, enrichment_status);

CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
CREATE UNIQUE INDEX topics_user_name ON topics (user_id, name COLLATE NOCASE);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
CREATE UNIQUE INDEX tags_user_name ON tags (user_id, name COLLATE NOCASE);

CREATE TABLE link_tags (
  link_id TEXT NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (link_id, tag_id)
);
CREATE INDEX link_tags_tag ON link_tags (tag_id);

-- A link as it is read: with its topic's name and its tags' names in order.
CREATE VIEW link_views AS
SELECT
  l.*,
  tp.name AS topic,
  COALESCE(
    (SELECT json_group_array(name) FROM (
       SELECT t.name AS name FROM link_tags lt JOIN tags t ON t.id = lt.tag_id
       WHERE lt.link_id = l.id ORDER BY lt.position)),
    '[]'
  ) AS tags_json
FROM links l
LEFT JOIN topics tp ON tp.id = l.topic_id;

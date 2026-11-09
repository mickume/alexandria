-- Search by meaning: the passages each link is cut into, the text version that
-- tells when they are out of date, and the vectors waiting to be deleted.

-- One row per passage of a link's text, and per vector in the index: the vector
-- id is {link_id}:{version}:{position}, so a vector made from older text never
-- matches a current row.
CREATE TABLE link_passages (
  vector_id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The link's text version when the passage was made.
  version INTEGER NOT NULL,
  position INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX link_passages_link ON link_passages (link_id, version);
CREATE INDEX link_passages_user ON link_passages (user_id);

-- The link's text version, which moves with every change of the text that is
-- indexed, and when the link was last queued for indexing. A link without a row
-- is at version 0. A link is stale when no passage of it carries its version.
CREATE TABLE link_index_state (
  link_id TEXT PRIMARY KEY REFERENCES links (id) ON DELETE CASCADE,
  text_version INTEGER NOT NULL DEFAULT 0,
  queued_at TEXT
);

-- The ids of vectors to delete from the index. Every deleted passage queues its
-- vector here, whichever way it was deleted; the every-minute run drains it.
-- There is no foreign key: the rows outlive the link and the account.
CREATE TABLE vector_deletions (
  vector_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL
);

CREATE TRIGGER link_passages_removed AFTER DELETE ON link_passages
BEGIN
  INSERT INTO vector_deletions (vector_id, user_id) VALUES (old.vector_id, old.user_id)
  ON CONFLICT (vector_id) DO NOTHING;
END;

-- The text version moves whenever the title, summary, topic, tags, note or
-- reader text of a link changes, as link_search follows the same changes.
CREATE TRIGGER link_text_version_link AFTER UPDATE OF title, summary, topic_id, note ON links
WHEN new.title IS NOT old.title OR new.summary IS NOT old.summary
  OR new.topic_id IS NOT old.topic_id OR new.note IS NOT old.note
BEGIN
  INSERT INTO link_index_state (link_id, text_version) VALUES (new.id, 1)
  ON CONFLICT (link_id) DO UPDATE SET text_version = text_version + 1;
END;

CREATE TRIGGER link_text_version_tag_added AFTER INSERT ON link_tags
BEGIN
  INSERT INTO link_index_state (link_id, text_version) VALUES (new.link_id, 1)
  ON CONFLICT (link_id) DO UPDATE SET text_version = text_version + 1;
END;

-- A link being deleted loses its tags and text on the way: it needs no version then.
CREATE TRIGGER link_text_version_tag_removed AFTER DELETE ON link_tags
WHEN EXISTS (SELECT 1 FROM links WHERE id = old.link_id)
BEGIN
  INSERT INTO link_index_state (link_id, text_version) VALUES (old.link_id, 1)
  ON CONFLICT (link_id) DO UPDATE SET text_version = text_version + 1;
END;

CREATE TRIGGER link_text_version_text_stored AFTER INSERT ON link_texts
BEGIN
  INSERT INTO link_index_state (link_id, text_version) VALUES (new.link_id, 1)
  ON CONFLICT (link_id) DO UPDATE SET text_version = text_version + 1;
END;

CREATE TRIGGER link_text_version_text_removed AFTER DELETE ON link_texts
WHEN EXISTS (SELECT 1 FROM links WHERE id = old.link_id)
BEGIN
  INSERT INTO link_index_state (link_id, text_version) VALUES (old.link_id, 1)
  ON CONFLICT (link_id) DO UPDATE SET text_version = text_version + 1;
END;

CREATE TRIGGER link_text_version_topic_renamed AFTER UPDATE OF name ON topics
WHEN new.name IS NOT old.name
BEGIN
  INSERT INTO link_index_state (link_id, text_version)
  SELECT id, 1 FROM links WHERE topic_id = new.id AND true
  ON CONFLICT (link_id) DO UPDATE SET text_version = text_version + 1;
END;

CREATE TRIGGER link_text_version_tag_renamed AFTER UPDATE OF name ON tags
WHEN new.name IS NOT old.name
BEGIN
  INSERT INTO link_index_state (link_id, text_version)
  SELECT link_id, 1 FROM link_tags WHERE tag_id = new.id AND true
  ON CONFLICT (link_id) DO UPDATE SET text_version = text_version + 1;
END;

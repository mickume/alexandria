-- Search: a full-text index of every link, kept current by triggers.

-- The FTS5 rowid of each link's index row; links have text ids.
CREATE TABLE link_search_keys (
  id INTEGER PRIMARY KEY,
  link_id TEXT NOT NULL UNIQUE
);

-- One row per link. owner holds 'u' and the user's id without hyphens, one
-- term every query must match. It comes last, so that a snippet's column is
-- never chosen for it.
CREATE VIRTUAL TABLE link_search USING fts5(
  title, tags, topic, summary, host, original_url, note, reader_text, owner,
  link_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE INDEX links_topic ON links (topic_id);

CREATE TRIGGER link_search_insert AFTER INSERT ON links BEGIN
  INSERT INTO link_search_keys (link_id) VALUES (new.id);
  INSERT INTO link_search (rowid, title, tags, topic, summary, host, original_url, note, reader_text, owner, link_id)
  VALUES ((SELECT id FROM link_search_keys WHERE link_id = new.id), new.title, COALESCE((SELECT group_concat(t.name, ' ') FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = new.id), ''), COALESCE((SELECT name FROM topics WHERE id = new.topic_id), ''),
    COALESCE(new.summary, ''), new.host, new.original_url, new.note, '',
    'u' || replace(new.user_id, '-', ''), new.id);
END;

CREATE TRIGGER link_search_update AFTER UPDATE OF title, summary, host, original_url, note, topic_id ON links
WHEN new.title IS NOT old.title OR new.summary IS NOT old.summary OR new.host IS NOT old.host
  OR new.original_url IS NOT old.original_url OR new.note IS NOT old.note OR new.topic_id IS NOT old.topic_id
BEGIN
  UPDATE link_search SET title = new.title, topic = COALESCE((SELECT name FROM topics WHERE id = new.topic_id), ''), summary = COALESCE(new.summary, ''),
    host = new.host, original_url = new.original_url, note = new.note
  WHERE rowid = (SELECT id FROM link_search_keys WHERE link_id = new.id);
END;

CREATE TRIGGER link_search_delete AFTER DELETE ON links BEGIN
  DELETE FROM link_search WHERE rowid = (SELECT id FROM link_search_keys WHERE link_id = old.id);
  DELETE FROM link_search_keys WHERE link_id = old.id;
END;

CREATE TRIGGER link_search_tag_added AFTER INSERT ON link_tags BEGIN
  UPDATE link_search SET tags = COALESCE((SELECT group_concat(t.name, ' ') FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = new.link_id), '') WHERE rowid = (SELECT id FROM link_search_keys WHERE link_id = new.link_id);
END;

CREATE TRIGGER link_search_tag_removed AFTER DELETE ON link_tags BEGIN
  UPDATE link_search SET tags = COALESCE((SELECT group_concat(t.name, ' ') FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = old.link_id), '') WHERE rowid = (SELECT id FROM link_search_keys WHERE link_id = old.link_id);
END;

CREATE TRIGGER link_search_topic_renamed AFTER UPDATE OF name ON topics
WHEN new.name IS NOT old.name
BEGIN
  UPDATE link_search SET topic = new.name
  WHERE rowid IN (SELECT k.id FROM links l JOIN link_search_keys k ON k.link_id = l.id WHERE l.topic_id = new.id);
END;

CREATE TRIGGER link_search_tag_renamed AFTER UPDATE OF name ON tags
WHEN new.name IS NOT old.name
BEGIN
  UPDATE link_search SET tags = COALESCE((SELECT group_concat(t.name, ' ') FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = link_search.link_id), '')
  WHERE rowid IN (SELECT k.id FROM link_tags lt JOIN link_search_keys k ON k.link_id = lt.link_id WHERE lt.tag_id = new.id);
END;

-- The links stored before this migration, with the reader text already fetched.
INSERT INTO link_search_keys (link_id) SELECT id FROM links;
INSERT INTO link_search (rowid, title, tags, topic, summary, host, original_url, note, reader_text, owner, link_id)
SELECT k.id, l.title, COALESCE((SELECT group_concat(t.name, ' ') FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = l.id), ''), COALESCE((SELECT name FROM topics WHERE id = l.topic_id), ''), COALESCE(l.summary, ''), l.host,
  l.original_url, l.note, COALESCE((SELECT substr(text, 1, 500000) FROM link_texts WHERE link_id = l.id), ''),
  'u' || replace(l.user_id, '-', ''), l.id
FROM links l JOIN link_search_keys k ON k.link_id = l.id;

-- Workspaces are searched on their name, description and note.
CREATE TABLE workspace_search_keys (
  id INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE
);

CREATE VIRTUAL TABLE workspace_search USING fts5(
  name, description, note, owner,
  workspace_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER workspace_search_insert AFTER INSERT ON workspaces BEGIN
  INSERT INTO workspace_search_keys (workspace_id) VALUES (new.id);
  INSERT INTO workspace_search (rowid, name, description, note, owner, workspace_id)
  VALUES ((SELECT id FROM workspace_search_keys WHERE workspace_id = new.id), new.name,
    new.description, new.note, 'u' || replace(new.user_id, '-', ''), new.id);
END;

CREATE TRIGGER workspace_search_update AFTER UPDATE OF name, description, note ON workspaces
WHEN new.name IS NOT old.name OR new.description IS NOT old.description OR new.note IS NOT old.note
BEGIN
  UPDATE workspace_search SET name = new.name, description = new.description, note = new.note
  WHERE rowid = (SELECT id FROM workspace_search_keys WHERE workspace_id = new.id);
END;

CREATE TRIGGER workspace_search_delete AFTER DELETE ON workspaces BEGIN
  DELETE FROM workspace_search WHERE rowid = (SELECT id FROM workspace_search_keys WHERE workspace_id = old.id);
  DELETE FROM workspace_search_keys WHERE workspace_id = old.id;
END;

INSERT INTO workspace_search_keys (workspace_id) SELECT id FROM workspaces;
INSERT INTO workspace_search (rowid, name, description, note, owner, workspace_id)
SELECT k.id, w.name, w.description, w.note, 'u' || replace(w.user_id, '-', ''), w.id
FROM workspaces w JOIN workspace_search_keys k ON k.workspace_id = w.id;

-- A topic or tag whose last link loses it is deleted, so that it is neither
-- listed nor offered to enrichment.
CREATE TRIGGER tags_drop_unused AFTER DELETE ON link_tags
WHEN NOT EXISTS (SELECT 1 FROM link_tags WHERE tag_id = old.tag_id)
BEGIN
  DELETE FROM tags WHERE id = old.tag_id;
END;

CREATE TRIGGER topics_drop_unused AFTER UPDATE OF topic_id ON links
WHEN old.topic_id IS NOT NULL AND old.topic_id IS NOT new.topic_id
  AND NOT EXISTS (SELECT 1 FROM links WHERE topic_id = old.topic_id)
BEGIN
  DELETE FROM topics WHERE id = old.topic_id;
END;

CREATE TRIGGER topics_drop_unused_with_link AFTER DELETE ON links
WHEN old.topic_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM links WHERE topic_id = old.topic_id)
BEGIN
  DELETE FROM topics WHERE id = old.topic_id;
END;

DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM link_tags);
DELETE FROM topics WHERE id NOT IN (SELECT topic_id FROM links WHERE topic_id IS NOT NULL);

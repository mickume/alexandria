-- The word index and the meaning index follow a link's topic path: the
-- index's topic column holds every name of the path, from the top level
-- down, and renaming a topic re-indexes the links filed under it or under a
-- topic beneath it (at most two levels).

DROP TRIGGER link_search_insert;
CREATE TRIGGER link_search_insert AFTER INSERT ON links BEGIN
  INSERT INTO link_search_keys (link_id) VALUES (new.id);
  INSERT INTO link_search (rowid, title, tags, topic, summary, host, original_url, note, reader_text, owner, link_id)
  VALUES ((SELECT id FROM link_search_keys WHERE link_id = new.id), new.title,
    COALESCE((SELECT group_concat(t.name, ' ') FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = new.id), ''),
    COALESCE((SELECT trim(COALESCE(p2.name || ' ', '') || COALESCE(p1.name || ' ', '') || tp.name)
      FROM topics tp LEFT JOIN topics p1 ON p1.id = tp.parent_id LEFT JOIN topics p2 ON p2.id = p1.parent_id
      WHERE tp.id = new.topic_id), ''),
    COALESCE(new.summary, ''), new.host, new.original_url, new.note, '',
    'u' || replace(new.user_id, '-', ''), new.id);
END;

DROP TRIGGER link_search_update;
CREATE TRIGGER link_search_update AFTER UPDATE OF title, summary, host, original_url, note, topic_id ON links
WHEN new.title IS NOT old.title OR new.summary IS NOT old.summary OR new.host IS NOT old.host
  OR new.original_url IS NOT old.original_url OR new.note IS NOT old.note OR new.topic_id IS NOT old.topic_id
BEGIN
  UPDATE link_search SET title = new.title,
    topic = COALESCE((SELECT trim(COALESCE(p2.name || ' ', '') || COALESCE(p1.name || ' ', '') || tp.name)
      FROM topics tp LEFT JOIN topics p1 ON p1.id = tp.parent_id LEFT JOIN topics p2 ON p2.id = p1.parent_id
      WHERE tp.id = new.topic_id), ''),
    summary = COALESCE(new.summary, ''), host = new.host, original_url = new.original_url, note = new.note
  WHERE rowid = (SELECT id FROM link_search_keys WHERE link_id = new.id);
END;

DROP TRIGGER link_search_topic_renamed;
CREATE TRIGGER link_search_topic_renamed AFTER UPDATE OF name ON topics
WHEN new.name IS NOT old.name
BEGIN
  UPDATE link_search SET topic = COALESCE(
    (SELECT trim(COALESCE(p2.name || ' ', '') || COALESCE(p1.name || ' ', '') || tp.name)
     FROM links l JOIN topics tp ON tp.id = l.topic_id
       LEFT JOIN topics p1 ON p1.id = tp.parent_id LEFT JOIN topics p2 ON p2.id = p1.parent_id
     WHERE l.id = link_search.link_id), '')
  WHERE rowid IN (
    SELECT k.id FROM links l JOIN link_search_keys k ON k.link_id = l.id
    WHERE l.topic_id IN (SELECT id FROM topics WHERE id = new.id OR parent_id = new.id
      OR parent_id IN (SELECT c.id FROM topics c WHERE c.parent_id = new.id)));
END;

DROP TRIGGER link_text_version_topic_renamed;
CREATE TRIGGER link_text_version_topic_renamed AFTER UPDATE OF name ON topics
WHEN new.name IS NOT old.name
BEGIN
  INSERT INTO link_index_state (link_id, text_version)
  SELECT id, 1 FROM links
  WHERE topic_id IN (SELECT id FROM topics WHERE id = new.id OR parent_id = new.id
    OR parent_id IN (SELECT c.id FROM topics c WHERE c.parent_id = new.id))
  ON CONFLICT (link_id) DO UPDATE SET text_version = text_version + 1;
END;

-- The links stored before this migration: their topic paths are a single name.
UPDATE link_search SET topic = COALESCE(
  (SELECT trim(COALESCE(p2.name || ' ', '') || COALESCE(p1.name || ' ', '') || tp.name)
   FROM links l JOIN topics tp ON tp.id = l.topic_id
     LEFT JOIN topics p1 ON p1.id = tp.parent_id LEFT JOIN topics p2 ON p2.id = p1.parent_id
   WHERE l.id = link_search.link_id), '');

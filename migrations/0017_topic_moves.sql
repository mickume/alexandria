-- A topic moved to another parent changes the topic path of every link filed
-- under it or under a topic beneath it (at most two levels): their rows of
-- the word index are rewritten and their text version moves.

CREATE TRIGGER link_search_topic_moved AFTER UPDATE OF parent_id ON topics
WHEN new.parent_id IS NOT old.parent_id
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

CREATE TRIGGER link_text_version_topic_moved AFTER UPDATE OF parent_id ON topics
WHEN new.parent_id IS NOT old.parent_id
BEGIN
  INSERT INTO link_index_state (link_id, text_version)
  SELECT id, 1 FROM links
  WHERE topic_id IN (SELECT id FROM topics WHERE id = new.id OR parent_id = new.id
    OR parent_id IN (SELECT c.id FROM topics c WHERE c.parent_id = new.id))
  ON CONFLICT (link_id) DO UPDATE SET text_version = text_version + 1;
END;

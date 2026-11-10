-- Topics arranged in a tree of at most three levels: a topic has one parent
-- or none. Every existing topic becomes a top-level topic, and `>`, which now
-- separates the names of a topic path, leaves every topic name.

-- No foreign key: the triggers below delete a topic's emptied ancestors from
-- the top down, while their children still name them.
ALTER TABLE topics ADD COLUMN parent_id TEXT;
CREATE INDEX topics_parent ON topics (parent_id);

-- A topic is deleted when it has no link filed directly under it and no child
-- topic, and so is each ancestor that deletion leaves the same way. D1 runs
-- without recursive triggers, so the (at most two) ancestors are deleted here,
-- the grandparent first, each on the condition that its descendants go too.
DROP TRIGGER topics_drop_unused;
DROP TRIGGER topics_drop_unused_with_link;

CREATE TRIGGER topics_drop_unused AFTER UPDATE OF topic_id ON links
WHEN old.topic_id IS NOT NULL AND old.topic_id IS NOT new.topic_id
BEGIN
  DELETE FROM topics
  WHERE id = (SELECT p.parent_id FROM topics c JOIN topics p ON p.id = c.parent_id WHERE c.id = old.topic_id)
    AND NOT EXISTS (SELECT 1 FROM links WHERE topic_id = old.topic_id)
    AND NOT EXISTS (SELECT 1 FROM topics k WHERE k.parent_id = old.topic_id)
    AND NOT EXISTS (SELECT 1 FROM links WHERE topic_id = (SELECT parent_id FROM topics k WHERE k.id = old.topic_id))
    AND NOT EXISTS (SELECT 1 FROM topics k WHERE k.parent_id = (SELECT parent_id FROM topics j WHERE j.id = old.topic_id) AND k.id <> old.topic_id)
    AND NOT EXISTS (SELECT 1 FROM links l WHERE l.topic_id = topics.id)
    AND NOT EXISTS (SELECT 1 FROM topics k WHERE k.parent_id = topics.id AND k.id <> (SELECT parent_id FROM topics j WHERE j.id = old.topic_id));
  DELETE FROM topics
  WHERE id = (SELECT parent_id FROM topics k WHERE k.id = old.topic_id)
    AND NOT EXISTS (SELECT 1 FROM links WHERE topic_id = old.topic_id)
    AND NOT EXISTS (SELECT 1 FROM topics k WHERE k.parent_id = old.topic_id)
    AND NOT EXISTS (SELECT 1 FROM links l WHERE l.topic_id = topics.id)
    AND NOT EXISTS (SELECT 1 FROM topics k WHERE k.parent_id = topics.id AND k.id <> old.topic_id);
  DELETE FROM topics
  WHERE id = old.topic_id
    AND NOT EXISTS (SELECT 1 FROM links WHERE topic_id = old.topic_id)
    AND NOT EXISTS (SELECT 1 FROM topics k WHERE k.parent_id = old.topic_id);
END;

CREATE TRIGGER topics_drop_unused_with_link AFTER DELETE ON links
WHEN old.topic_id IS NOT NULL
BEGIN
  DELETE FROM topics
  WHERE id = (SELECT p.parent_id FROM topics c JOIN topics p ON p.id = c.parent_id WHERE c.id = old.topic_id)
    AND NOT EXISTS (SELECT 1 FROM links WHERE topic_id = old.topic_id)
    AND NOT EXISTS (SELECT 1 FROM topics k WHERE k.parent_id = old.topic_id)
    AND NOT EXISTS (SELECT 1 FROM links WHERE topic_id = (SELECT parent_id FROM topics k WHERE k.id = old.topic_id))
    AND NOT EXISTS (SELECT 1 FROM topics k WHERE k.parent_id = (SELECT parent_id FROM topics j WHERE j.id = old.topic_id) AND k.id <> old.topic_id)
    AND NOT EXISTS (SELECT 1 FROM links l WHERE l.topic_id = topics.id)
    AND NOT EXISTS (SELECT 1 FROM topics k WHERE k.parent_id = topics.id AND k.id <> (SELECT parent_id FROM topics j WHERE j.id = old.topic_id));
  DELETE FROM topics
  WHERE id = (SELECT parent_id FROM topics k WHERE k.id = old.topic_id)
    AND NOT EXISTS (SELECT 1 FROM links WHERE topic_id = old.topic_id)
    AND NOT EXISTS (SELECT 1 FROM topics k WHERE k.parent_id = old.topic_id)
    AND NOT EXISTS (SELECT 1 FROM links l WHERE l.topic_id = topics.id)
    AND NOT EXISTS (SELECT 1 FROM topics k WHERE k.parent_id = topics.id AND k.id <> old.topic_id);
  DELETE FROM topics
  WHERE id = old.topic_id
    AND NOT EXISTS (SELECT 1 FROM links WHERE topic_id = old.topic_id)
    AND NOT EXISTS (SELECT 1 FROM topics k WHERE k.parent_id = old.topic_id);
END;

-- `>` leaves topic names: each is replaced by `-`, the former name kept as an
-- alias. A topic whose new name another topic already has is merged into that
-- one, as a merge does: its aliases and links move, its name becomes an alias.
-- The merge runs before and after the renames, so that of two names that
-- become one, the first is renamed and the second merged into it.

-- Merge: the topics with `>` whose new name another topic without `>` has.
UPDATE topic_aliases SET topic_id = (
  SELECT t.id FROM topics s JOIN topics t ON t.user_id = s.user_id
    AND t.name = replace(s.name, '>', '-') COLLATE NOCASE AND t.name NOT LIKE '%>%'
  WHERE s.id = topic_aliases.topic_id)
WHERE topic_id IN (
  SELECT s.id FROM topics s JOIN topics t ON t.user_id = s.user_id
    AND t.name = replace(s.name, '>', '-') COLLATE NOCASE AND t.name NOT LIKE '%>%'
  WHERE s.name LIKE '%>%');
INSERT OR REPLACE INTO topic_aliases (user_id, name, topic_id)
SELECT s.user_id, s.name, t.id FROM topics s JOIN topics t ON t.user_id = s.user_id
  AND t.name = replace(s.name, '>', '-') COLLATE NOCASE AND t.name NOT LIKE '%>%'
WHERE s.name LIKE '%>%';
UPDATE links SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), topic_id = (
  SELECT t.id FROM topics s JOIN topics t ON t.user_id = s.user_id
    AND t.name = replace(s.name, '>', '-') COLLATE NOCASE AND t.name NOT LIKE '%>%'
  WHERE s.id = links.topic_id)
WHERE topic_id IN (
  SELECT s.id FROM topics s JOIN topics t ON t.user_id = s.user_id
    AND t.name = replace(s.name, '>', '-') COLLATE NOCASE AND t.name NOT LIKE '%>%'
  WHERE s.name LIKE '%>%');
DELETE FROM topics WHERE name LIKE '%>%' AND EXISTS (
  SELECT 1 FROM topics t WHERE t.user_id = topics.user_id
    AND t.name = replace(topics.name, '>', '-') COLLATE NOCASE AND t.name NOT LIKE '%>%');

-- Rename: of the topics with `>` whose new names are one, the first.
INSERT OR REPLACE INTO topic_aliases (user_id, name, topic_id)
SELECT s.user_id, s.name, s.id FROM topics s
WHERE s.name LIKE '%>%' AND s.rowid = (
  SELECT min(k.rowid) FROM topics k WHERE k.user_id = s.user_id
    AND replace(k.name, '>', '-') = replace(s.name, '>', '-') COLLATE NOCASE);
UPDATE topics SET name = replace(name, '>', '-')
WHERE name LIKE '%>%' AND rowid = (
  SELECT min(k.rowid) FROM topics k WHERE k.user_id = topics.user_id
    AND replace(k.name, '>', '-') = replace(topics.name, '>', '-') COLLATE NOCASE);

-- Merge again: the rest, into the topics just renamed.
UPDATE topic_aliases SET topic_id = (
  SELECT t.id FROM topics s JOIN topics t ON t.user_id = s.user_id
    AND t.name = replace(s.name, '>', '-') COLLATE NOCASE AND t.name NOT LIKE '%>%'
  WHERE s.id = topic_aliases.topic_id)
WHERE topic_id IN (
  SELECT s.id FROM topics s JOIN topics t ON t.user_id = s.user_id
    AND t.name = replace(s.name, '>', '-') COLLATE NOCASE AND t.name NOT LIKE '%>%'
  WHERE s.name LIKE '%>%');
INSERT OR REPLACE INTO topic_aliases (user_id, name, topic_id)
SELECT s.user_id, s.name, t.id FROM topics s JOIN topics t ON t.user_id = s.user_id
  AND t.name = replace(s.name, '>', '-') COLLATE NOCASE AND t.name NOT LIKE '%>%'
WHERE s.name LIKE '%>%';
UPDATE links SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), topic_id = (
  SELECT t.id FROM topics s JOIN topics t ON t.user_id = s.user_id
    AND t.name = replace(s.name, '>', '-') COLLATE NOCASE AND t.name NOT LIKE '%>%'
  WHERE s.id = links.topic_id)
WHERE topic_id IN (
  SELECT s.id FROM topics s JOIN topics t ON t.user_id = s.user_id
    AND t.name = replace(s.name, '>', '-') COLLATE NOCASE AND t.name NOT LIKE '%>%'
  WHERE s.name LIKE '%>%');
DELETE FROM topics WHERE name LIKE '%>%' AND EXISTS (
  SELECT 1 FROM topics t WHERE t.user_id = topics.user_id
    AND t.name = replace(topics.name, '>', '-') COLLATE NOCASE AND t.name NOT LIKE '%>%');

-- A name that is current again is no longer an alias.
DELETE FROM topic_aliases WHERE EXISTS (
  SELECT 1 FROM topics t WHERE t.user_id = topic_aliases.user_id
    AND t.name = topic_aliases.name COLLATE NOCASE);

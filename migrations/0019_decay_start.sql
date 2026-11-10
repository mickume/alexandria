-- The decay start: a link's points count down from decay_from, the time its
-- decay counts from, while last_used_at keeps the time of its last use or
-- boost. A use wins back use_boost percent of the time decayed; a boost
-- resets it. Every link starts its decay at its last use, so no link's points
-- change on deploy.

ALTER TABLE links ADD COLUMN decay_from TEXT;
UPDATE links SET decay_from = last_used_at;

-- A link inserted without a decay start decays from its last use, so every
-- link has one whatever wrote it.
CREATE TRIGGER links_decay_from AFTER INSERT ON links
WHEN new.decay_from IS NULL
BEGIN
  UPDATE links SET decay_from = new.last_used_at WHERE id = new.id;
END;

-- The share, in percent, of the time decayed that the first use of a link on a
-- UTC day wins back.
ALTER TABLE users ADD COLUMN use_boost INTEGER NOT NULL DEFAULT 50;

-- A link as it is read, now with its decay start.
DROP VIEW link_views;
CREATE VIEW link_views AS
SELECT
  l.*,
  tp.name AS topic,
  CASE
    WHEN tp.id IS NULL THEN '[]'
    WHEN p1.id IS NULL THEN json_array(tp.name)
    WHEN p2.id IS NULL THEN json_array(p1.name, tp.name)
    ELSE json_array(p2.name, p1.name, tp.name)
  END AS topic_path_json,
  COALESCE(
    (SELECT json_group_array(name) FROM (
       SELECT t.name AS name FROM link_tags lt JOIN tags t ON t.id = lt.tag_id
       WHERE lt.link_id = l.id ORDER BY lt.position)),
    '[]'
  ) AS tags_json,
  COALESCE(
    (SELECT json_group_array(json_object('id', id, 'name', name)) FROM (
       SELECT w.id AS id, w.name AS name FROM workspace_links wl JOIN workspaces w ON w.id = wl.workspace_id
       WHERE wl.link_id = l.id ORDER BY w.name_key, w.id)),
    '[]'
  ) AS workspaces_json,
  (SELECT start_points FROM users WHERE users.id = l.user_id) AS user_start_points,
  (SELECT remove_days FROM users WHERE users.id = l.user_id) AS user_remove_days
FROM links l
LEFT JOIN topics tp ON tp.id = l.topic_id
LEFT JOIN topics p1 ON p1.id = tp.parent_id
LEFT JOIN topics p2 ON p2.id = p1.parent_id;

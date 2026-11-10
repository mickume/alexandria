-- A link as it is read gains its topic path: the names from its top-level
-- topic down to its own topic, as a JSON array ('[]' without a topic).
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

-- Points and expiry: a link's points are computed from its user's start
-- points, its use count and the days since its last use; a link whose points
-- run out is expired, and removed remove_days later.

-- The start points take over from the dormant threshold.
ALTER TABLE users ADD COLUMN start_points INTEGER NOT NULL DEFAULT 60;
UPDATE users SET start_points = dormant_days;
ALTER TABLE users DROP COLUMN dormant_days;
-- A link expires when its points run out, not after a fixed time.
ALTER TABLE users DROP COLUMN archive_days;

-- What decay used to call archived is expired, from the same date, so its
-- removal date does not change; there is no dormant state any more.
ALTER TABLE links ADD COLUMN expired_at TEXT;
UPDATE links SET state = 'expired', expired_at = archived_at, archived_at = NULL
  WHERE state = 'archived';
UPDATE links SET state = 'active' WHERE state = 'dormant';
CREATE INDEX links_expired ON links (user_id, expired_at) WHERE expired_at IS NOT NULL;

-- A link as it is read: with its topic, tags, workspaces, and its user's start
-- points and removal delay; stickiness and its use counts are gone.
DROP VIEW link_views;
CREATE VIEW link_views AS
SELECT
  l.*,
  tp.name AS topic,
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
LEFT JOIN topics tp ON tp.id = l.topic_id;

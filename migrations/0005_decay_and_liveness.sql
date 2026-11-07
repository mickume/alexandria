-- Decay thresholds per user, the archive, and weekly liveness checks.

ALTER TABLE users ADD COLUMN dormant_days INTEGER NOT NULL DEFAULT 60;
ALTER TABLE users ADD COLUMN archive_days INTEGER NOT NULL DEFAULT 120;
ALTER TABLE users ADD COLUMN remove_days INTEGER NOT NULL DEFAULT 180;
-- When the user's last completed decay evaluation started.
ALTER TABLE users ADD COLUMN last_decay_at TEXT;

ALTER TABLE links ADD COLUMN archived_at TEXT;
ALTER TABLE links ADD COLUMN dead_since TEXT;
-- Consecutive failed weekly liveness checks.
ALTER TABLE links ADD COLUMN liveness_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE links ADD COLUMN last_checked_at TEXT;
ALTER TABLE links ADD COLUMN last_check_result TEXT;
ALTER TABLE links ADD COLUMN check_enqueued_at TEXT;
ALTER TABLE links ADD COLUMN last_manual_check_at TEXT;
CREATE INDEX links_decay ON links (user_id, state, last_used_at);
CREATE INDEX links_archived ON links (user_id, archived_at) WHERE archived_at IS NOT NULL;
CREATE INDEX links_check_due ON links (last_checked_at, check_enqueued_at);
CREATE INDEX link_uses_days ON link_uses (link_id, at);

-- A link as it is read: with its topic, tags, workspaces, use counts for
-- stickiness, and its user's removal threshold.
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
  (SELECT COUNT(*) FROM link_uses u WHERE u.link_id = l.id) AS use_events,
  (SELECT COUNT(DISTINCT substr(u.at, 1, 10)) FROM link_uses u WHERE u.link_id = l.id) AS use_days,
  (SELECT remove_days FROM users WHERE users.id = l.user_id) AS user_remove_days
FROM links l
LEFT JOIN topics tp ON tp.id = l.topic_id;

-- Workspaces: named, manually ordered collections of links, each with a Markdown note.
-- Every link also carries a Markdown note.

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- The name trimmed and lower-cased: names are unique per user ignoring case.
  name_key TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX workspaces_user_name ON workspaces (user_id, name_key);

CREATE TABLE workspace_links (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  link_id TEXT NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  -- 1..n within the workspace.
  position INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, link_id)
);
CREATE INDEX workspace_links_link ON workspace_links (link_id);
CREATE INDEX workspace_links_order ON workspace_links (workspace_id, position);

ALTER TABLE links ADD COLUMN note TEXT NOT NULL DEFAULT '';

-- A link as it is read: with its topic, its tags in order, and its workspaces by name.
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
  ) AS workspaces_json
FROM links l
LEFT JOIN topics tp ON tp.id = l.topic_id;

-- The word index stems its words (Porter, English), so that "queue" finds
-- "queues" and "running" finds "run". A tokenizer cannot be changed in place:
-- both indexes are dropped and built again from the rows they index. The
-- triggers that keep them current name them and stay as they are.

DROP TABLE link_search;
CREATE VIRTUAL TABLE link_search USING fts5(
  title, tags, topic, summary, host, original_url, note, reader_text, owner,
  link_id UNINDEXED,
  tokenize = 'porter unicode61 remove_diacritics 2'
);

INSERT INTO link_search (rowid, title, tags, topic, summary, host, original_url, note, reader_text, owner, link_id)
SELECT k.id, l.title,
  COALESCE((SELECT group_concat(t.name, ' ') FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = l.id), ''),
  COALESCE((SELECT trim(COALESCE(p2.name || ' ', '') || COALESCE(p1.name || ' ', '') || tp.name)
    FROM topics tp LEFT JOIN topics p1 ON p1.id = tp.parent_id LEFT JOIN topics p2 ON p2.id = p1.parent_id
    WHERE tp.id = l.topic_id), ''),
  COALESCE(l.summary, ''), l.host, l.original_url, l.note,
  COALESCE((SELECT substr(text, 1, 500000) FROM link_texts WHERE link_id = l.id), ''),
  'u' || replace(l.user_id, '-', ''), l.id
FROM links l JOIN link_search_keys k ON k.link_id = l.id;

DROP TABLE workspace_search;
CREATE VIRTUAL TABLE workspace_search USING fts5(
  name, description, note, owner,
  workspace_id UNINDEXED,
  tokenize = 'porter unicode61 remove_diacritics 2'
);

INSERT INTO workspace_search (rowid, name, description, note, owner, workspace_id)
SELECT k.id, w.name, w.description, w.note, 'u' || replace(w.user_id, '-', ''), w.id
FROM workspaces w JOIN workspace_search_keys k ON k.workspace_id = w.id;

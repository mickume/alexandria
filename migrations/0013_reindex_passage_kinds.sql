-- Re-index every link once, so that each of its vectors carries the kind of its
-- passage (metadata or reader text), which related links filter on (ADR 06).
-- Moving the text version makes every link stale; the every-minute backfill
-- queues them, and the older passages and their vectors go as each link is
-- re-indexed. Until then search reads the older passages as before.
INSERT INTO link_index_state (link_id, text_version)
SELECT id, 1 FROM links WHERE true
ON CONFLICT (link_id) DO UPDATE SET text_version = text_version + 1;

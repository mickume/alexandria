-- A link's snapshot is now the article of its page with the article's images
-- stored, taken when the owner asks (or when a link without one is archived),
-- or, for a PDF, the file its first fetch stored. Fetches no longer store a
-- page's raw HTML or reader view.

-- The id of the stored snapshot, which names its folder in SNAPSHOTS; null for
-- a PDF stored before this migration, which stays at its old key.
ALTER TABLE links ADD COLUMN snapshot_id TEXT;
-- What the snapshot is, 'html' or 'pdf': a refresh can change content_kind, not the snapshot.
ALTER TABLE links ADD COLUMN snapshot_kind TEXT;
-- When the stored snapshot was taken.
ALTER TABLE links ADD COLUMN snapshot_at TEXT;
-- Set while a snapshot the owner asked for, or archiving queued, is being taken.
ALTER TABLE links ADD COLUMN snapshot_requested_at TEXT;
-- When the owner last asked for a snapshot: one per link per 10 minutes.
ALTER TABLE links ADD COLUMN snapshot_claimed_at TEXT;
-- Why the last snapshot asked for failed; cleared by the next request.
ALTER TABLE links ADD COLUMN snapshot_error TEXT;

-- The stored PDFs are those links' snapshots.
UPDATE links SET snapshot_kind = 'pdf', snapshot_at = COALESCE(fetched_at, updated_at)
WHERE has_snapshot = 1 AND content_kind = 'pdf';
-- No web page keeps a snapshot: its raw HTML and reader view are deleted by
-- the every-minute sweep of SNAPSHOTS.
UPDATE links SET has_snapshot = 0 WHERE has_snapshot = 1 AND content_kind IS NOT 'pdf';

-- Where a one-time job over the stored objects has got to.
CREATE TABLE maintenance_state (
  name TEXT PRIMARY KEY,
  -- The R2 list cursor to go on from; null to start from the beginning.
  cursor TEXT,
  -- When the job finished; null while it has work left.
  done_at TEXT
);
INSERT INTO maintenance_state (name, cursor, done_at) VALUES ('legacy_snapshots', NULL, NULL);

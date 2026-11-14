-- One retrieval pipeline for search, passages and Ask (PRD 07, ADR 10).

-- Passages are found by their words as well as by meaning: a word index of
-- link_passages, stemmed as link_search is, kept current by triggers. Passages
-- have text ids, so passage_search_keys gives each the row id of its index row.
CREATE TABLE passage_search_keys (
  id INTEGER PRIMARY KEY,
  vector_id TEXT NOT NULL UNIQUE
);

CREATE VIRTUAL TABLE passage_search USING fts5(
  text, owner,
  vector_id UNINDEXED,
  tokenize = 'porter unicode61 remove_diacritics 2'
);

CREATE TRIGGER passage_search_insert AFTER INSERT ON link_passages BEGIN
  INSERT INTO passage_search_keys (vector_id) VALUES (new.vector_id);
  INSERT INTO passage_search (rowid, text, owner, vector_id)
  VALUES ((SELECT id FROM passage_search_keys WHERE vector_id = new.vector_id), new.text,
    'u' || replace(new.user_id, '-', ''), new.vector_id);
END;

CREATE TRIGGER passage_search_delete AFTER DELETE ON link_passages BEGIN
  DELETE FROM passage_search WHERE rowid = (SELECT id FROM passage_search_keys WHERE vector_id = old.vector_id);
  DELETE FROM passage_search_keys WHERE vector_id = old.vector_id;
END;

-- The passages stored before this migration.
INSERT INTO passage_search_keys (vector_id) SELECT vector_id FROM link_passages;
INSERT INTO passage_search (rowid, text, owner, vector_id)
SELECT k.id, p.text, 'u' || replace(p.user_id, '-', ''), p.vector_id
FROM link_passages p JOIN passage_search_keys k ON k.vector_id = p.vector_id;

-- The ranking of a hybrid search, kept for 15 minutes so that every page of
-- the search comes from the ranking of its first page. Derived data: removed
-- with the account, swept by the every-minute run, never exported.
CREATE TABLE search_rankings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  -- 'used', 'unranked' or 'unavailable': what the first page answered.
  meaning TEXT NOT NULL,
  -- The entries in order, as JSON: [{id, match, passage?}].
  entries TEXT NOT NULL
);
CREATE INDEX search_rankings_created ON search_rankings (created_at);
CREATE INDEX search_rankings_user ON search_rankings (user_id);

-- Re-index every link once: its reader text is now cut to 200,000 characters
-- with overlapping passages, each embedded with its title and topic path.
-- Until a link is re-indexed it is found by the passages it had.
INSERT INTO link_index_state (link_id, text_version)
SELECT id, 1 FROM links WHERE true
ON CONFLICT (link_id) DO UPDATE SET text_version = text_version + 1;

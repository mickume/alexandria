-- The version of the title rules (src/worker/fetcher/title-rules.json) the
-- stored titles were last cleaned with, as the hash of the rules. While it
-- differs from the deployed rules' hash, the every-minute run cleans every
-- stored title once and then records the new hash; this first deploy has none,
-- so the titles stored before it are cleaned.
CREATE TABLE title_rules_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rules_hash TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

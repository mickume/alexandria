-- Retrievers: for the addresses of some sites (GitHub, YouTube), a link is
-- retrieved through the site's API instead of fetched as a page.

-- What a retriever stored about the link: JSON {retriever, kind, retrieved_at,
-- facts}; null for a link no retriever has retrieved.
ALTER TABLE links ADD COLUMN site TEXT;
-- The retriever whose one-time retrieval of the links stored before it has
-- taken this link: sent it to the fetch worker, or found it not claimed. Null
-- while none has.
ALTER TABLE links ADD COLUMN retrieval_seen TEXT;
-- The one-time retrieval looks for the links of a retriever's hosts.
CREATE INDEX links_host ON links (host);

-- Per retriever: until when its one-time retrieval waits, after its API
-- answered that its rate limit or quota was spent.
CREATE TABLE retrieval_state (
  retriever TEXT PRIMARY KEY,
  paused_until TEXT
);

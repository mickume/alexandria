# 06. Relate links by their metadata alone

## Status

Accepted (2026-11-09). Amends [ADR 05](05-index-links-by-meaning-with-vectorize-and-workers-ai.md)
for related links only.

## Context

A link's detail page lists the owner's other links nearest to it in meaning
(`GET /api/v1/links/{id}/related`). As first built, the link's first passage
(its title, summary, topic, tags and note) was matched through `findPassages`
against every passage of every other link, at the one similarity threshold of
ADR 05, 0.5. In a real library most of the five links shown were unrelated
(issue #36), for two reasons:

- **The threshold let almost everything through.** bge-m3 scores fall in a
  narrow, high band: two unrelated texts in one language often score 0.45 to
  0.6. At 0.5 the list was nearly always the five nearest links, whatever they
  were.
- **Metadata was matched against reader text.** A link counted by its best
  passage, and a long article has up to 34 of them, each a chance to match.
  Navigation, cookie banners and newsletter boxes cut from the reader text can
  sit nearer to a short block of title and tags than real content does.

## Decision

- **Related links match metadata against metadata.** Every vector carries the
  metadata `kind`: `metadata` for the passages cut from the link's title,
  summary, topic, tags and note, `reader` for those cut from its reader text.
  The related query asks Vectorize only for vectors of `kind` `metadata`, so no
  reader-text passage can make a link related. Filtering in Vectorize, not in
  D1 after the query, matters: of the 100 nearest vectors, reader-text passages
  could fill all 100 places.
- **Related links have their own, stricter threshold**, 0.65 cosine
  (`RELATED_SIMILARITY_THRESHOLD`, `meaning/related.ts`), provisional like
  ADR 05's. It was chosen from bge-m3's usual scores, not measured against the
  library; each related link's score is in the API answer, so it can be tuned
  once the library is re-indexed. Fewer than five related links, or none, is
  the expected answer when nothing is related.
- **Search by meaning, passages and asking are unchanged**: they still match
  every passage, at 0.5.
- **The metadata index on `kind`** is created by `scripts/provision.sh` before
  the migrations, because Vectorize filters only on a property with a metadata
  index and only for vectors stored after it exists.
- **Every link is indexed again once.** Migration
  `0013_reindex_passage_kinds.sql` moves every link's text version, so the
  backfill queues all of them (60 a minute per user) and their vectors are
  stored again with their kind.

A second namespace per user for metadata vectors was considered and rejected:
search must still see the metadata passages, so each would be stored twice,
with a second vector id to delete, and the number of namespaces would double.

## Consequences

- The whole library is embedded once more through Workers AI, billed to the
  deployment's account.
- Until a link is indexed again, its vectors have no `kind` and it is never
  returned as related to another link; search finds it as before.
- A link whose metadata is thin (a bare title) has few related links; a note,
  tags or a topic give it more to match on.
- Each vector stores one short metadata property.

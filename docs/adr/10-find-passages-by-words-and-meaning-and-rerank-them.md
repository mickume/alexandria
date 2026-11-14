# 10. Find passages by words and meaning, and rerank them

## Status

Accepted (2026-11-14). Amends
[ADR 05](05-index-links-by-meaning-with-vectorize-and-workers-ai.md): the
vector index, the embedding model, the text versions, the queue, the backfill
and the isolation it describes stand. [ADR 06](06-relate-links-by-their-metadata-alone.md)
is unchanged. The requirements are in
[PRD 07](../prd/07-search-and-ask-through-one-retrieval-pipeline.md).

## Context

Search by meaning and Ask were two thin layers over one vector lookup. A
search fused a link-level keyword ranking with the nearest vectors; an answer
was written from the eight nearest passages, whatever they were. Reading the
code against what a library needs showed where that fell short:

- Ask never consulted a word index, so an exact term (an error code, a version
  number, a name) was missed unless it happened to be near in meaning.
- Nothing judged a passage against the question: cosine similarity over 0.5
  was the only test, and the order.
- Only the first 50,000 characters of a page were embedded.
- A passage was embedded bare, so one that never names its subject was far
  from a question about that subject.
- The question was embedded as typed.
- The provider saw isolated passages under a title.
- A search gave up on meaning after 600 ms and recomputed its ranking for
  every page, so two pages of one search could disagree.
- A link found by meaning showed the first 32 words of its passage.

## Decision

One procedure finds passages, `findPassages` (`src/worker/meaning/passages.ts`),
and hybrid search, `GET /api/v1/passages` and Ask all use it.

- **Candidates by words and by meaning.** For each query: the 100 nearest
  vectors, and the 100 passages of a new word index, `passage_search` (FTS5
  over `link_passages`, the tokenizer of `link_search`, kept by triggers),
  that hold at least one of the query's words, by bm25. Hybrid search keeps
  its link-level keyword matching beside this, because titles, tags and hosts
  are matched per link and every keyword match must be returned.
- **Fusion, then a reranker.** The lists are fused by reciprocal rank and the
  best 50 go to `@cf/baai/bge-reranker-base` on Workers AI with the query as
  its author wrote it. Its relevance orders the passages and replaces
  similarity as the cut-off. The reranker runs on the deployment's account,
  as embeddings do: it writes no text, so it is not one of the calls that
  must run on the owner's key.
- **Deeper, better-described passages.** The first 200,000 characters of a
  page are cut (the owner's choice: about 140 passages for the longest), each
  reader passage starts with the last sentence of the one before it, and each
  is embedded after its link's title and topic path. The stored passage is
  the passage alone. Migration 0023 moved every link's text version; the
  backfill re-indexes the library at its pace, and until a link is redone it
  is found by the passages it had.
- **Ask rephrases, with the owner's key.** Before retrieving, the owner's
  provider writes the question as a search query and up to two other ways of
  asking it. Every phrasing gives candidates; the reranker judges them
  against the question as typed, so a poor phrasing can add candidates and
  cannot change what counts as an answer. There are no follow-up questions:
  every question stands alone and nothing is stored (the owner's choice).
- **Context for the answer.** Each source goes to the provider under its
  title, topic path, host, day added and summary, its passages with the one
  before and the one after, joined, within 40,000 characters (80,000 for a
  detailed answer).
- **A search waits 3 seconds and its pages agree.** Search runs on Enter only,
  so it can wait. The ranking of a search with more than one page is kept in
  `search_rankings` for 15 minutes and named by the cursor; later pages read
  it. It is derived data: deleted with the account, swept every minute, never
  exported.
- **The reranker chooses a meaning match's snippet**: the best of the
  passage's runs of 32 words, per page, with 1.5 seconds before the start of
  the passage is shown instead.
- **Degrading, not failing.** `meaning` takes three values everywhere:
  `used`; `unranked` when the reranker failed (the fused order stands, and a
  passage found by meaning must reach the similarity threshold of ADR 05);
  `unavailable` when the embedding or the index failed (passages found by
  their words). `GET /api/v1/passages` and Ask no longer answer 503 for
  Workers AI or Vectorize.

## Consequences

- An ask is two calls to the owner's provider, and so slower and costlier
  than before; both are recorded as `ask` usage. The answering call also
  receives about three times the text.
- Every search and every ask calls the reranker, and a search page with
  meaning matches calls it a second time for snippets. Embedding four times
  the text of long pages, and the reranking, are paid by the deployment.
- The library is re-embedded once.
- `score` in `GET /api/v1/passages` is now a relevance, can be `null`, and
  each passage has `match`; a hybrid cursor is valid for 15 minutes.

## Unverified

Cloudflare's documentation could not be reached while this was built.

- **The reranker's input and output.** `@cloudflare/workers-types` declares
  `contexts` and `top_k` and documents, but does not declare, a `query`
  field; the backend sends `{query, contexts, top_k}`. Whether scores are
  probabilities is not stated: `asRelevances` passes scores within 0 and 1
  through and squashes anything else with the logistic function. The limit on
  contexts per call is assumed to be at least 100 (`RERANK_BATCH`).
- **The relevance threshold, 0.2,** is provisional. There is no set of test
  questions to tune it against; it is the constant `RELEVANCE_THRESHOLD` in
  `meaning/backend.ts`, and changing it changes nothing else. If the reranker
  scores real answers lower than that, searches by meaning and asks return
  too little, and this is the first number to lower.
- **Vectorize's limits** (vectors per index and per namespace) bound how many
  passages a library of long pages may hold.
- **The tests' reranker is a fake** (`relevance` in `src/worker/test/embedder.ts`):
  it scores by the fake embedder's similarity or by shared words. The tests
  prove the procedure, not the quality of the model's judgement.

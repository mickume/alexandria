---
spec_id: "10"
spec_name: "meaning_index"
title: "Index every link by meaning and return its best passages"
status: "sealed"
created_at: "2026-11-09T07:04:10Z"
intent_hash: "7527bee18ab166d781e35ea3c21e7ad807b2246a63f197b70e67b5d1f42cbc1a"
schema_version: 3
source: "docs/prd/02-find-links-by-meaning-and-ask-the-library.md"
---

# Index every link by meaning and return its best passages

## Intent

Keyword search finds a link only when the query shares words with it, so a page saved as "Durable Objects alarms" is lost to a search for "scheduling work in the background on Cloudflare". Alexandria keeps, for every user, a private index of what each of their links means, built from the text it already stores and kept current as that text changes, and returns the passages of the owner's links that best answer a question. It is the foundation that search by meaning and asking the library are built on, and it never lets one user's library inform another's, nor keeps anything of a link once the link is gone.

## Goals

- A link's text is findable by meaning within 60 seconds (p95) of its reader text, title, summary, topic, tags or note being stored or changed, outside a backfill.
- Every link that existed before this feature is findable by meaning once the backfill has run, without the owner doing anything; a library of 10,000 links is fully indexed within 3 hours.
- `GET /api/v1/passages?q=<question>` returns the passages of the owner's links that best match the question by meaning, each with its link's id, title and URL, even when the question shares no word with the link.
- An agent calling the MCP tool `search_passages` receives the same passages.
- A link deleted (by the owner, by decay's removal or by account deletion) is never again returned by a passage request, and its passages and index entries are gone within the 10 minutes account deletion promises.
- No request or background job of one user reads, ranks with or returns another user's text.

## Non-goals

- **Search by meaning** (`GET /api/v1/search?mode=hybrid`, the `match` and `meaning` fields, the website's search on Enter, `search_links` searching by meaning). It is the next package, `11_hybrid_search`, built on this index (Design Decision 19).
- **Asking the library** (`POST /api/v1/ask`, the Ask page, streaming answers from the owner's AI provider). It is the package after that, `12_ask_the_library`, built on passages (Design Decision 19).
- Cloudflare AI Search (formerly AutoRAG), the managed indexing service. Considered and rejected in favour of an index Alexandria writes and deletes itself (Design Decision 1).
- Searching workspaces by meaning, searching across users, or any shared or pooled index of content.
- Embedding images, the raw snapshot HTML, or anything other than the text Alexandria already stores (title, summary, topic, tags, note, reader text).
- Related links (the owner's links nearest in meaning to one link). A later PRD.
- Paying for embeddings with the owner's key. Embeddings run on Workers AI on the deployment's account (Design Decision 4).
- Showing the backfill's progress or a link's index state anywhere (Design Decision 9).
- Changing the query language: the prefix filters and the 200-character cap stay as they are.
- Changing the export: passages and vectors are derived data and are not exported.

## Background

PRD 02 (`docs/prd/02-find-links-by-meaning-and-ask-the-library.md`) lifts PRD 01's non-goal "Semantic / vector search". Its owner chose to build it as three packages (Design Decision 19); this is the first, the index and the passages that the other two use.

What exists today:

- **Keyword search.** `GET /api/v1/search` (`src/worker/search/routes.ts`) parses the query into free words and prefix filters (`parseQuery` in `src/worker/search/query.ts`: `tag:`, `topic:`, `host:`, `in:`, `is:`, `state:`; 200 characters at most; `query_too_long` and `invalid_filter`), turns the filters into SQL conditions on the links (`filterConditions`, which also leaves archived links out unless a `state:` filter is given), and ranks matches from an FTS5 index (`link_search`, migration `0006_search_index.sql`) that triggers keep current on every change of a link's title, summary, topic, tags, note or reader text. `parseLimit` in `src/worker/api/pagination.ts` reads a page size.
- **Stored text.** The fetch consumer (`src/worker/fetcher/queue.ts`) stores a page's or PDF's reader text, at most 500,000 characters, in `link_texts`; enrichment (`storeEnrichment` in `src/worker/enrich/queue.ts`) stores summary, topic and tags; the owner edits title, summary, tags and topic (`applyEdit` in `src/worker/enrich/edits.ts`) and the note (`setLinkNote` in `src/worker/links/store.ts`, at most 20,000 characters) through `PATCH /api/v1/links/{id}`; topics and tags are renamed and merged by `renameEntry` and `mergeEntry` in `src/worker/search/vocabulary.ts`.
- **Queues and crons.** One Worker (`src/worker/index.ts`) consumes `alexandria-fetch`, `alexandria-enrich`, `alexandria-liveness` and `alexandria-account`, and runs three Cron Triggers: hourly (decay and liveness), every minute (the import dispatcher, `src/worker/imports/dispatch.ts`) and every 5 minutes (the account deletion sweep). `accountActive` (`src/worker/account/deletion.ts`) stops background work for an account marked for deletion.
- **Deletion paths.** A link is deleted by the owner (`deleteLink` in `src/worker/links/store.ts`, `DELETE /api/v1/links/{id}`), by decay's removal (`removalStatements` in `src/worker/decay/decay.ts`) and by account deletion (`runDeletion` in `src/worker/account/deletion.ts`), whose job finds the account's tables from the schema (every table with a `link_id` or `user_id` column, except tables a trigger inserts into) and removes everything of the account within 10 minutes.
- **The MCP server** (`src/worker/mcp/`). Nine tools, each a request to the Worker's own API as the token's user; `outcomeOf` in `tools.ts` turns a 2xx into structured content, a 4xx error envelope into a tool error, and anything else into `internal_error`. `INSTRUCTIONS` in `server.ts` is the text an agent receives on initialize.
- **Platform.** `wrangler.jsonc` binds D1, R2, the queues, a Durable Object and the crons; `scripts/provision.sh` creates the resources before a deploy. D1 cannot load a vector extension. Every API response the Worker tests receive is compared with the OpenAPI document (`src/worker/api/openapi.ts`).

Constraints:

- Constraint: Cloudflare **Vectorize** holds the vectors and **Workers AI** computes the embeddings (owner's choice). Both are new bindings and new resources `scripts/provision.sh` creates.
- Constraint: the unit and integration tests (`make test`, Vitest in workerd) and the end-to-end tests (`make e2e`, Playwright against `wrangler dev`) run without a Cloudflare account, as they do today; neither Vectorize nor Workers AI is reachable there.
- Constraint: strict per-user separation (PRD 01); the MCP server reaches the library only through the API, as today.

## Requirements

### Indexing by meaning

- When a link's reader text is stored (first fetch, refresh), or its title, summary, topic, tags or note change (enrichment, the owner's edit, a rename or merge of a topic or tag), the link is queued for indexing. Within 60 seconds (p95) a passage request reflects its new text.
- What is indexed for a link: its title, summary, topic, tags and note, together, and the first 50,000 characters of its reader text, cut into passages of at most 1,500 characters. Text past 50,000 characters of reader text is in no passage. A link with no reader text (pending, unreachable, not a web page, a PDF without text) is indexed on its title, summary, topic, tags and note alone.
- Links in every state are indexed, archived links included; which states a request returns is decided by its filters.
- When a link's text changes, nothing of its previous text is returned once the new text is indexed.
- Failure: Workers AI or Vectorize is unavailable or refuses a request. The link stays findable by keyword; its indexing is retried up to 5 times; after the last retry it is left as it was (unindexed, or indexed on its previous text) and the backfill picks it up. Nothing is shown on the link and nothing else about it changes.
- Failure: a link's text changes again while its indexing is in flight. The older job stores nothing; the job queued for the newer text indexes it.
- Failure: a link is deleted while its indexing is in flight. Nothing of it remains in the index once the in-flight job ends.
- An account marked for deletion is indexed no more: its jobs write nothing and call neither Workers AI nor Vectorize.

### Backfill

- Every link that has no passages, or whose passages were made from older text than its current text, is indexed by a background backfill, without any action of the owner, at most 60 links per minute per user. Users are independent: one user's backfill does not slow another's. A link queued in the last 10 minutes is not queued again.
- The backfill is not shown anywhere: no count, banner, field or state on the link. Until a link is indexed, a passage request does not return it.
- An account marked for deletion is not backfilled.

### Passages

- `GET /api/v1/passages?q=<question>&limit=<n>` returns the passages of the owner's links that best match the question by meaning, best first: `200 {"items": [{"link_id", "title", "url", "passage", "score"}], "meaning": "used"}`. `q` takes the search query language: free words form the question, the prefix filters apply as in search, archived links are left out without `state:`. `limit` is 1 to 20, default 8. A passage is at most 1,500 characters of the link's indexed text. `url` is the link's original URL. `score` is the passage's similarity to the question. Passages below the similarity threshold are not returned, so a question unrelated to anything in the library answers with no items. It records no use.
- At most 3 passages of one link are returned; the rest of the limit goes to other links.
- Refusals: `q` without a free word (absent, empty, blank or filters only): `400 {"error": "invalid_question", "field": "q", "message": "ask with at least one word"}`; a `q` over 200 characters: `query_too_long`, and a refused filter value: `invalid_filter`, as in search; a `limit` that is not an integer from 1 to 20: `400 {"error": "invalid_limit", "field": "limit", "message": "limit must be an integer from 1 to 20"}`.
- Failure: Workers AI or Vectorize fails or has not answered within 5 seconds: `503 {"error": "search_unavailable", "message": "search by meaning is unavailable, try again"}`.
- The MCP tool `search_passages(query, limit?)` is this request, with the same shapes and errors as structured tool results, `search_unavailable` included. The MCP server's instructions text tells an agent to use `search_passages` to answer a question from the library and `get_link_content` to read a whole link.

### Deletion and isolation

- Deleting a link (by the owner, or by decay's removal) removes its passages at once and its index entries within the next minute. Until the index has caught up, no passage request returns it: results are checked against the owner's existing passages before they are returned.
- Account deletion removes every index entry and every passage of the account within its 10 minutes.
- When removing index entries fails, they are removed at a later run; nothing else waits for it.
- The export (`GET /api/v1/export`) is unchanged: vectors and passages are derived data, rebuilt from the links, and not exported.
- No passage request or background job reads or writes index entries of any user other than the one it runs for.

### End-to-end flows

1. The owner adds `https://example.com/durable-object-alarms`; the fetch worker stores the article's reader text; the index worker indexes it; a minute later `GET /api/v1/passages?q=run a task later on cloudflare` returns a passage of the article with its id, title and URL.
2. An agent with a personal access token calls `search_passages("how do I schedule background work on Cloudflare?")` through the MCP server and receives passages of the Durable Objects article with its id, title and URL; no use is recorded.
3. The owner deletes the article; an immediate passage request for its subject no longer lists it; at the next every-minute run its index entries are removed.
4. Links stored before the index existed (no passages) are indexed by the every-minute backfill without any action of the owner, and a passage request then returns them.
5. The owner deletes the account; the deletion job removes its passages, and once it is done and the next every-minute run has passed, the index holds no entry of the account.

## Design Decisions

1. **Build the index in Alexandria with Vectorize and Workers AI, not Cloudflare AI Search.** Owner's choice. AI Search indexes an R2 bucket on a sync schedule, which holds raw HTML rather than the stored reader text, summary and note; separates users by path filters rather than by the authenticated user; and delays deletion past the account deletion promise.
4. **Embeddings run on Workers AI on the deployment's Cloudflare account, paid by the operator.** Owner's decision. It amends PRD 01 DD9 for embeddings only: Anthropic offers no embeddings API, so the owner's key cannot cover them. Every text sent for embedding is the owner's own stored text, sent to Cloudflare, where it is already stored.
6. **Agents get passages (`search_passages`), not an ask tool.** Owner's decision. An agent has its own model; Alexandria supplies the retrieval and spends nothing of the owner's key on an agent's behalf.
9. **Backfill at 60 links a minute per user, shown nowhere.** Owner's decision. 10,000 links index in about 3 hours.
11. **Reader text indexed up to 50,000 characters.** Owner's decision: almost every article whole, long PDFs bounded.
13. **The similarity threshold is one fixed constant**, the same for passages, search by meaning and asking. Its provisional value is in Design Decision 21.
14. **Passages of at most 1,500 characters, at most 3 per link.** Enough context for an answer from several sources within the 20,000 characters enrichment already sends a provider.
19. **Three packages, not two.** Owner's choice in this run: `10_meaning_index` (this one: indexing, backfill, deletion and isolation, passages and `search_passages`), then `11_hybrid_search` (`mode=hybrid`, ranking, the fallback, the website's search on Enter, `search_links`), then `12_ask_the_library`. Each later package is written by its own run.
20. **The embedding model is `@cf/baai/bge-m3`, in a Vectorize index `alexandria-passages` of 1,024 dimensions with the cosine metric.** Links come in any language (`links.language`), and bge-m3 is multilingual with an input window that holds a 1,500-character passage whole. `scripts/provision.sh` creates the index when it does not exist.
21. **The similarity threshold is 0.5 (cosine), provisional**, recorded in a new ADR with the model choice. No library is reachable to tune it against in this run; changing the constant later changes no other behaviour.
22. **One Vectorize namespace per user, named by the user id, and every result checked against the user's passages in D1.** Two independent locks: a query reads only its user's namespace, and a vector whose passage is not the requesting user's current passage is dropped.
23. **Passages are kept in D1 beside the links, each with the id of its vector, `{link_id}:{version}:{n}`.** They can then be returned, filtered and deleted with the links; a new text version gets new vector ids, so a vector of older text matches no current passage and is never returned.
24. **A text version per link, kept by triggers** as `link_search` is kept, moves with every change of the indexed fields (title, summary, topic, tags, note, reader text, a rename of its topic or tags). A link whose passages carry an older version, or that has none, is stale.
25. **Vector deletions go through a queue in D1**: a table that a trigger fills with the vector id of every passage deleted, drained by the every-minute run. Every deletion path (the owner, decay, account deletion, re-indexing) then removes vectors the same way, a failed Vectorize call is retried at the next run, and the account deletion job, which leaves trigger-kept tables alone, cannot remove the queue before it is drained.
26. **A new queue `alexandria-index` (`INDEX_QUEUE`, batch size 10, 5 retries) carries one message `{user_id, link_id}` per link to index.** The writes queue a link only when its text version moved past its passages' version.
27. **The backfill runs in the existing every-minute Cron Trigger**, beside the import dispatcher and the vector-deletion drain.
28. **A passage request takes the 100 nearest passages from Vectorize, then applies the threshold, the user check and the filters in D1.** A filtered question whose matches lie outside the 100 nearest returns fewer passages; accepted for a personal library.
29. **The question embedded is the query's free words, joined by single spaces**; the filters are not embedded.
30. **Passages are cut in order**: first the link's title, summary, topic, tags and note joined by line breaks (more than one passage when the note is long), then the first 50,000 characters of the reader text, each cut at the last paragraph break, else sentence end, else space, before 1,500 characters.
31. **The fakes.** The Worker tests install fake `AI` and `VECTORIZE` bindings on `env`; `wrangler dev` cannot take such fakes, so the end-to-end tests set `MEANING_FAKE_URL` to a local fake service (`e2e/fake-meaning.ts`), as `ORIGIN_PROXY_URL` points the fetcher at `e2e/fake-origin.ts`. Both fakes embed by one fixed table of word groups, so that words of one group ("later", "alarm", "schedule", "background") are near in meaning and unrelated text scores below the threshold. Miniflare starts a Worker that binds `ai` and `vectorize` without an account and fails only when they are called (verified in Miniflare's source), so the bindings can be declared in `wrangler.jsonc` for every environment.
32. **The backfill takes a user's stale links most recently used first**, so the links the owner reaches for become findable first.
33. **A write whose index message cannot be sent still succeeds**: the failure is logged, and the backfill picks the link up, since its passages stay older than its text.

## Dependencies

- `docs/prd/02-find-links-by-meaning-and-ask-the-library.md`: the source PRD; this package is its first scope.
- `docs/adr/01-build-on-a-cloudflare-worker-with-d1.md`: adds two Cloudflare services to the one Worker, and a new ADR records them.
- `.specs/02_fetch_and_snapshot` (active, all tasks done): its fetch consumer queues indexing after storing reader text.
- `.specs/03_ai_enrichment` (active, all tasks done): its enrichment and the owner's edits queue indexing.
- `.specs/04_workspaces_and_notes` (active, all tasks done): a link's note is indexed and its edit queues indexing.
- `.specs/05_decay_and_liveness` (active, all tasks done): decay's removal must remove index entries.
- `.specs/06_search_and_browse` (active, all tasks done): passages reuse its query parser and filters; its renames and merges queue indexing.
- `.specs/08_mcp_server` (active, all tasks done): a new tool `search_passages`; the instructions text changes.
- `.specs/09_export_and_account_deletion` (active, all tasks done): its deletion job must remove index entries; the export is unchanged.
- External systems: Cloudflare Vectorize and Workers AI (new).

## Verified External API

Read from the installed `@cloudflare/workers-types` 5.20261107.1 (`index.d.ts`), the version the repository's lockfile holds (`^5.20261107.1`):

- `Vectorize.query(vector: VectorFloatArray | number[], options?: VectorizeQueryOptions): Promise<VectorizeMatches>`, with `VectorizeQueryOptions { topK?: number; namespace?: string; returnValues?: boolean; returnMetadata?: boolean | VectorizeMetadataRetrievalLevel; filter?: VectorizeVectorMetadataFilter }` and `VectorizeMatches { matches: VectorizeMatch[]; count: number }`; `VectorizeMatch` is the vector's `id`, `namespace` and `metadata` with `score: number`.
- `Vectorize.upsert(vectors: VectorizeVector[]): Promise<VectorizeAsyncMutation>`, `deleteByIds(ids: string[]): Promise<VectorizeAsyncMutation>`; `VectorizeVector { id: string; values: VectorFloatArray | number[]; namespace?: string; metadata?: Record<string, VectorizeVectorMetadata> }`; mutations are asynchronous (`VectorizeAsyncMutation { mutationId: string }`).
- `Ai.run(model, inputs, options?)`; `@cf/baai/bge-m3` takes `{ text: string | string[]; truncate_inputs?: boolean }` and its output is a union, of which the embedding form is `{ shape?: number[]; data?: number[][]; pooling?: "mean" | "cls" }`.
- `wrangler vectorize create <name> --dimensions <n> --metric cosine` and `wrangler vectorize get <name>` exist in the installed wrangler 4.158.0 (`wrangler vectorize --help`).
- Miniflare 5.20261101.0-beta (`dist/src/index.js`): an `ai` or `vectorize` binding without `remote: true` is created with a warning and no remote connection; its calls fail.
- **Unverified** (not in the typings): bge-m3's vector dimensions (1,024 assumed) and input limit; Vectorize's limits (namespaces per index, the `topK` maximum with `returnMetadata: "none"` (100 assumed), ids per `upsert` and `deleteByIds` call (1,000 assumed), id length (64 bytes assumed)); Workers AI's texts per call (100 assumed); both services' prices.

## Glossary

- **embedding**: a vector of numbers computed from a piece of text, such that texts of similar meaning have nearby vectors.
- **passage**: a contiguous piece of a link's indexed text, at most 1,500 characters, the unit the index matches and returns.
- **similarity threshold**: the fixed similarity a passage must reach to be returned.
- **text version**: a counter per link that moves with every change of its indexed text; passages carry the version they were made from.
- **stale**: a link with no passages, or whose passages carry an older text version than the link's.
- **backfill**: the background indexing of stale links.
- **index worker**: the consumer of `alexandria-index`, which indexes one link per message.

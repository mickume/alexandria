# Find links by meaning and ask the library questions

## Intent

Keyword search finds a link only when the query shares words with it, so a page saved as "Durable Objects alarms" is lost to a search for "scheduling work in the background on Cloudflare". Alexandria should also find links by what they mean, and answer a question from what the owner has saved, with every claim traced back to the links it came from. That turns the library from a list one has to remember the words of into something one can ask, without sending it anywhere the owner has not chosen and without one user's library ever informing another's.

## Goals

- A search by meaning whose free words share no word with a link, but whose meaning matches the link's title, summary, note or reader text, lists that link on the first page of `GET /api/v1/search?mode=hybrid`, on the website's Search page after Enter, and through the MCP tool `search_links`.
- A search by meaning still lists every link the keyword search of the same query lists, and a link whose keyword match is on its title, tags or topic is never ranked below a link found by meaning alone.
- Keyword search as it is today stays the default of `GET /api/v1/search` and of the search box while typing, with the PRD 01 target unchanged: p95 under 500 ms for a library of 10,000 links.
- A search by meaning answers in under 800 ms (p95) for a library of 10,000 links.
- A link's text is searchable by meaning within 60 seconds (p95) of its reader text, title, summary, topic, tags or note being stored or changed, outside a backfill.
- Every link that existed before this feature is searchable by meaning once the backfill has run, without the owner doing anything; a library of 10,000 links is fully indexed within 3 hours.
- The owner asks a question on the Ask page or with `POST /api/v1/ask` and receives an answer written by their own AI provider from passages of their own links, in which every cited number names a link listed with the answer.
- An agent calling the MCP tool `search_passages` receives the passages of the owner's links that best match its question, each with its link's id, title and URL.
- A link deleted (by the owner, by decay's removal or by account deletion) is never again returned by a search by meaning, a passage request or an answer, and its indexed text is gone within the 10 minutes account deletion promises.
- No request, background job, search or answer of one user reads, ranks with or returns another user's text.

## Non-goals

- Cloudflare AI Search (formerly AutoRAG), the managed indexing service. Considered and rejected in favour of an index Alexandria writes and deletes itself (Design Decision 1).
- Searching workspaces by meaning. Workspaces stay keyword-matched on name, description and note, as `GET /api/v1/search` lists them today.
- Searching by meaning across users, or any shared or pooled index of content.
- Embedding images, the raw snapshot HTML, or anything other than the text Alexandria already stores (title, summary, topic, tags, note, reader text).
- Related links: a list of the owner's links nearest in meaning to one link, on its detail page or through the API. A later PRD; the index this PRD builds makes it possible.
- Paying for embeddings with the owner's key. Embeddings run on Workers AI on the deployment's account (Design Decision 4).
- Showing the backfill's progress anywhere (Design Decision 9).
- Multi-turn conversation, stored question or answer history, or follow-up questions that refer to earlier answers.
- An MCP tool that asks the library on the owner's key; agents get passages instead (Design Decision 6).
- Changing the query language: the prefix filters, the 200-character cap and the refusals of `GET /api/v1/search` stay as they are.
- Tuning ranking per user, learning from clicks, or recommendations of links the owner did not add (PRD 01 non-goal, kept).

## Background

PRD 01 (`docs/prd/01-build-the-alexandria-link-library.md`) made search keyword-only and deferred semantic search "to a later PRD once there is content to evaluate it on". This is that PRD. All nine packages PRD 01 produced (`.specs/01` to `.specs/09`) are active with every task done.

What exists today:

- **Keyword search.** `GET /api/v1/search` (`src/worker/search/routes.ts`) parses the query into free words and prefix filters (`src/worker/search/query.ts`: `tag:`, `topic:`, `host:`, `in:`, `is:`, `state:`; 200 characters at most), matches every free word as a word prefix against an FTS5 index (`link_search`, migration `0006_search_index.sql`, kept current by triggers), ranks by bm25 with weights title 10, tags and topic 5, summary 3, host, original URL and note 2, reader text 1, then pinned, then recently used, and returns each link with a snippet of at most 32 words with the matched words marked (`src/worker/search/search.ts`). The first page also lists matching workspaces (at most 50). A query of filters only answers in stream order. Ranked pages use a signed offset cursor. The response is `{items: [{link, snippet}], workspaces, next_cursor}`.
- **The website's search.** `components/SearchBox` in every page's header searches 200 ms after the last keystroke and owns the `/` and `Escape` keys; `pages/Search` shows the results with a "More results" button; the Archive page searches the archive (`/archive?q=`). The header's tabs are Stream, Workspaces, Topics, Tags, Archive, Settings, then the Import button.
- **The MCP server** (`src/worker/mcp/`). `search_links(query, limit?)` is `GET /api/v1/search` with the query as given and returns its body; `get_link_content(id, format)` returns a link's reader text or snapshot and records a use. Tools answer the API's shapes and errors as structured tool results (`docs/api.md`, MCP section).
- **Stored text.** The fetch consumer (`src/worker/fetcher/queue.ts`) stores a page's or PDF's reader text, at most 500,000 characters, in `link_texts`; enrichment (`src/worker/enrich/`) stores summary, topic and tags; the owner edits title, summary, tags, topic and note through `PATCH /api/v1/links/{id}`; topics and tags are renamed and merged on the Topics and Tags pages.
- **AI providers.** Enrichment runs only with the owner's own key (PRD 01 DD9): Anthropic through `@anthropic-ai/sdk` or OpenRouter's HTTP API (`src/worker/enrich/providers.ts`), with a 60-second timeout and the outcomes `rejected` (401, 402 or 403, with the provider's message), `unavailable` and `failed`. A rejected key is marked on the settings page (`GET /api/v1/settings/ai`: `status: "rejected"`, `rejected_message`) and pauses enrichment until a key is saved again.
- **Deletion paths.** A link is deleted by the owner (`src/worker/links/store.ts`), by decay's removal (`src/worker/decay/decay.ts`) and by account deletion (`src/worker/account/deletion.ts`), which removes everything of the account within 10 minutes. The export (`src/worker/account/export.ts`) holds every link, workspace, topic and tag.
- **Platform.** One Cloudflare Worker with D1, R2, Queues, a Durable Object and cron triggers (`wrangler.jsonc`); `scripts/provision.sh` creates the resources before a deploy. D1 cannot load a vector extension.

Constraints:

- Constraint: Cloudflare **Vectorize** holds the vectors and **Workers AI** computes the embeddings (owner's choice). Both are new bindings and new resources `scripts/provision.sh` creates.
- Constraint: the unit and integration tests (`make test`, Vitest in workerd) and the end-to-end tests (`make e2e`, Playwright against `wrangler dev`) run without a Cloudflare account, as they do today; neither Vectorize nor Workers AI is reachable there.
- Constraint: strict per-user separation (PRD 01); the website and the MCP server reach the library only through the API, as today.
- Constraint: answers to questions run only with the owner's own AI key and model, as enrichment does.

## Requirements

### Indexing by meaning

- When a link's reader text is stored (first fetch, refresh), or its title, summary, topic, tags or note change (enrichment, the owner's edit, a rename or merge of a topic or tag), the link is queued for indexing. Within 60 seconds (p95) a search by meaning reflects its new text.
- What is indexed for a link: its title, summary, topic, tags and note, together, and the first 50,000 characters of its reader text. Text past 50,000 characters is found by keyword search only. A link with no reader text (pending, unreachable, not a web page, a PDF without text) is indexed on its title, summary, topic, tags and note alone.
- Links in every state are indexed, archived links included; which states a search returns is decided by its filters, exactly as keyword search decides it.
- When a link's text changes, nothing of its previous text is findable by meaning once the new text is indexed.
- Failure: Workers AI or Vectorize is unavailable or refuses a request. The link stays findable by keyword; its indexing is retried up to 5 times; after the last retry it is left as it was (unindexed, or indexed on its previous text) and the backfill picks it up. Nothing is shown on the link and nothing else about it changes.
- Failure: a link is deleted while its indexing is in flight. Nothing of it remains in the index once the in-flight job ends.

### Backfill

- Every link that has no index entry, or whose indexed text is older than its current text, is indexed by a background backfill, without any action of the owner, at most 60 links per minute per user. Users are independent: one user's backfill does not slow another's.
- The backfill is not shown anywhere: no count, banner or state on the link. Until a link is indexed, a search by meaning finds it by keyword only.
- An account marked for deletion is not backfilled.

### Search by meaning

- `GET /api/v1/search` takes a new parameter `mode`: `keyword` (the default, exactly today's behaviour) or `hybrid`. Any other value: `400 {"error": "invalid_mode", "field": "mode", "message": "mode takes keyword, hybrid"}`.
- With `mode=hybrid` and at least one free word, the results are the links that match the free words by keyword, by meaning, or both, in one ranking:
  - every link the keyword search of the same query returns is returned;
  - a link whose keyword match is on its title, tags or topic is never ranked below a link found by meaning alone;
  - a link found by meaning alone is returned only when its similarity to the query reaches a fixed threshold, so a query unrelated to anything in the library still answers with no items;
  - ties are broken as keyword search breaks them: pinned (by position), then the more recently used, then by id.
- The filters apply to links found by meaning exactly as to keyword matches: `tag:`, `topic:`, `host:`, `in:`, `is:` and `state:`, and archived links are left out without a `state:` filter.
- Each item of a hybrid response carries a new field `match`: `"keyword"`, `"meaning"` or `"both"`. Its `snippet`: for a keyword or both match, as today (at most 32 words, matched words marked); for a meaning match, the start of the passage that matched best, at most 32 words, no word marked.
- Each hybrid response carries a new top-level field `meaning`: `"used"`, or `"unavailable"` when meaning could not be added.
- With `mode=hybrid`, a query of filters only and an empty query answer exactly as with `mode=keyword`, with `meaning: "used"`. The refusals (`query_too_long`, `invalid_filter`, `invalid_limit`, `invalid_cursor`) are unchanged; a cursor issued for one mode is refused as `invalid_cursor` in the other. Paging by cursor returns every result once across pages. The first page lists matching workspaces as today.
- Failure: Workers AI or Vectorize fails, or has not answered within 600 ms. The search answers 200 with the keyword results of the query, each `match: "keyword"`, and `meaning: "unavailable"`. It never answers 5xx because of the index.
- A response with `mode=keyword` (or no `mode`) is byte-for-byte what it is today: no `match` and no `meaning` field.
- **The website.** Typing in the search box searches by keyword 200 ms after the last keystroke, as today. Pressing Enter in the box searches the same query by meaning (`mode=hybrid`), and the address becomes `/search?q=<query>&mode=hybrid` (`/archive?q=<query>&mode=hybrid` on the Archive page), so a reload or a shared address repeats the search by meaning. Typing again returns to keyword search. On a hybrid results page, a meaning match is marked "by meaning" beside its snippet, and `meaning: "unavailable"` shows the line "Showing keyword matches only." above the results.
- **The MCP tool `search_links`** always searches with `mode=hybrid` and returns its body. Its description tells agents it matches by meaning as well as by words.

### Passages for agents

- `GET /api/v1/passages?q=<question>&limit=<n>` returns the passages of the owner's links that best match the question by meaning, best first: `200 {"items": [{"link_id", "title", "url", "passage", "score"}], "meaning": "used"}`. `q` takes the search query language: free words form the question, the prefix filters apply as in search, archived links are left out without `state:`. `limit` is 1 to 20, default 8. A passage is at most 1,500 characters of the link's indexed text. `url` is the link's original URL. Passages below the similarity threshold are not returned. It records no use.
- At most 3 passages of one link are returned; the rest of the limit goes to other links.
- Refusals: `q` without a free word (empty, blank or filters only): `400 {"error": "invalid_question", "field": "q", "message": "ask with at least one word"}`; `query_too_long`, `invalid_filter`, `invalid_limit` as in search.
- Failure: Workers AI or Vectorize fails or times out (5 seconds): `503 {"error": "search_unavailable", "message": "search by meaning is unavailable, try again"}`.
- The MCP tool `search_passages(query, limit?)` is this request, with the same shapes and errors as structured tool results. The MCP server's instructions text tells an agent to use `search_passages` to answer a question from the library and `get_link_content` to read a whole link.

### Asking the library

- A new **Ask** tab in the website's header, between Tags and Archive, opens the Ask page at `/ask`: one text box for a question (at most 500 characters) and an Ask button.
- `POST /api/v1/ask` with `{"question": "<text>"}` (the question in the search query language: prefix filters narrow the passages, as in `GET /api/v1/passages`). Alexandria retrieves the 8 best passages, as `GET /api/v1/passages` would, sends them and the question to the owner's own AI provider with the owner's key and model, and streams the answer as `text/event-stream`:
  - first one `sources` event: `{"sources": [{"n": 1, "link": <the link as the stream lists it>}]}`, one entry per link the passages came from, numbered from 1;
  - then `delta` events `{"text": "<next part of the answer>"}`, the answer citing sources as `[n]`;
  - finally one `done` event `{}`.
- The provider is instructed to answer from the passages only, to cite every statement with the number of its source, and to answer "Nothing in your library answers this." when the passages do not answer the question.
- The Ask page shows the answer as it streams in, each `[n]` a link to that source's detail page, and the sources listed under the answer (title, host). Asking again replaces the answer. Nothing is stored: leaving the page loses the answer.
- When no passage reaches the similarity threshold, the answer is the single `delta` "Nothing in your library answers this." with an empty `sources` list, and the provider is not called.
- Refusals, each answered as JSON before any stream starts: an empty, blank or filters-only question: `400 {"error": "invalid_question", "field": "question", "message": "ask with at least one word"}`; a question over 500 characters: `400 {"error": "question_too_long", "field": "question"}`; `invalid_filter` as in search; no AI key: `409 {"error": "no_ai_key", "message": "add an AI key in settings"}`; the key marked rejected: `409 {"error": "ai_key_rejected", "message": "<the provider's message>"}`; Workers AI or Vectorize unavailable: `503 {"error": "search_unavailable", "message"}`. The provider is called in none of these cases.
- Failures once the stream has started, each ending it with one `error` event `{"error", "message"}` and no `done`: the provider rejects the key (401, 402, 403): `ai_key_rejected` with the provider's message, and the key is marked rejected exactly as a rejected enrichment marks it; the provider is unreachable, answers 5xx or has not finished within 60 seconds: `provider_unavailable`; any other provider failure (a rate limit, a refusal, an unusable answer): `provider_failed` with the provider's message. The Ask page shows the message under whatever part of the answer arrived.
- Asking records no use on its sources; opening one does, as everywhere. An ask counts once against the owner's 600 requests a minute.

### Deletion and isolation

- Deleting a link (by the owner, or by decay's removal) removes everything of it from the index. Until the index has caught up, no search by meaning, passage request or answer returns it: results are checked against the owner's existing links before they are returned.
- Account deletion removes every index entry and every indexed passage of the account within its 10 minutes.
- The export (`GET /api/v1/export`) is unchanged: vectors and passages are derived data, rebuilt from the links, and not exported.
- No search, passage request, answer or background job reads index entries of any user other than the one it runs for.

### End-to-end flows

1. The owner adds `https://example.com/durable-object-alarms`; it is fetched and enriched; a minute later the owner types `run a task later on cloudflare` into the search box and presses Enter; the address becomes `/search?q=run+a+task+later+on+cloudflare&mode=hybrid`, and the link appears marked "by meaning", with the start of a passage from the article as its snippet.
2. The owner searches `cloudflare queues` and presses Enter; the link titled "Cloudflare Queues explained" is first, as it is in the keyword results.
3. Workers AI is unreachable; the owner searches `cloudflare queues` by meaning and gets the keyword results with the line "Showing keyword matches only."
4. The owner deletes a link; an immediate search by meaning for its subject no longer lists it.
5. An agent with a personal access token calls `search_passages("how do I schedule background work on Cloudflare?")` through the MCP server and receives passages of the Durable Objects article with its id, title and URL; no use is recorded.
6. The owner, with an Anthropic key in settings, opens Ask, asks "how do I schedule background work on Cloudflare?"; the sources appear, the answer streams in citing [1], and clicking [1] opens the article's detail page.

## Design Decisions

1. **Build the index in Alexandria with Vectorize and Workers AI, not Cloudflare AI Search.** Owner's choice. AI Search indexes an R2 bucket on a sync schedule, which holds raw HTML rather than the stored reader text, summary and note; separates users by path filters rather than by the authenticated user; and delays deletion past the account deletion promise.
2. **Hybrid, not semantic-only.** Keyword matches stay, so exact names, hosts and identifiers are never lost to meaning.
3. **`search_links` gains meaning by being `GET /api/v1/search?mode=hybrid`**, rather than a separate `semantic_search` tool, which would duplicate the filters and the paging.
4. **Embeddings run on Workers AI on the deployment's Cloudflare account, paid by the operator; answers run on the owner's own key.** Owner's decision. It amends PRD 01 DD9 for embeddings only: Anthropic offers no embeddings API, so the owner's key cannot cover them, and embedding a personal library costs little. Every text sent for embedding is the owner's own stored text, sent to Cloudflare, where it is already stored. Enrichment and answers stay bring-your-own-key.
5. **Asking is in this PRD.** Owner's decision. A split into two packages is expected: indexing, backfill, search by meaning, passages and deletion first (foundational); asking second, built on passages.
6. **Agents get passages (`search_passages`), not an ask tool.** Owner's decision. An agent has its own model; Alexandria supplies the retrieval and spends nothing of the owner's key on an agent's behalf.
7. **Related links are out.** Owner's decision, to keep the scope to two packages.
8. **Keyword search while typing, search by meaning on Enter; keyword stays the API's default.** Owner's decision: a Workers AI call per keystroke is wasted work, and existing API clients keep today's answers byte for byte. The MCP tool always uses hybrid, since an agent sends whole queries.
9. **Backfill at 60 links a minute per user, shown nowhere.** Owner's decision. 10,000 links index in about 3 hours.
10. **Ranking: one fused ranking with one hard rule**, that a keyword match on title, tags or topic is never below a meaning-only match. Owner's decision.
11. **Reader text indexed up to 50,000 characters.** Owner's decision: almost every article whole, long PDFs bounded.
12. **Search by meaning p95 under 800 ms, falling back to keyword after 600 ms.** Proposed; the owner chose meaning on Enter, where a slightly slower answer is acceptable, and the fallback keeps a slow index from ever blocking a search.
13. **The similarity threshold is a fixed constant, provisional.** Its value depends on the embedding model chosen in the architecture; it is set there against a sample of the owner's library and recorded in an ADR. It is the same constant for search, passages and asking.
14. **8 passages per answer, passages of at most 1,500 characters, at most 3 per link.** Proposed: enough context for an answer from several sources within the 20,000 characters enrichment already sends a provider.
15. **Answers stream as server-sent events, with refusals as JSON before the stream.** Proposed: the answer appears as it is written, and every failure that can be known before calling the provider keeps the API's error envelope.
16. **Nothing about asking is stored.** Proposed: no history keeps the scope small and leaves nothing new for export or deletion.
17. **The `mode` and `match`/`meaning` fields are additive.** Proposed: `mode=keyword` answers are unchanged, so the OpenAPI document and existing clients only gain.
18. **A suggested design for `spec --architecture`, not a requirement**: one Vectorize namespace per user; the indexed passages kept in D1 beside the links, so they can be returned and deleted; reciprocal rank fusion of the bm25 and vector rankings; a new indexing queue fed by the fetch consumer, enrichment and edits; the embedding and index calls behind an interface that the tests and `wrangler dev` replace with a deterministic fake; a new ADR for the Vectorize and Workers AI choice.

## Dependencies

- `docs/prd/01-build-the-alexandria-link-library.md`: lifts its non-goal "Semantic / vector search", and amends its Design Decision 9 (bring your own key) for embeddings only (Design Decision 4 here).
- `docs/adr/01-build-on-a-cloudflare-worker-with-d1.md`: adds two Cloudflare services to the one Worker.
- `.specs/06_search_and_browse` (active, all tasks done): extends `GET /api/v1/search`, the search box and the Search and Archive pages; keyword search, the query language and the refusals are unchanged.
- `.specs/08_mcp_server` (active, all tasks done): `search_links` searches with `mode=hybrid`; a new tool `search_passages`; the instructions text changes.
- `.specs/02_fetch_and_snapshot`, `.specs/03_ai_enrichment`, `.specs/04_workspaces_and_notes` (active, all tasks done): the writes that queue indexing; asking reuses package 03's AI key, its rejected-key handling and its providers.
- `.specs/05_decay_and_liveness`, `.specs/09_export_and_account_deletion` (active, all tasks done): deletion paths that must remove index entries; the export is unchanged.
- External systems: Cloudflare Vectorize and Workers AI (new); the owner's Anthropic or OpenRouter key (existing), for asking.

## Verified External API

Read from `@cloudflare/workers-types` 5.20261108.1 (`index.d.ts`), the current release of the package the repository depends on (`^5.20261107.1`):

- `Vectorize.query(vector: VectorFloatArray | number[], options?: VectorizeQueryOptions): Promise<VectorizeMatches>`, with `VectorizeQueryOptions { topK?: number; namespace?: string; returnValues?: boolean; returnMetadata?: boolean | "all" | "indexed" | "none"; filter?: VectorizeVectorMetadataFilter }`.
- `Vectorize.queryById(vectorId: string, options?: VectorizeQueryOptions): Promise<VectorizeMatches>`, `insert(vectors: VectorizeVector[]): Promise<VectorizeAsyncMutation>`, `upsert(vectors: VectorizeVector[]): Promise<VectorizeAsyncMutation>`, `deleteByIds(ids: string[]): Promise<VectorizeAsyncMutation>`, `getByIds(ids: string[]): Promise<VectorizeVector[]>`, `describe(): Promise<VectorizeIndexInfo>`.
- `VectorizeVector { id: string; values: VectorFloatArray | number[]; namespace?: string; metadata?: Record<string, VectorizeVectorMetadata> }`; `VectorizeMatch` adds `score: number`. `VectorizeDistanceMetric = "euclidean" | "cosine" | "dot-product"`. Mutations are asynchronous: `VectorizeIndexInfo` reports `processedUpToMutation`.
- `Ai.run(model, inputs, options?)`. Embedding models in the typings: `@cf/baai/bge-m3`, `@cf/baai/bge-base-en-v1.5`, `@cf/baai/bge-large-en-v1.5`, `@cf/baai/bge-small-en-v1.5`, `@cf/google/embeddinggemma-300m`, `@cf/qwen/qwen3-embedding-0.6b`, `@cf/pfnet/plamo-embedding-1b`. `@cf/baai/bge-m3` takes `{ text: string | string[]; truncate_inputs?: boolean }` and returns `{ shape?: number[]; data?: number[][]; pooling?: "mean" | "cls" }`.
- `@cf/baai/bge-reranker-base` takes `{ top_k?: number; contexts: { text?: string }[] }` and returns `{ response?: { id?: number; score?: number }[] }`. The typing documents a query but declares no `query` field: **unverified**. Reranking is not required by this PRD.
- **Unverified** (not in the typings): each model's vector dimensions and input limits; Vectorize's limits (vectors and namespaces per index, the `topK` maximum with and without metadata, metadata size, id length); both services' prices; the `wrangler vectorize create` and `create-metadata-index` subcommands (wrangler is not installed in this checkout); whether `wrangler dev` can bind Vectorize and Workers AI locally without a Cloudflare account (assumed not, hence the constraint above).
- The owner's providers for asking: streaming through `@anthropic-ai/sdk` (`^1.6.0`) `messages.stream` / `messages.create({ stream: true })` and OpenRouter's `POST /chat/completions` with `stream: true`: **unverified** (the SDK is not installed in this checkout; `src/worker/enrich/providers.ts` uses only non-streaming `messages.create`).

## Glossary

- **search by meaning**: a search with `mode=hybrid`, matching the query to links by the similarity of their embeddings as well as by shared words.
- **embedding**: a vector of numbers computed from a piece of text, such that texts of similar meaning have nearby vectors.
- **passage**: a contiguous piece of a link's indexed text, at most 1,500 characters, the unit the index matches and returns.
- **hybrid search**: one ranking that merges the keyword matches and the matches by meaning of the same query.
- **meaning match**: a link a hybrid search returns only because of its meaning (`match: "meaning"`).
- **similarity threshold**: the fixed similarity a passage must reach to be returned by a search by meaning, a passage request or an answer.
- **backfill**: the background indexing of links that have no index entry or an outdated one.
- **ask**: a question answered by the owner's own AI provider from passages of the owner's links, citing them.

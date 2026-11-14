# Search and ask through one retrieval pipeline

## Intent

Search by meaning and Ask were built as two thin layers over one vector lookup: a search fuses a link-level keyword ranking with the nearest vectors, and an answer is written from the eight nearest passages, whatever they are. Both miss what the library holds: exact terms when asking, the back of long pages, passages that only make sense with their page's title, and questions worded differently from the pages that answer them. Alexandria should find the best passages of the owner's links through one pipeline (by words and by meaning together, then ordered by a model that reads the query and the passage side by side) and use that same pipeline for searching, for the passages agents ask for, and for answering questions, so that an improvement to retrieval improves all three.

## Goals

- A question asked on the Ask page, through `POST /api/v1/ask` or through `GET /api/v1/passages` that names a term found only as an exact word in a link's reader text (an error code, a version number, a person's name) and shares little meaning with it retrieves the passage that holds the term.
- The passages an answer is written from, the passages `GET /api/v1/passages` returns and the passage a hybrid search shows for a link are ordered by a reranker's relevance to the query, not by vector similarity.
- The first 200,000 characters of a link's stored reader text are findable by meaning and by Ask, instead of the first 50,000.
- A passage is matched by meaning with its page's title and topic path in view, so a passage that never names its subject is still found for a question about that subject.
- A question asked in words the saved pages do not use ("how do I run something later on Cloudflare?") is answered from the pages that do answer it, because Ask retrieves with the question and with up to two other phrasings of it written by the owner's provider.
- The provider that writes an answer receives each chosen passage with the passages before and after it, and with its link's title, topic path, host, date added and summary.
- Every page of one hybrid search comes from the ranking computed for its first page: paging returns every result once, in one order, whether or not Workers AI answers in time for the later pages.
- A link found by meaning alone shows, as its snippet, the part of its best passage that answers the query, not the passage's first 32 words.
- A hybrid search of a library of 10,000 links answers in under 2,000 ms (p95), and says so on the page whenever meaning could not be used.
- Every link indexed before this change is re-indexed by the backfill without the owner doing anything, and stays findable by its previous passages until it is.

## Non-goals

- A set of test questions with expected links, and measuring recall or ranking quality against it. The owner left it out of this work; the relevance threshold below is therefore provisional, as the similarity threshold was. A later PRD.
- Changing keyword search: `GET /api/v1/search` without `mode`, its query language, filters, ranking and refusals stay as they are after pull requests #49 and #50.
- Searching workspaces by meaning, searching across users, embedding images or raw snapshot HTML (PRD 02 non-goals, kept).
- An MCP tool that asks the library on the owner's key (PRD 02 Design Decision 6, kept): agents get better passages through `search_passages` and do their own rewriting and answering.
- Rewriting or expanding the query of a search or of `GET /api/v1/passages`: only Ask does, because only Ask already calls the owner's provider.
- Related links (`GET /api/v1/links/{id}/related`): they keep matching metadata passages by vector similarity at their own threshold (ADR 06).
- Changing the embedding model or the vector index: `@cf/baai/bge-m3` and the Vectorize index `alexandria-passages` stay (ADR 05).
- Learning from clicks, per-user tuning, or recommendations (PRD 01 non-goal, kept).
- Follow-up questions, multi-turn conversation, and stored questions or answers (PRD 02 non-goals, kept; the owner's decision, Design Decision 6). Every question stands alone.

## Background

PRD 02 (`docs/prd/02-find-links-by-meaning-and-ask-the-library.md`) added search by meaning, passages and Ask; packages `.specs/10_meaning_index`, `.specs/11_hybrid_search` and `.specs/12_ask_the_library` built them. An investigation of search quality in November 2026 found the gaps this PRD closes. What exists today:

- **Passages** (`src/worker/meaning/cut.ts`, `indexing.ts`). A link is cut into passages of at most 1,500 characters: first its title, summary, topic, tags and note (kind `metadata`), then the first 50,000 characters of its reader text (kind `reader`), cut at a paragraph break, else a sentence end, else a space. Passages do not overlap. Each passage's text is embedded as it is, with `@cf/baai/bge-m3` on Workers AI, and stored as a row of `link_passages` and a vector in the owner's Vectorize namespace. A text version per link, moved by triggers, marks a link stale; the index queue and the every-minute backfill (60 stale links a minute per user) re-index stale links.
- **Finding passages** (`src/worker/meaning/passages.ts`, `findPassages`). The query's free words are joined and embedded as typed; the 100 nearest vectors are taken; those with cosine similarity of at least 0.5 (`SIMILARITY_THRESHOLD` in `meaning/backend.ts`, marked provisional) are read from D1, filtered by the query's prefix filters, capped at 3 a link, and returned best first. No word index is consulted and nothing reorders them. `GET /api/v1/passages`, the MCP tool `search_passages` and Ask all call it, with a 5-second deadline.
- **Hybrid search** (`src/worker/search/hybrid.ts`, `routes.ts`). `GET /api/v1/search?mode=hybrid` takes every keyword match of the query (the FTS5 index `link_search`, one row per link, whole words in any of their English forms once #50 is merged), the links whose best passage `findPassages` returns (at most 100, with a 600 ms deadline), and orders them in two tiers: links whose title, tags and topic hold every free word first, then the rest, each tier by reciprocal rank fusion of the two rankings. When Workers AI or Vectorize fails or takes over 600 ms the answer is the keyword matches with `meaning: "unavailable"`. Pages use an offset cursor and the whole ranking is computed again for every page, so two pages of one search can come from different rankings. A link found by meaning alone shows the first 32 words of its best passage.
- **The search box** (`src/web/components/SearchBox.tsx`). Once #49 is merged it searches only on Enter, always with `mode=hybrid`.
- **Ask** (`src/worker/meaning/ask.ts`, `src/web/pages/Ask.tsx`). `POST /api/v1/ask` with `{question, detailed?}` takes the 8 best passages (16 when `detailed`), sends each as `[n] <title>` and its text, then the question, to the owner's provider (`streamAnswer` in `src/worker/enrich/providers.ts`, Anthropic or OpenRouter, the owner's key and model), and streams `sources`, `delta` and `done` events. The Ask page shows one answer, a "Tell me more" button that asks the same question with `detailed`, and a Copy button; asking again replaces the answer. Nothing is stored.
- **Limits of the stored text.** `link_texts` holds at most 500,000 characters of reader text a link; the word index covers all of it, the meaning index the first 50,000.

Constraints:

- Constraint: Vectorize and Workers AI stay the vector index and the embedding service (ADR 05); reranking also runs on Workers AI, on the deployment's account.
- Constraint: answers, and any other call to a language model that writes text, run only on the owner's own key and model (PRD 01 Design Decision 9, PRD 02 Design Decision 4). Rephrasing a question is such a call.
- Constraint: `make test` and `make e2e` run without a Cloudflare account; the reranker is reached through the same replaceable interface as embeddings and the vector index (`MeaningBackend`, `src/worker/meaning/backend.ts`), with a deterministic fake.
- Constraint: strict per-user separation; the website and the MCP server reach the library only through the API.

## Requirements

### Passages and their index

- A link's passages are cut from its metadata (title, summary, topic path, tags, note) and from the first 200,000 characters of its stored reader text. Reader text past 200,000 characters is found by keyword search only. A passage is at most 1,500 characters, as today.
- Consecutive passages of a link's reader text overlap: each starts with the last sentence of the one before it, at most 200 characters of it; when the previous passage ends in no sentence of at most 200 characters, there is no overlap.
- A reader passage is matched by meaning as its text preceded by its link's title and topic path. The title and path are not part of the passage's text as the API returns it.
- A passage is also findable by its words: every word of the passage's text, whole and in any of its English forms, case- and accent-insensitively, as keyword search matches words.
- When a link's title or topic path changes, its reader passages are matched with the new title and path once the link is re-indexed; the existing rule that such a change makes the link stale already covers it.
- Re-indexing after this change: when it is deployed, every link is stale. The backfill re-indexes them at its existing pace (60 links a minute per user, most recently used first). Until a link is re-indexed it is found by the passages it had; a search, a passage request or an answer never mixes a link's old and new passages.
- Boundaries: a link with 200,000 characters of reader text or more is indexed on its first 200,000 in one indexing job; a word at character 200,001 is found by `GET /api/v1/search` and by no passage; a link with no reader text is indexed on its metadata alone.
- Failure: Workers AI or Vectorize fails while a link is indexed. As today: the job is retried up to 5 times, then the link is left with its previous passages and the backfill picks it up.

### Finding passages

One procedure finds the passages for one or several phrasings of a query; hybrid search, `GET /api/v1/passages`, `search_passages` and Ask all use it.

- Candidates come from two sources: the 100 passages nearest the query by meaning, and the 100 passages that best match the query's free words by their words (at least one free word, more matching words and rarer words ranking higher). Both are restricted to the owner's passages and to links that satisfy the query's prefix filters; archived and expired links are left out exactly as search leaves them out.
- With several phrasings (Ask), each phrasing gives its two lists of candidates. All the lists are fused into one (reciprocal rank fusion) and the best 50 are given to the reranker with the query as its author wrote it, never with a phrasing. The reranker's relevance, from 0 to 1, orders them.
- A passage is returned only when its relevance reaches the relevance threshold, a fixed constant, so a query unrelated to anything in the library returns nothing.
- Each passage found says how: `keyword`, `meaning` or `both`.
- Failure: the reranker fails or has not answered within its share of the deadline. The fused order is used; passages found by meaning must then reach the similarity threshold (0.5) as today, and passages found by words alone are kept. The caller is told (see each surface below).
- Failure: Workers AI (embedding) or Vectorize fails or is late. The passages found by words alone are used, reranked when the reranker answers. The caller is told.
- Failure: both fail. Passages found by words, in word-match order.
- No request reads passages, vectors or rankings of another user.

### Search by meaning

- `GET /api/v1/search?mode=hybrid` with at least one free word keeps its rules: every keyword match of the query is returned; a link whose title, tags and topic hold every free word is never below a link that does not; ties are broken by pin, last use and id. Within a tier, links are ordered by fusing the keyword ranking of links with the ranking of each link's best passage found above.
- A link that is not a keyword match is returned only when one of its passages reaches the relevance threshold; its `match` is `meaning`.
- The snippet of a `meaning` match is the run of at most 32 words of its best passage that the reranker scores highest against the query, with the query's words marked where they occur in it; when the reranker is not available, the start of the passage, as today.
- The search waits at most 3,000 ms for meaning and reranking together. The response's `meaning` field is `"used"`, `"unranked"` (meaning was used, the reranker was not) or `"unavailable"` (neither). The search never answers 5xx because of the index or the reranker.
- All pages of one search come from the ranking computed for its first page. A cursor is valid for 15 minutes after its first page was computed; after that, or for a ranking that no longer exists, the request is refused as `400 invalid_cursor`, as any unusable cursor is. A link deleted between pages is left out of later pages.
- The website: with `meaning: "unranked"` or `"unavailable"` the results page shows the line "Showing keyword matches only." (unavailable) or "Results are not ordered by relevance." (unranked), each with a "Try again" button that repeats the search.
- `mode=keyword` and a query of filters only answer exactly as today.

### Passages for agents

- `GET /api/v1/passages` and `search_passages` keep their parameters, limits (1 to 20, default 8, at most 3 a link) and refusals. Each item gains `match` (`keyword`, `meaning` or `both`); `score` is the reranker's relevance.
- The response's `meaning` field takes the same three values as search. With `"unranked"`, `score` is the similarity for a passage found by meaning and `null` for one found by words alone. With `"unavailable"` every `score` is `null`.
- Failure: the request answers `503 search_unavailable` only when D1 fails; it no longer does when Workers AI or Vectorize is unavailable.
- The deadline is 5 seconds, as today.

### Asking

- `POST /api/v1/ask` keeps its body, `{question, detailed?}`, and its refusals.
- Before retrieving, Alexandria asks the owner's provider, with the owner's key and model, for the question restated as a search query and for at most two other phrasings of it, each at most 200 characters. Passages are then found with the question as typed and with every phrasing (at most four in all). The prefix filters of the typed question apply to all of them; a phrasing never adds or removes a filter.
- Failure of that call: the provider is unreachable, answers 5xx, answers nothing usable (no phrasing, or text that is not the list asked for) or has not answered within 10 seconds. The question as typed is used alone and the ask continues; nothing is shown. A phrasing over 200 characters is dropped; phrasings past the second are dropped.
- Failure: the provider rejects the key (401, 402, 403) on that call. The ask is refused before any stream starts with `409 {"error": "ai_key_rejected", "message": "<the provider's message>"}` and the key is marked rejected, as a rejected enrichment marks it.
- The `sources` event gains `queries`, the phrasings retrieval used, the question as typed first, and `meaning`, with the three values search uses. The Ask page shows the phrasings other than the typed question under the answer, as "Also searched for: …"; with only the typed question it shows nothing.
- The answer is written from the 8 best passages (16 when `detailed`) found by the procedure above. Each is given to the provider with the passage before and the passage after it in the same link; passages that touch or overlap are joined and shared text appears once. Each source is headed by its number, title, topic path, host, the date it was added and its summary. The passages sent hold at most 40,000 characters in all (80,000 when `detailed`); when over, neighbouring passages are dropped first, from the lowest-ranked source up.
- "Tell me more" asks the same question with `detailed`; its phrasings are asked for again.
- Everything else of Ask is unchanged: the instructions to answer from the passages only and to cite, "Nothing in your library answers this." when no passage is found, the refusals before the stream, the `error` events, the count of asks (one for an ask, whatever calls it makes), and that nothing is stored.

### End-to-end flows

1. The owner saved a long guide that mentions the error code `E1101` once, 120,000 characters in; the owner asks "what causes E1101?"; the passage is found by its words, the answer cites the guide, and the source opens its detail page.
2. The owner asks "how do I run something later on Cloudflare?"; the `sources` event's `queries` holds the question and two phrasings, one of which the page titled "Durable Objects alarms" is found by; the answer cites it and the page shows "Also searched for: …".
3. The owner searches `scheduling background work` and presses Enter; a link found by meaning shows the sentence of its article about alarms as its snippet; "More results" continues the same order.
4. The reranker is unreachable; the same search answers within its deadline with "Results are not ordered by relevance." and a Try again button.
5. An agent calls `search_passages("E1101")` and receives the passage with `match: "keyword"`.
6. After the deploy, a link not yet re-indexed is still found by meaning through its previous passages; an hour later it is found through passages past its 50,000th character.

## Design Decisions

1. **One procedure for finding passages, used by search, passages and Ask.** Proposed: today's three callers already share `findPassages`; the redesign keeps that and moves word matching and reranking into it, so no surface can lag behind another.
2. **Passages are found by words as well as by meaning.** Addresses gap 2. Hybrid search's link-level keyword matching stays beside it, because titles, tags and hosts are matched per link.
3. **A reranker orders the candidates; its relevance replaces vector similarity as the cut-off.** Addresses gap 3. Proposed model: `@cf/baai/bge-reranker-base` on Workers AI, paid by the deployment like embeddings. The relevance threshold is a fixed constant, **provisional**: without a test set it cannot be tuned (see Non-goals).
4. **Reader text is indexed by meaning up to 200,000 characters.** Owner's decision. Addresses gap 4; replaces PRD 02 Design Decision 11. Nearly every article and most long PDFs whole, at four times the depth, with a bound on embedding cost: a link of that length is about 140 passages.
5. **Reader passages are matched with their title and topic path, and overlap by one sentence.** Addresses gap 5.
6. **No follow-up questions.** Owner's decision: every question stands alone, and PRD 02's non-goal on multi-turn conversation and its Design Decision 16 (nothing stored) stay.
7. **Every question is restated and expanded by the owner's provider before retrieval.** Owner's decision. Addresses gap 6. It adds one provider call, its tokens and its wait to every ask; when that call fails the ask goes on with the question as typed. The reranker judges passages against the typed question, so a poor phrasing can add candidates but cannot change what counts as an answer.
8. **Neighbouring passages and link metadata go to the provider.** Addresses gap 7. 40,000 characters is twice what enrichment sends.
9. **A search waits up to 3,000 ms for meaning and reranking, with a target of 2,000 ms at p95.** Owner's decision. Addresses gap 8; replaces PRD 02 Design Decision 12. Search is on Enter only, so a slower, better answer is acceptable.
10. **A search's ranking is kept for 15 minutes so its pages agree.** Addresses gap 8. Proposed: the cost is one more kind of derived data, removed with the account and never exported.
11. **The snippet of a meaning match is chosen by the reranker.** Addresses gap 9. **Provisional**: it costs a second reranker call for the meaning matches of a page.
12. **Three values of `meaning`** (`used`, `unranked`, `unavailable`) on search, passages and the `sources` event, rather than a second field. Proposed.
13. **A suggested design for `spec --architecture`, not a requirement**: a word index over `link_passages` kept by triggers, as `link_search` is; the reranker as a method of `MeaningBackend` with a fake; the kept rankings in D1 with an expiry swept by the every-minute run; a migration that moves every link's text version, as `0013_reindex_passage_kinds.sql` did; an ADR that amends ADR 05.

## Dependencies

- `docs/prd/02-find-links-by-meaning-and-ask-the-library.md`: replaces its Design Decisions 11 and 12, and changes what `score` and `meaning` mean in `GET /api/v1/passages` and `GET /api/v1/search`.
- `.specs/10_meaning_index`, `.specs/11_hybrid_search`, `.specs/12_ask_the_library` (active, every task done): changed by this work; their intents stand.
- `.specs/08_mcp_server` (active, every task done): `search_passages` returns the new fields.
- `.specs/09_export_and_account_deletion` (active, every task done): account deletion must also remove the kept rankings and the passages' word index.
- `docs/adr/05-index-links-by-meaning-with-vectorize-and-workers-ai.md`: amended (reranker, whole text, passage context); `docs/adr/06-relate-links-by-their-metadata-alone.md`: unchanged.
- Pull requests #49 (search on Enter only) and #50 (whole words and stemming): open; this PRD describes search as it is once both are merged.
- External systems: Cloudflare Workers AI (embeddings, and now reranking) and Vectorize; the owner's Anthropic or OpenRouter key.

## Verified External API

Read from `@cloudflare/workers-types` 5.20261107.1 (`node_modules/@cloudflare/workers-types/index.d.ts`):

- `Ai.run("@cf/baai/bge-reranker-base", inputs)`: `Ai_Cf_Baai_Bge_Reranker_Base_Input { top_k?: number; contexts: { text?: string }[] }`, output `{ response?: { id?: number; score?: number }[] }` where `id` is the index of the context. The typing documents "a query you wish to perform against the provided contexts" but declares no `query` field: **unverified**. Also **unverified**: whether `score` is between 0 and 1, the most contexts a call takes, the longest context, and the price. Cloudflare's documentation could not be reached from the session this PRD was written in.
- `Ai.run("@cf/baai/bge-m3", { text: string | string[]; truncate_inputs?: boolean })` returning `{ data?: number[][] }`, and `Vectorize.query`, `upsert`, `deleteByIds` as `src/worker/meaning/backend.ts` calls them today.
- **Unverified**: Vectorize's limits (vectors and namespaces per index, the largest `topK`), which bound how many passages a library of long pages may hold: a link of 200,000 characters is about 140 passages.
- `streamAnswer(env, call, request: AnswerRequest, onText)` and `splitWith(env, call, prompt)` in `src/worker/enrich/providers.ts` are the project's own; `splitWith` is a structured, non-streaming request to the owner's provider of the kind the phrasings need.

## Glossary

- **passage**, **embedding**, **similarity threshold**, **backfill**, **ask**, **meaning match**, **hybrid search**: as PRD 02 defines them.
- **reranker**: a model that reads a query and one passage together and scores how well the passage answers the query; slower and more exact than comparing embeddings.
- **relevance**: the reranker's score of a passage for a query, from 0 to 1.
- **relevance threshold**: the fixed relevance a passage must reach to be returned.
- **fused order**: one ranking made from several by reciprocal rank fusion, as hybrid search already fuses its two.
- **phrasing**: a search query the owner's provider writes from a question: the question restated, or another way of asking it.

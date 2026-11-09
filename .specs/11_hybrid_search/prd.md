---
spec_id: "11"
spec_name: "hybrid_search"
title: "Search the library by meaning as well as by words"
status: "sealed"
created_at: "2026-11-09T08:23:01Z"
intent_hash: "d7b32701ba0da368a0e48cc30274d708e09537d576034a5225a0905c6d713380"
schema_version: 3
source: "docs/prd/02-find-links-by-meaning-and-ask-the-library.md"
---

# Search the library by meaning as well as by words

## Intent

Keyword search finds a link only when the query shares words with it, so a page saved as "Durable Objects alarms" is lost to a search for "scheduling work in the background on Cloudflare". Alexandria's search should also find links by what they mean, in one ranking with the keyword matches, so that nothing keyword search finds is lost and an exact name is never buried under looser matches, while keyword search stays exactly what it is for the clients and the typing that rely on it.

## Goals

- A search by meaning whose free words share no word with a link, but whose meaning matches the link's title, summary, note or reader text, lists that link on the first page of `GET /api/v1/search?mode=hybrid`, on the website's Search page after Enter, and through the MCP tool `search_links`.
- A search by meaning still lists every link the keyword search of the same query lists, and a link whose keyword match is on its title, tags or topic is never ranked below a link found by meaning alone.
- Keyword search stays the default of `GET /api/v1/search` and of the search box while typing, byte for byte as today, with the PRD 01 target unchanged: p95 under 500 ms for a library of 10,000 links.
- A search by meaning answers in under 800 ms (p95) for a library of 10,000 links.
- When Workers AI or Vectorize fails or is slow, a search by meaning still answers, with the keyword results, and says so.

## Non-goals

- **The index itself**: indexing, the backfill, passages, deletion from the index and `search_passages`. Package `10_meaning_index` built them; this package only reads the index through it.
- **Asking the library** (`POST /api/v1/ask`, the Ask page). Package `12_ask_the_library`, written by its own run.
- Searching workspaces by meaning: workspaces stay keyword-matched on name, description and note, as today.
- Changing the query language: the prefix filters, the 200-character cap and the refusals of `GET /api/v1/search` stay as they are.
- Making hybrid the API's default, or searching by meaning while typing.
- Tuning ranking per user, learning from clicks, or related links.

## Background

PRD 02 (`docs/prd/02-find-links-by-meaning-and-ask-the-library.md`) was split into three packages (its Design Decision 19 in package 10). Package `10_meaning_index` (active, all tasks done) indexes every link's passages in Vectorize, one namespace per user, and offers `findPassages` (`src/worker/meaning/passages.ts`): the passages of the user's links that best match free words by meaning, scoring at least the similarity threshold of 0.5 (`SIMILARITY_THRESHOLD`, `src/worker/meaning/backend.ts`), read from the user's own rows under the query filters, throwing `MeaningUnavailable` when Workers AI or Vectorize fails or takes over 5 seconds.

What exists today:

- **Keyword search.** `GET /api/v1/search` (`src/worker/search/routes.ts`) parses the query (`parseQuery`, `src/worker/search/query.ts`), ranks free-word matches from the FTS5 index by bm25 with weights title 10, tags and topic 5, summary 3, host, original URL and note 2, reader text 1, then pinned, then recently used, then id (`rankedLinks`, `src/worker/search/search.ts`), gives each a snippet of at most 32 words with the matched words marked, pages with a signed offset cursor (`{s: 'r', o}`), lists matching workspaces on the first page, and answers a query of filters only in stream order with the stream's cursor. The answer is `{items: [{link, snippet}], workspaces, next_cursor}`, documented as `SearchResults` in `src/worker/api/openapi.ts`.
- **The website.** `components/SearchBox` searches 200 ms after the last keystroke at `/search?q=` (on the Archive page `/archive?q=`), owns `/` and Escape, and its form ignores submission today. `pages/Search` shows the results with `components/Snippet` and a "More results" button; `pages/Archive` searches with `state:archived` appended. `api.ts` `search(q, cursor)` is the client; `searchPath(q)` the address.
- **The MCP server.** `search_links(query, limit?)` in `src/worker/mcp/tools.ts` is `GET /api/v1/search?q=<query>&limit=<limit>` and returns its body.

Constraints:

- Constraint: the tests and the end-to-end tests run without a Cloudflare account; package 10's fakes stand in for Workers AI and Vectorize (`src/worker/test/meaning.ts`, `e2e/fake-meaning.ts`).
- Constraint: strict per-user separation; the website and the MCP server reach the library only through the API.

## Requirements

### The search mode

- `GET /api/v1/search` takes a new parameter `mode`: `keyword` (the default, exactly today's behaviour) or `hybrid`. Any other value: `400 {"error": "invalid_mode", "field": "mode", "message": "mode takes keyword, hybrid"}`.
- A response with `mode=keyword` (or no `mode`) is byte-for-byte what it is today: no `match` and no `meaning` field.
- With `mode=hybrid`, a query of filters only and an empty query answer exactly as with `mode=keyword`, plus `meaning: "used"`. The refusals (`query_too_long`, `invalid_filter`, `invalid_limit`, `invalid_cursor`) are unchanged; a cursor issued for one mode is refused as `invalid_cursor` in the other.

### One ranking of words and meaning

- With `mode=hybrid` and at least one free word, the results are the links that match the free words by keyword, by meaning, or both, in one ranking:
  - every link the keyword search of the same query returns is returned;
  - a link whose keyword match is on its title, tags or topic is never ranked below a link found by meaning alone;
  - a link found by meaning alone is returned only when its best passage reaches the similarity threshold, so a query unrelated to anything in the library answers with only its keyword matches (none, if it has none);
  - ties are broken as keyword search breaks them: pinned (by position), then the more recently used, then by id.
- The filters apply to links found by meaning exactly as to keyword matches, and archived links are left out without a `state:` filter.
- Paging by cursor returns every result once across pages. The first page lists matching workspaces as today.

### What a hybrid answer carries

- Each item carries a new field `match`: `"keyword"`, `"meaning"` or `"both"`. Its `snippet`: for a keyword or both match, as today (at most 32 words, matched words marked); for a meaning match, the start of the passage that matched best, at most 32 words, no word marked.
- Each hybrid response carries a new top-level field `meaning`: `"used"`, or `"unavailable"` when meaning could not be added.

### When meaning is unavailable

- Workers AI or Vectorize fails, or has not answered within 600 ms: the search answers 200 with the keyword results of the query, each `match: "keyword"`, and `meaning: "unavailable"`. It never answers 5xx because of the index.

### Speed

- A hybrid search answers in under 800 ms (p95) for a library of 10,000 links; keyword search keeps its p95 under 500 ms.

### The website

- Typing in the search box searches by keyword 200 ms after the last keystroke, as today. Pressing Enter in the box searches the same query by meaning, and the address becomes `/search?q=<query>&mode=hybrid` (`/archive?q=<query>&mode=hybrid` on the Archive page), so a reload or a shared address repeats the search by meaning. Typing again returns to keyword search.
- On a hybrid results page (Search or Archive), a meaning match is marked "by meaning" beside its snippet, and `meaning: "unavailable"` shows the line "Showing keyword matches only." above the results.

### The MCP tool

- `search_links` always searches with `mode=hybrid` and returns its body. Its description tells agents it matches by meaning as well as by words.

### End-to-end flows

1. The owner adds `https://example.com/durable-object-alarms`; it is fetched and indexed; the owner types `run a task later on cloudflare` into the search box and presses Enter; the address becomes `/search?q=run+a+task+later+on+cloudflare&mode=hybrid`, and the link appears marked "by meaning", with the start of a passage from the article as its snippet.
2. The owner searches `cloudflare queues` and presses Enter; the link titled "Cloudflare Queues explained" is first, as it is in the keyword results.
3. Workers AI is unreachable; the owner searches `cloudflare queues` by meaning and gets the keyword results with the line "Showing keyword matches only."
4. An agent calls `search_links("run a task later")` through the MCP server and receives the Durable Objects article, `match: "meaning"`.

## Design Decisions

2. **Hybrid, not semantic-only.** (PRD 02.) Keyword matches stay, so exact names, hosts and identifiers are never lost to meaning.
3. **`search_links` gains meaning by being `GET /api/v1/search?mode=hybrid`**, rather than a separate tool, which would duplicate the filters and the paging. (PRD 02.)
8. **Keyword search while typing, search by meaning on Enter; keyword stays the API's default.** Owner's decision (PRD 02): a Workers AI call per keystroke is wasted work, and existing API clients keep today's answers byte for byte. The MCP tool always uses hybrid.
10. **One fused ranking with one hard rule**, that a keyword match on title, tags or topic is never below a meaning-only match. Owner's decision (PRD 02).
12. **p95 under 800 ms, falling back to keyword after 600 ms.** (PRD 02.)
17. **The `mode`, `match` and `meaning` fields are additive.** (PRD 02.)
34. **The ranking is in two tiers, each ordered by reciprocal rank fusion.** First the links whose keyword match is on their title, tags or topic; then every other match, by keyword elsewhere, by meaning, or both. Within a tier, a link's score is the sum of 1/(60 + rank) over the keyword ranking (bm25 order) and the meaning ranking (its best passage's score order) it appears in; ties go to pinned, more recently used, then id. The tiers make the hard rule hold by construction, and fusion with k = 60 is the usual choice when the two rankings' scores are not comparable.
35. **Meaning adds at most 100 links to a query**, the links of the 100 nearest passages that pass the threshold and the filters, each once with its best passage. The keyword ranking takes part in the fusion up to its first 1,000 links; keyword matches past that follow, in keyword order, below every fused link of their tier. Every keyword match is still returned, and the bound keeps a hybrid search within its time for a library of 10,000 links.
36. **A hybrid page is a slice of the whole fused ranking, paged by a signed offset cursor of its own kind (`{s: 'h', o}`)**, so a keyword cursor (`'r'`) and a hybrid one are refused in each other's mode, and every result appears once.
37. **The 600 ms deadline covers the embedding and the query together**; `findPassages` gains the deadline and a one-passage-per-link option as parameters, its 5-second default staying for `GET /api/v1/passages`.
38. **The website's Enter is the box's form submission**; typing starts a new keyword search 200 ms later and drops `mode` from the address. The Search and Archive pages read `mode` from the address.
39. **The end-to-end fake gains a switch that makes it fail** (`POST /__fail`, `POST /__recover` on `e2e/fake-meaning.ts`), for the flow in which Workers AI is unreachable.

## Dependencies

- `.specs/06_search_and_browse` (active, all tasks done): extends `GET /api/v1/search`, the search box and the Search and Archive pages; keyword search, the query language and the refusals are unchanged.
- `.specs/08_mcp_server` (active, all tasks done): `search_links` searches with `mode=hybrid` and its description changes.
- `.specs/10_meaning_index` (active, all tasks done): reads the index through `findPassages`, its fakes and its threshold.

## Verified External API

None beyond package 10's: this package calls Workers AI and Vectorize only through `findPassages` and `meaningBackend` (`src/worker/meaning/`), whose external calls package 10 records.

## Glossary

- **search by meaning**: a search with `mode=hybrid`, matching the query to links by the similarity of their passages as well as by shared words.
- **hybrid search**: one ranking that merges the keyword matches and the matches by meaning of the same query.
- **meaning match**: a link a hybrid search returns only because of its meaning (`match: "meaning"`).
- **strong keyword match**: a keyword match on a link's title, tags or topic.
- **similarity threshold**: the fixed similarity (0.5) a passage must reach to count, package 10's `SIMILARITY_THRESHOLD`.

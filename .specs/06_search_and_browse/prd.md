---
spec_id: "06"
spec_name: "search_and_browse"
title: "Search the library and browse it by topic and tag"
status: "active"
created_at: "2026-11-07T14:22:28Z"
intent_hash: "c924de5f35f4af3c69f65cea1b37f42bda33196d1282534049861b0904d3f8b5"
schema_version: 3
source: "docs/prd/01-build-the-alexandria-link-library.md"
---

# Search the library and browse it by topic and tag

## Intent

Alexandria is a personal, private library of web links for one person at a time. This package makes the library findable: one keyword search, reachable from every page, over everything the library knows about a link (its title, summary, tags, topic, host, address, the text of the page and the owner's notes), narrowed by prefix filters, and two browsing pages that group the library by its automatically discovered topics and tags, whose vocabulary the owner can rename and merge so that it converges instead of fragmenting. A link that cannot be found is as good as lost, which is the problem 600 open tabs already have.

## Goals

- A search over title, summary, tags, topic, host, original URL, reader-view text and notes returns results in under 500 ms (p95) for a library of 10,000 links.
- Prefix filters `tag:`, `topic:`, `host:`, `state:archived`, `state:any`, `in:<workspace>`, `is:pinned` and `is:dead` narrow a query, and the same filters narrow the API's link list.
- Links are grouped automatically by discovered topic and by tag on the Topics and Tags pages, each with its link count; a topic or tag with no links disappears.
- The owner can rename or merge topics and tags, and enrichment of later links uses the renamed vocabulary.
- The search box is on every page; `/` focuses it from any page and `Escape` clears it, and there are no other keyboard shortcuts.
- Each user's search reaches only that user's links: no query, filter or index entry crosses users.

## Non-goals

- Semantic / vector search. Search here is keyword search; semantic search is a later PRD.
- Accounts, adding links, the stream, pinning and the API conventions: package 01 (`accounts_links_and_stream`), on which this builds.
- Fetching, snapshots and the reader-view text itself: package 02 (`fetch_and_snapshot`). This package indexes the text 02 stores.
- Producing summaries, tags and topics, and editing them on a link: package 03 (`ai_enrichment`). This package lists, renames and merges the vocabulary 03 creates.
- Workspaces and notes: package 04 (`workspaces_and_notes`). This package searches the notes and filters by workspace.
- Decay, the Archive page and liveness: package 05 (`decay_and_liveness`). This package puts the search box on the Archive page and filters by archived and dead.
- Bulk import (07), the MCP server's `search_links` tool (08, which calls this package's search), export and account deletion (09).
- Analytics, recommendations, or discovery of links the owner did not add.
- Sharing or any cross-user feature.

## Background

After packages 01 to 05 the library has: users, sessions and tokens; links with their normalised and original URLs, host, title, state (`pending`, `active`, `unreachable`, `dormant`, `archived`), last used, use count and pin position; the stream at `GET /api/v1/links` with opaque cursors (`src/worker/api/pagination.ts`) and the error envelope (`src/worker/api/errors.ts`); fetched metadata and the reader-view text, capped at 500,000 characters, stored by the fetch worker (`src/worker/fetcher/`); summary, topic and tags in the `topics`, `tags` and `link_tags` tables, written by enrichment (`src/worker/enrich/`, whose `vocabulary.ts` gives enrichment the user's existing topics and tags) and by the owner's edits through `PATCH /api/v1/links/{id}`; workspaces with `workspace_links` and Markdown notes on workspaces and links (`links.note`); `archived_at` and `dead_since` on links and the Archive page (`src/web/pages/Archive.tsx`). The website has a stream, a link card (`src/web/components/LinkCard.tsx`), settings and the pages of those packages. There is no search, no index, no Topics or Tags page and no keyboard shortcut. The OpenAPI document (`src/worker/api/openapi.ts`) must describe every route, and a test fails when it does not.

Constraints from the source PRD:

- Constraint: TypeScript; API in Hono on Cloudflare Workers; data in D1.
- Constraint: strict per-user separation of data and processing.
- Constraint: minimalistic design; responsive from 375 px; light and dark following the system.

## Requirements

### Search

- A search box on every page. A query matches, case-insensitively, against title, summary, tags, topic, host, the original URL, the reader-view text and the link's note; results are ordered by relevance with pinned and recently used links breaking ties; each result shows the same card as the stream plus a highlighted matching snippet. A query also finds the workspaces whose name, description or note matches it.
- Prefix filters narrow the query: `tag:foo`, `topic:bar`, `host:example.com`, `state:archived`, `in:workspace-name`, `is:pinned`, `is:dead`. Archived links are included only with `state:archived` or `state:any`. A value with spaces is written in double quotes (`topic:"web development"`).
- Empty query shows the stream; a query with no match shows "nothing found for <query>" and the active filters. Queries are capped at 200 characters.
- The API's link list accepts the same filters as query parameters, and search is an API resource of its own, cursor-paged like every list.
- A search over 10,000 links answers in under 500 ms at the 95th percentile.

### Topics and tags

- **Topics** page: every topic with its link count, newest first; clicking opens the stream filtered to that topic. **Tags** page: the same for tags. A topic or tag with zero links disappears.
- A user can rename or merge topics and tags (merging moves every link to the surviving one). Automatic enrichment of later links uses the renamed vocabulary.

### Keyboard

- `/` focuses the search box from any page and `Escape` clears it and returns focus to the page; there are no other shortcuts.

### End-to-end flows

1. The owner, with fetched and enriched links in the library, presses `/`, types `queues tag:cloudflare`, sees the matching links with the matched words highlighted, presses `Escape` and is back on the page with an empty search box.
2. The owner merges the tag `js` into `javascript` on the Tags page; every link tagged `js` is now tagged `javascript`; a link enriched afterwards for which the provider proposes `js` is stored with `javascript`.

## Design Decisions

1. **Keyword search runs on D1's FTS5**, one index row per link holding title, summary, tags, topic, host, original URL, note and reader-view text, ranked by FTS5's bm25 with column weights title 10, tags and topic 5, summary 3, host and original URL 2, note 2, reader text 1. Decided in this run: it is built into D1, needs no further service, and meets the 500 ms goal at 10,000 links.
2. **Matching is by word prefix and every word must match.** The query's free words are each matched as a prefix of a word in the indexed text (`cloud` finds `cloudflare`), case- and accent-insensitively, and all of them must match. FTS5 operators in the query (`AND`, `OR`, `NOT`, `NEAR`, `*`, `"`, `(`, `)`, `:`, `-`) are taken as literal text, never as syntax. Decided in this run, so that a query never fails on its characters.
3. **Each user's index rows carry that user's id as an indexed term that every query must match**, so that the full-text match itself cannot return another user's link. Decided in this run, for the separation constraint.
4. **The index is kept current by database triggers** on the link, tag, topic and note columns, and by an explicit call where the fetch worker stores reader-view text (which package 02 stores in D1's `link_texts` table and which is copied into the index). Decided in this run: triggers cannot be forgotten by a later writer.
5. **The filters' meaning.** `tag:`, `topic:` and `in:` compare names case-insensitively and exactly; `host:example.com` matches that host and its subdomains; `state:` accepts `pending`, `active`, `unreachable`, `dormant`, `archived` and `any`; `is:` accepts `pinned` and `dead`; repeated filters all apply. An unknown `state:` or `is:` value is refused with 400 `invalid_filter`; any other `word:` is free text. A filter-only query lists in stream order. Decided in this run: the source PRD names the filters but not their edge cases.
6. **Snippets are returned as segments**, `[{text, match}]`, from the best-matching text column, at most about 32 words, and the website marks the matched segments; no HTML is ever produced from page text. Decided in this run, so that page text cannot inject markup.
7. **Workspaces are search results of their own**, listed above the links on the first page, matched on name, description and note. Decided in this run: the source PRD puts workspace notes in search but a workspace is not a link.
8. **"Newest first" on the Topics and Tags pages orders topics and tags by the added date of their newest link.** Counts include links in every state; a topic or tag whose last link leaves it is deleted, so that it is neither listed nor offered to enrichment. Decided in this run.
9. **Renamed and merged-away names become aliases** of the survivor; an enrichment result naming an alias is stored as the survivor, and renaming to a name another topic or tag already has is refused with 409 `name_taken` (merge is the way to combine them). Decided in this run, so that the vocabulary converges even when the provider repeats an old name.
10. **Tag names are 1 to 50 characters of lower-case letters and digits in hyphen-joined words; topic names are 1 to 100 characters.** Decided in this run, matching the tag form the source PRD gives enrichment.
11. **The website searches as the owner types**, 200 ms after the last keystroke, at `/search?q=`; on the Archive page the search is limited to archived links. `/` typed inside a text field types a slash. Decided in this run.

## Dependencies

- Package 01 `accounts_links_and_stream`: users, links, the stream order, cursors, the error envelope, the OpenAPI document, `LinkCard.tsx` and the shared test helpers.
- Package 02 `fetch_and_snapshot`: the reader-view text and fetched title, indexed here; `e2e/fake-origin.ts` for the end-to-end flow.
- Package 03 `ai_enrichment`: summary, topics, tags, `PATCH /api/v1/links/{id}`, the enrichment vocabulary (`src/worker/enrich/vocabulary.ts`) and `e2e/fake-ai.ts`.
- Package 04 `workspaces_and_notes`: workspaces, membership and notes, searched and filtered here.
- Package 05 `decay_and_liveness`: archived and dead links and the Archive page, filtered and searched here.

## Verified External API

None beyond the packages above: the work uses D1's built-in FTS5 through the `DB` binding, Hono 4.13.17 and React 19.3.1 as package 01 sets them up.

## Glossary

- **query**: the text of the search box, at most 200 characters: free words and prefix filters.
- **prefix filter**: a `name:value` term of the query that narrows the results instead of being matched as text.
- **snippet**: the short passage of a result's text around the words that matched, with those words highlighted.
- **topic**: the single automatically assigned category of a link; **tag**: one of several automatically or manually assigned labels.
- **alias**: a former name of a topic or tag, kept after a rename or merge so that enrichment proposing it lands on the survivor.
- **stream**: the home page listing, pinned links first then by last use descending.

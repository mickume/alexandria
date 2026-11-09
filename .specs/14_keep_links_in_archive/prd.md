---
spec_id: "14"
spec_name: "keep_links_in_archive"
title: "Keep chosen links for good in an archive"
status: "active"
created_at: "2026-11-09T16:44:10Z"
intent_hash: "804ff0df06e09fc6fdaebd35665aba84cfd1a95fbecc39f5d067948d3390add8"
schema_version: 3
source: "docs/prd/03-rank-links-by-points-and-keep-chosen-links-in-an-archive.md"
---

# Keep chosen links for good in an archive

## Intent

Let the owner say "keep this one for good". A link the owner archives is refreshed once and then kept indefinitely, with its metadata and its offline copy, outside of decay and out of the stream, while search, Ask and its workspaces still find it. Package 13 renamed decay's holding area "expired" to free the word "archive" for this meaning.

## Goals

- The owner can archive any link that is not archived, from its card, from its detail page or with the MCP tool `archive_link`. The link leaves the stream at once, a fresh fetch of its address is queued, and it is never expired or removed by decay.
- The Archive page lists archived links, dimmed, with Unarchive and Delete. Unarchiving puts a link back in the stream with its points reset.
- An archived link is still found by keyword search, hybrid search, the searches a topic or tag opens, and Ask, and it stays in its workspaces. Everywhere it is shown, it is dimmed.

## Non-goals

- Points, expiry, removal, the Expired page and the stream's order: package 13 (`points_and_expiry`), sealed.
- An MCP tool to unarchive or restore a link.
- Notifications about archived links.
- Liveness checks of archived links: they are skipped, as expired links are.
- Re-pinning a link on unarchive.
- A migration: `links.archived_at` and its index exist since migration 0005 and are empty since migration 0012.

## Background

Package 13 (`points_and_expiry`, sealed) gave every link `points` and the state `expired`, and withdrew manual archiving until this package.

- A link's state is `pending`, `active`, `unreachable` or `expired`. The column `links.archived_at` (migration 0005) is still there, always null since migration 0012, and `link_views` selects it with `l.*`.
- `toView` in `src/worker/links/store.ts` builds every link the API returns. `decayFields` in `src/worker/decay/note.ts` adds `points`, `expired_at`, `removal_at` and `decay_note`. The API no longer returns `archived_at`.
- `src/worker/decay/archive.ts` serves `GET /api/v1/expired` (`expiredRoutes`, keyset cursor `{e, i}`, `limit` 1 to 100, default 50) and `POST /api/v1/links/{id}/restore` (`restoreRoutes`). `POST /api/v1/links/{id}/archive` and `GET /api/v1/archive` answer 404.
- `evaluateDecay` in `src/worker/decay/decay.ts` expires only links whose state is `active`, `pending` or `unreachable`, and removes only `expired` links.
- `recordUse` in `src/worker/links/use.ts` and the re-paste in `addLinkStatement` (`src/worker/links/store.ts`) set `last_used_at` to now and turn `expired` into `active`; they leave any other state as it is.
- `POST /api/v1/links/{id}/refresh` (`src/worker/fetcher/routes.ts`) claims `refresh_requested_at` at most once per 10 minutes and sends `{user_id, link_id, refresh: true}` on `FETCH_QUEUE`. The consumer (`processFetch` in `src/worker/fetcher/queue.ts`) writes a successful fetch with `writeFetched`, which sets the state to `active` whatever it was, replaces the snapshot and reader text, and then calls `afterFetch` (`src/worker/enrich/queue.ts`) and queues indexing. A failed refresh only records a failed `fetch` event in `link_events` (`recordFailure`).
- `filterConditions` in `src/worker/search/query.ts` leaves expired links out unless a `state:` filter is given; `STATE_VALUES` is `pending`, `active`, `unreachable`, `expired`, `any`. Keyword search, hybrid search, Ask and the filters-only searches (`streamPage` in `src/worker/search/routes.ts`) all use it.
- `listStream` in `src/worker/links/stream.ts` serves `GET /api/v1/links` (the stream, with optional filter parameters) and every filters-only search: pinned links by pin position, then the rest by points, last use and id, with the cursor `{s: 'p' | 'r', t, …}`. `listChanged` serves the change feed and leaves expired links out.
- `checkRoutes` in `src/worker/decay/liveness.ts` refuses `POST /api/v1/links/{id}/check` on an expired link with 409 `link_expired`; `enqueueDueChecks` checks links that are not expired and are active or pinned.
- `pinLink` in `src/worker/links/store.ts` pins any link of the owner.
- The MCP tools are in `src/worker/mcp/tools.ts`; each calls an API route and returns its answer through `outcomeOf`. There is no `archive_link`.
- The website: `src/web/pages/Expired.tsx` lists expired links with Restore and Delete and limits its search box to `state:expired`; `src/web/App.tsx` holds the navigation (`SECTIONS`) and the routes. `LinkCard` (`src/web/components/LinkCard.tsx`) shows Open, Read and Pin and a More actions menu (Snapshot, Details, Refresh, the workspace picker, Remove from workspace, Delete); the Stream, Search and Workspace pages show links as `LinkCard`s. The detail page (`src/web/pages/LinkDetail.tsx`) has an Actions group: Refresh, Check, Pin or Unpin, the workspace picker and Delete. The Ask page lists its sources as plain links.
- The end-to-end tests' fake origin (`e2e/fake-origin.ts`) serves fixed pages and can be taken offline; it cannot change what one address serves.

## Requirements

### Archiving

- The owner archives a link with `POST /api/v1/links/{id}/archive`. A link in any state except `archived` can be archived: `active`, `pending`, `unreachable` or `expired`.
- Archiving does all of the following in the request, and answers `200 <link>` without waiting for the fetch:
  - sets the state to `archived` and `archived_at` to now;
  - clears `expired_at`;
  - unpins the link and closes up the pin positions;
  - keeps its workspace memberships;
  - queues a fetch of the link's address with the meaning of a refresh. That fetch ignores the 10-minute refresh limit and does not count against it: `refresh_requested_at` is not changed.
- If the fetch cannot be queued, the link stays archived, the answer is still `200 <link>`, and its history gets a failed fetch event with the reason "refresh before archiving could not be queued".
- Archiving a link that is already archived answers `200 <link>`, changes nothing and queues nothing.
- A missing link, or another user's, gets `404 {"error": "not_found"}` and nothing changes.

### The refresh after archiving

- When the queued fetch succeeds, the snapshot and the reader text are replaced and the link is handed to enrichment, as a refresh does today. The link stays `archived`. Fields the owner edited are kept, and without a verified AI key the enrichment records `no_key` and changes nothing.
- When the fetch fails, the link stays `archived` with the snapshot, reader text and metadata it had, and the failure is recorded in its history as a failed refresh is today.

### Kept outside decay

- The scheduled evaluation never makes an archived link expired and never removes it, whatever its last use.
- A use of an archived link (an open, a read, a snapshot view, an MCP open) adds 1 to its use count and sets its last use to now. It stays archived.
- A re-paste of an archived link's address sets its last use to now without adding a use. It stays archived.
- Every link the API returns carries `archived_at`: the time it was archived for an archived link, null for every other link. An archived link has `points: null`, `removal_at: null` and `decay_note` "archived on 2027-03-01: kept until deleted" (its `archived_at` date).
- Weekly liveness checks skip archived links. `POST /api/v1/links/{id}/check` on an archived link is refused with `409 {"error": "link_archived", "message": "archived links are not checked"}`, without a request to the link's address.

### Unarchiving

- `POST /api/v1/links/{id}/unarchive` makes an archived link `active`, clears `archived_at` and sets the last use to now without adding a use, so its points become `start_points` plus its use count. It does not re-pin the link. It answers `200 <link>`.
  - A link that is not archived gets `409 {"error": "not_archived", "message": "this link is not archived"}`, and nothing changes.
  - A missing link, or another user's, gets `404 {"error": "not_found"}`.

### Where archived links are listed

- The stream, `GET /api/v1/links`, leaves archived links out unless its `state` parameter names `archived` or `any`. The change feed (`GET /api/v1/links?changed_since=…`) leaves them out.
- Keyword search, hybrid search, every search made of filters alone (the searches a topic or tag opens among them) and Ask include archived links when no `state:` filter is given, and leave expired links out as today.
- `state:` accepts `archived` in search and in `GET /api/v1/links`; `state:archived` keeps only archived links, and `state:any` keeps every state.
- A search made of filters alone lists pinned links, then the links with points in the order of the stream, then archived links, newest last use first, then id descending. Paging through it lists every link that does not change exactly once.
- `POST /api/v1/links/{id}/pin` on an archived link is refused with `409 {"error": "link_archived", "message": "archived links cannot be pinned"}`, and nothing changes.
- A workspace lists its members in their order whatever their state, as today.

### The archive list

- `GET /api/v1/archive` lists the owner's archived links, most recently archived first (id descending on ties), each with `archived_at` and `removal_at: null`, paged with `limit` (1 to 100, default 50) and `cursor`. An invalid `limit` or `cursor` is refused with 400 `invalid_limit` or `invalid_cursor`, as every paged route refuses them.

### The MCP tool

- The MCP tool `archive_link` takes `{"link_id": "<id>"}` and archives the link as `POST /api/v1/links/{id}/archive` does, returning the link. A missing link is returned as the tool error `{"error": "not_found"}` that every tool returns for one.

### The website

- The navigation has an entry "Archive", after "Expired", that opens `/archive`.
- The Archive page lists the archived links from `GET /api/v1/archive`, each dimmed, with "archived on <date>", an Unarchive button and Delete. An unarchived link leaves the list. Its search box sends the query with `state:archived` and shows the results on the Archive page. With no archived links it says "Nothing is archived."
- A card that is not archived has Archive in its More actions menu. Choosing it archives the link, and the card leaves the stream.
- An archived card, wherever a `LinkCard` is shown (a search result, a workspace), is dimmed, and has Unarchive where a card has Pin, and no Archive.
- The detail page's Actions group has Archive for a link that is not archived, and Unarchive, in place of Pin, for an archived one. Each sends its request and shows the link as the API returns it.
- On the Ask page a source that is archived is dimmed.

### End-to-end flows

1. The owner archives a link from its card in the stream. The card leaves the stream. The fake origin now serves new content at the link's address. Once the queued fetch has been processed, the link's Read view shows the new content. The Archive page lists the link, dimmed, and a search for a word of the new content finds it, dimmed. The owner presses Unarchive. The link is back in the stream.
2. An agent archives a link with the MCP tool `archive_link`. The owner opens the Archive page and finds it there.

## Design Decisions

1. **"Archived" means kept indefinitely.** The owner's decision, in PRD 03.
2. **Archiving takes effect at once; the refresh and the re-enrichment follow it, and a failed refresh keeps what the link had.** The owner's decision, in PRD 03: the archive's purpose is to keep, and a dead site must not stop a link from being kept.
3. **Archived links are out of the stream but in search, hybrid search, the topic and tag searches, Ask, workspaces and the Archive page, dimmed everywhere.** The owner's decision, in PRD 03.
4. **Any link that is not archived can be archived, expired ones included. Unarchiving resets the points.** The owner's decision, in PRD 03.
5. **Archiving unpins a link and keeps its workspaces; unarchiving does not re-pin it.** Decided in PRD 03: the pinned section is part of the stream.
6. **The refresh before archiving bypasses the 10-minute refresh limit and does not count against it.** Decided in PRD 03: archiving must not be refused because of a recent refresh.
7. **Liveness checks skip archived links.** Decided in PRD 03: an archived link's value is its stored copy.
8. **`GET /api/v1/links` is the stream and leaves archived links out unless its `state` parameter names them, filter parameters or not; `GET /api/v1/search` includes them.** Decided in this run: the website reads the stream from `GET /api/v1/links` and opens topic and tag searches through `GET /api/v1/search`, so this is the split PRD 03 describes.
9. **Pinning an archived link is refused with 409 `link_archived`.** Decided in this run: the pinned section is part of the stream, which leaves archived links out; the owner unarchives first.
10. **A successful fetch keeps an archived link archived.** Decided in this run: the fetch worker sets every fetched link `active` today, which would undo the archiving that queued the fetch.
11. **No migration.** Decided in this run: `links.archived_at` and the index `links_archived` exist since migration 0005.
12. **The Archive action is in a card's More actions menu and in the detail page's Actions group; an archived card and detail page offer Unarchive where Pin was.** Decided in this run: Archive is less frequent than Pin, and an archived link cannot be pinned.
13. **Archived links in a filters-only search come after the links with points, newest last use first.** Decided in PRD 03: they have no points to rank by.
14. **The end-to-end tests' fake origin gains a control that changes the page one address serves.** Decided in this run: flow 1 needs the refresh to find new content.
15. **Profile: full.** Decided in this run: the flows cross the website, the API, the fetch worker and the MCP server.

## Dependencies

- Package 13 (`points_and_expiry`, sealed): points, `expired`, the stream's order and cursor, `GET /api/v1/expired` and the decay note this package extends.
- Package 01 (`accounts_links_and_stream`, active): the stream, the change feed, `recordUse`, the re-paste and pinning.
- Package 02 (`fetch_and_snapshot`, active): the refresh fetch queued by archiving and the fetch worker's writes.
- Package 03 (`ai_enrichment`, active): the enrichment after that fetch, and its rule that the owner's edits win.
- Package 04 (`workspaces_and_notes`, active): archived members stay listed in their workspaces.
- Package 05 (`decay_and_liveness`, active): the weekly liveness checks and the on-demand check.
- Package 06 (`search_and_browse`, active): the `state:` filter values and the default exclusion.
- Package 08 (`mcp_server`, active): `archive_link` returns with its new meaning.
- Packages 11 (`hybrid_search`) and 12 (`ask_the_library`), both sealed: archived links are in their results by default.

## Glossary

- **archived**: a link the owner chose to keep. It is refreshed once and kept indefinitely with its metadata and snapshot, outside decay. It is out of the stream, in search and Ask, and dimmed.
- **unarchive**: bringing an archived link back to the stream as active, with its points reset.
- **expired**: a link whose points reached 0; out of the stream and removed later (package 13).
- **boost**: setting a link's last use to now without a use: a re-paste, a restore or an unarchive.

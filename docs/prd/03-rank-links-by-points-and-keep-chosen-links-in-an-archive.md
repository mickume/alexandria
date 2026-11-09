# Rank links by points, expire unused links and keep chosen links in an archive

## Intent

Alexandria's decay today moves an unused link to a holding area that ends in deletion, and calls that area the "archive", so the owner has no way to say "keep this one for good". This change separates the two. A link the owner does not use expires and is later removed. A link the owner chooses to archive is refreshed once and then kept indefinitely, with all its metadata and its offline copy, outside of decay. Each link's standing in the library is a single number, its points, which use raises and time lowers, so the stream puts first the links that are used most and most recently.

## Goals

- Every link that is not archived carries `points`, returned by the API and shown on its card. Points are the owner's start points plus the link's use count, minus the whole days since its last use or boost.
- A link whose points reach 0 or less, and that is neither pinned nor in a workspace, becomes `expired` within 24 hours. It leaves the stream and is listed on the Expired page with its removal date. It is removed `remove_days` after it expired, unless it is used or restored first.
- The owner can archive any link that is not archived, from the stream, the link's page or the MCP tool `archive_link`. The link leaves the stream at once and appears on the Archive page as a dimmed card. A fresh fetch of its snapshot and a fresh enrichment are queued for it. An archived link is never expired or removed by decay.
- An archived link is still found by search, by hybrid search and by Ask, and it is still listed in its workspaces. Everywhere it is shown, its card is dimmed.
- The stream lists pinned links first, in pin order, then every other link by points descending, then last use descending.
- After the change, every link that was `archived` is `expired` with the same removal date, and every link that was `dormant` is `active`.

## Non-goals

- Weighting uses by their age, their kind (open, read or snapshot view) or their day. Every use counts 1, whenever it happened.
- Stickiness (5 uses on 5 days) and the `dormant` state: both are removed. The use bonus to points takes stickiness's place.
- A manual "expire" action. Deleting a link already removes it at once.
- Notifications (email, push) about links that expire, are removed or are archived.
- Recovering a removed link: removal stays permanent.
- Changing the ranking of searches with free words (keyword or hybrid). They keep their relevance order. Only searches made of filters alone, such as a topic or a tag, use the order of the stream.
- An MCP tool to unarchive or restore a link. MCP keeps `archive_link`, which takes on the new meaning.
- Liveness checks of archived or expired links. Neither is checked today, and neither is after the change.

## Background

Package 05 (`decay_and_liveness`) implements decay. `evaluateDecay` in `src/worker/decay/decay.ts` evaluates one user in one D1 transaction. `runScheduled` in `src/worker/decay/cron.ts` runs every hour and evaluates each user whose last evaluation started 20 hours ago or more. The evaluation makes an `active` link `dormant` after `dormant_days` without use (default 60). It makes any link that is not archived `archived` after `archive_days` (default 120), unless the link is sticky (at least 5 uses on at least 5 distinct UTC days), pinned or in a workspace. It removes an archived link `remove_days` (default 180) after its `archived_at`, deleting its uses, texts, passages, events, tags, workspace memberships and stored objects.

A link's state is one value: `pending`, `active`, `unreachable`, `dormant` or `archived`. A use is an open, a read, a snapshot view or an MCP open. Each use goes through `recordUse` in `src/worker/links/use.ts`, which adds 1 to `use_count`, sets `last_used_at` to now, writes a `link_uses` row and turns `dormant` into `active`. A re-paste (`src/worker/links/store.ts`) and a restore set `last_used_at` to now without adding a use.

The archive today is the holding area before deletion. `GET /api/v1/archive` lists archived links newest-archived first, each with `removal_at`. `POST /api/v1/links/{id}/archive` archives a link by hand and unpins it. `POST /api/v1/links/{id}/restore` makes an archived link `active` again. The MCP tool `archive_link` (`src/worker/mcp/tools.ts`) calls the archive route. The website's Archive page (`src/web/pages/Archive.tsx`) lists archived links with Restore and Delete, and searches them with `state:archived`. `LinkCard` (`src/web/components/LinkCard.tsx`) has an Archive action, dims dormant cards, and shows `decay_note`, a "sticky" label and "dead since". The Settings page's `DecaySection` edits the three thresholds through `GET` and `PUT /api/v1/settings/decay`.

The stream (`listStream` in `src/worker/links/stream.ts`) lists pinned links by pin position, then the rest by `last_used_at` descending and id descending, paged by a keyset cursor. A topic chip, a tag chip, the Topics page and the Tags page open the search for `topic:<name>` or `tag:<name>`. A search made of filters alone is answered in stream order by `streamPage` in `src/worker/search/routes.ts`. `filterConditions` in `src/worker/search/query.ts` leaves archived links out of every search, hybrid search and Ask included, unless a `state:` filter is given. The change feed (`listChanged`) leaves archived links out.

A refresh already exists. `POST /api/v1/links/{id}/refresh`, at most once per link per 10 minutes, queues a fetch on `FETCH_QUEUE`. On success it replaces the snapshot and the reader text and hands the link to enrichment (`afterFetch` in `src/worker/enrich/queue.ts`). Enrichment keeps every field the owner edited, and without a verified AI key it records `no_key` and changes nothing. A refresh that fails records the failure in the link's history and keeps everything the link had.

Liveness checks cover links that are `active` or `dormant`, or pinned, and never archived ones. `POST /api/v1/links/{id}/check` refuses an archived link with 409 `link_archived`.

## Requirements

### Points and settings

- A link that is not archived has points: the owner's `start_points` plus the link's use count, minus the number of whole 24-hour periods since its last use or boost. Points can be negative. An archived link has no points (`points: null`).
- A use (an open, a read, a snapshot view or an MCP open) adds 1 to the use count and sets the last use to now. The link's points therefore become `start_points` plus the new use count. A re-paste, a restore and an unarchive set the last use to now without adding a use.
- Every link the API returns carries `points` (an integer, or null for an archived link) and `expired_at` (a timestamp, or null). The field `sticky` is no longer returned.
- `GET /api/v1/settings/decay` answers `200 {"start_points": 60, "remove_days": 180}` with the owner's values (defaults shown). `PUT /api/v1/settings/decay` takes both fields. Each must be a whole number from 7 to 3650.
  - A value missing, not a whole number or outside 7 to 3650 is refused with `400 {"error": "invalid_threshold", "field": "<field>", "message": "<field> must be a whole number from 7 to 3650"}`, and nothing is stored.
  - A body that is not a JSON object is refused as every JSON route refuses one today.
- A change to `start_points` applies to every link at once, because points are always computed from the current setting. A link whose points fall to 0 or below because of the change expires at the next evaluation.
- The Settings page shows the two fields: "Start points" ("Points a link starts with, and goes back to when used, plus one per use. It loses one a day.") and "Remove after expiring (days)". A refusal is shown beside its field, as today.

### Expiry and removal

- The scheduled evaluation (hourly, each user at most once per 20 hours, in one transaction, as today) makes every link `expired` and sets its `expired_at` to the evaluation time when all of these hold:
  - its points are 0 or below;
  - its state is `active`, `pending` or `unreachable`;
  - it is not pinned;
  - it is in no workspace.
- A pinned link or a link in a workspace keeps losing points, which lowers it in the stream, but never expires. Once it is unpinned and in no workspace, it expires at the next evaluation if its points are 0 or below.
- The same evaluation removes every expired link whose `expired_at` is at least `remove_days` before the evaluation time. Removal deletes everything that is deleted today, stored objects included. The removal date is `expired_at` plus `remove_days`, shown as `removal_at`.
- An evaluation that fails for a user changes none of that user's links and is retried at the next hourly run, as today.
- An expired link is left out of the stream, the change feed, and every search, hybrid search and Ask without a `state:` filter. It can still be opened from the Expired page, from a search with `state:expired` or `state:any`, and by its id.
- A use of an expired link makes it `active` at once, in the request that recorded the use: `expired_at` is cleared and its points become `start_points` plus its use count. A re-paste of an expired link does the same, without adding a use.
- `GET /api/v1/expired` lists the owner's expired links, most recently expired first, each with `expired_at` and `removal_at`. It is paged with `limit` and `cursor`, as `GET /api/v1/archive` is today. An invalid `limit` or `cursor` is refused as it is today.
- `POST /api/v1/links/{id}/restore` makes an expired link `active`, clears `expired_at` and sets the last use to now. It answers `200 <link>`.
  - A link that is not expired gets `409 {"error": "not_expired", "message": "this link is not expired"}`, and nothing changes.
  - A missing link, or another user's, gets 404.
- The website's Expired page, a new entry in the navigation, lists expired links with their removal date, with Restore and Delete, and with the search box limited to `state:expired`.
- `POST /api/v1/links/{id}/check` on an expired link is refused with `409 {"error": "link_expired", "message": "expired links are not checked"}`. Weekly liveness checks skip expired links.

### Archiving

- The owner archives a link with `POST /api/v1/links/{id}/archive`, from the Archive action on its card, or with the MCP tool `archive_link`. A link in any state except `archived` can be archived: `active`, `pending`, `unreachable` or `expired`.
- Archiving does all of the following in the request:
  - sets the state to `archived` and `archived_at` to now;
  - clears `expired_at`;
  - unpins the link and closes up the pin positions;
  - keeps its workspace memberships;
  - queues a fetch of the link's address with the meaning of a refresh.

  The request answers `200 <link>` without waiting for the fetch. The fetch ignores the 10-minute refresh limit and does not count against it.
- When that fetch succeeds, the snapshot and reader text are replaced and the link is enriched again, as a refresh does today. Fields the owner edited are kept, and without a verified AI key the enrichment records `no_key` and changes nothing.
- When the fetch fails, or the enrichment fails, the link stays archived with the snapshot, reader text and metadata it had. The failure is recorded in its history as a refresh failure is today.
- If the fetch cannot be queued, the link stays archived. The failure is recorded in its history as a failed fetch event with the reason "refresh before archiving could not be queued".
- Archiving a link that is already archived answers `200 <link>`, changes nothing and queues nothing. A missing link, or another user's, gets 404.
- An archived link is never made expired or removed by the evaluation, whatever its last use. A use of an archived link adds 1 to its use count and sets its last use to now. It stays archived.
- A re-paste of an archived link sets its last use to now, and it stays archived.
- `POST /api/v1/links/{id}/unarchive` makes an archived link `active`, clears `archived_at` and sets the last use to now. Its points therefore become `start_points` plus its use count. It does not re-pin the link. It answers `200 <link>`.
  - A link that is not archived gets `409 {"error": "not_archived", "message": "this link is not archived"}`, and nothing changes.
  - A missing link, or another user's, gets 404.
- `GET /api/v1/archive` lists the owner's archived links, most recently archived first, each with `archived_at` and with `removal_at: null`. It is paged with `limit` and `cursor` as today.
- The website's Archive page lists archived links with Unarchive and Delete. Its search box is limited to `state:archived`.
- An archived link is shown as a dimmed card wherever it appears: the Archive page, a workspace, a search result and an Ask source. `POST /api/v1/links/{id}/check` on an archived link is still refused with 409 `link_archived`.

### Search and visibility

- A search without a `state:` filter (keyword, hybrid, or filters alone) and Ask return links that are `active`, `pending`, `unreachable` or `archived`, and leave expired links out.
- `state:` accepts `pending`, `active`, `unreachable`, `expired`, `archived` and `any`. `state:dormant` is refused as any unknown filter value is today, with 400 `invalid_filter`.
- The stream and the change feed leave out expired and archived links.
- A search made of filters alone, which includes the search a topic or tag opens, lists links in the order of the stream. Archived links come after every link that has points, newest last use first, and are dimmed.
- A workspace lists its members in their order whatever their state, as today.

### Ordering

- The stream lists pinned links first, by pin position. Then it lists every other listed link by points descending, then last use descending, then id descending.
- Example: with `start_points` 60, link A was used 10 times and last used 5 days ago, so it has 65 points. Link B was used once, today, so it has 61. A is listed above B.
- Paging is stable within one sequence of pages. The pages after the first are ordered by the points as of the time of the first page, so every link that does not change while the owner pages appears exactly once.
- A cursor issued before this change is refused with 400 `invalid_cursor`, as any cursor the API did not issue is. The website then starts again from the first page.

### Decay note and link card

- `decay_note` says each link's standing in one sentence:
  - "42 points: expires in 42 days";
  - "pinned: never expires, -3 points";
  - "in a workspace: never expires, 12 points";
  - "expired on 2027-03-01, removed on 2027-08-28";
  - "archived on 2027-03-01: kept until deleted".
- The link card shows the decay note on every card. It no longer shows a "sticky" label or a dimmed dormant style. It dims archived cards. It keeps "dead since <date>" and the struck-through title for dead links.

### Changing existing data

- When the change is deployed:
  - every `archived` link becomes `expired`, with `expired_at` set to its former `archived_at` and `archived_at` cleared, so its removal date does not change;
  - every `dormant` link becomes `active`;
  - every owner's `dormant_days` becomes their `start_points`;
  - `remove_days` is kept;
  - `archive_days` is dropped.
- Because points are computed, a link left `active` whose points are 0 or below on the deploy expires at the owner's first evaluation after it. This covers a link that was dormant, and was unused for 60 to 119 days with few uses. Its removal date is that evaluation plus `remove_days`.

### End-to-end flows

1. The owner archives a link from its card in the stream. The card leaves the stream. The fake origin now serves new content for the link's address. Once the queued fetch has been processed, the link's Read view shows the new content. The Archive page lists the link as a dimmed card, and a search for a word of the new content finds it, dimmed. The owner presses Unarchive. The link is back in the stream, ranked by its reset points.
2. A link is unused for `start_points` days. After the next hourly run it is missing from the stream and listed on the Expired page with its removal date. The owner opens it from there. It is back in the stream as active.
3. The owner has two links: one used 10 times, last used 5 days ago, and one used once, today. With `start_points` 60, the stream lists the first above the second.

## Design Decisions

1. **"Archived" now means kept indefinitely. Package 05's archive is renamed "expired", with the same meaning.** This is the owner's decision.
2. **Points are `start_points` plus the use count, minus whole days since the last use or boost.** This is the owner's decision. Computing points rather than storing a counter means the owner can always see why a link has its points, and a settings change applies to every link at once (also the owner's decision).
3. **Two settings: `start_points` (from `dormant_days`, default 60) and `remove_days` (default 180).** This is the owner's decision. A link expires at 0 points and is removed `remove_days` after it expired, at which point its points are negative. `archive_days` is dropped.
4. **No `dormant` state and no stickiness. Pinned links and links in a workspace keep losing points but never expire.** This is the owner's decision. The use bonus replaces stickiness.
5. **Archiving is the owner's decision, like pinning, and takes effect at once. The refresh and the re-enrichment follow it.** This is the owner's decision. Decided in this run: a failed refresh keeps what the link had, because the archive's purpose is to keep, and a dead site must not stop a link from being kept.
6. **Archived links are out of the stream but in search, hybrid search, Ask, workspaces and the Archive page, dimmed everywhere.** This is the owner's decision. Decided in this run: the searches a topic or tag opens include archived links, listed after the links with points, because those are searches and the owner wants archived links to be found.
7. **Any link that is not archived can be archived, expired ones included. Unarchiving resets the points.** This is the owner's decision.
8. **The names `archive`, `GET /api/v1/archive`, `archive_link` and the Archive page take the new meaning. Expired links get `GET /api/v1/expired`, `POST /restore` and an Expired page. Unarchiving is `POST /unarchive`.** This is the owner's decision. The break in the API is accepted because the library has one owner, whose website is deployed with the Worker.
9. **A use or re-paste of an expired link reactivates it.** This is the owner's decision.
10. **Pending and unreachable links expire like active ones.** Decided in this run: package 05 archived them by decay too, and a link that never fetched is the least worth keeping.
11. **Archiving unpins a link and keeps its workspaces. Unarchiving does not re-pin it.** Decided in this run, as package 05 does for manual archiving: the pinned section is part of the stream.
12. **The refresh before archiving bypasses the 10-minute refresh limit and does not count against it.** Decided in this run: archiving is a separate action from refreshing, and it must not be refused because of a recent refresh.
13. **Liveness checks skip expired and archived links.** Decided in this run, as package 05 skips archived links: an archived link's value is its stored copy, which a dead origin does not change.
14. **Stream paging is ordered as of the first page.** Decided in this run: points change at day boundaries, and without this a link could be skipped or repeated while the owner pages.
15. **`decay_note` keeps its role, with new sentences.** Decided in this run, from package 05's goal that the owner can always see a link's state and why.

## Dependencies

- Package 05 (`decay_and_liveness`, active, all tasks done): superseded in its decay rules (dormant, sticky, archive by decay), its archive routes, its decay settings and its `decay_note` sentences. Its liveness checks are kept, with expired links skipped.
- Package 01 (`accounts_links_and_stream`, active, all tasks done): the stream's order and cursor, `recordUse`, and the re-paste.
- Package 02 (`fetch_and_snapshot`, active, all tasks done): the refresh fetch queued by archiving.
- Package 03 (`ai_enrichment`, active, all tasks done): the enrichment after that fetch, and its rule that the owner's edits win.
- Package 04 (`workspaces_and_notes`, active, all tasks done): workspace membership exempts a link from expiry, and archived members stay listed.
- Package 06 (`search_and_browse`, active, all tasks done): the `state:` filter values, the default exclusion, and the topic and tag searches.
- Package 08 (`mcp_server`, active, all tasks done): `archive_link` takes the new meaning.
- Package 09 (`export_and_account_deletion`, active, all tasks done): the export carries every link with its state, which now includes `expired` and the new `archived`.
- Packages 11 (`hybrid_search`) and 12 (`ask_the_library`), both sealed: archived links are now in their results by default, and expired links are left out.

## Glossary

- **points**: a link's standing: `start_points` plus its use count, minus the whole days since its last use or boost. They order the stream, and a link expires at 0. Archived links have none.
- **start points**: the owner's setting that a link's points start from and go back to (plus its use count) on a use or boost.
- **expired**: a link whose points reached 0. It is out of the stream, kept with its snapshot, and removed `remove_days` after it expired. This is what package 05 called "archived".
- **archived**: a link the owner chose to keep. It is refreshed once and kept indefinitely with its metadata and snapshot, outside decay. It is out of the stream, in search and Ask, and dimmed.
- **removed**: deleted for good by decay, with its snapshot.
- **use**: an open, a read, a snapshot view or an MCP open of a link. It adds 1 to the use count and resets the points.
- **boost**: setting a link's last use to now without a use: a re-paste, a restore or an unarchive.
- **restore**: bringing an expired link back to the stream as active.
- **unarchive**: bringing an archived link back to the stream as active.

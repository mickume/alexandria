---
spec_id: "13"
spec_name: "points_and_expiry"
title: "Rank links by points and let unused links expire"
status: "sealed"
created_at: "2026-11-09T14:40:05Z"
intent_hash: "6372253996e80295488123b068964b41cc39a69c76eee38e9653690658c00d2b"
schema_version: 3
source: "docs/prd/03-rank-links-by-points-and-keep-chosen-links-in-an-archive.md"
---

# Rank links by points and let unused links expire

## Intent

Give every link a single number, its points, which use raises and time lowers, so the stream puts first the links that are used most and most recently. A link the owner no longer uses expires when its points run out, and it is removed a fixed time later unless the owner uses it or restores it first. Package 05 called this holding area before removal the "archive". This package renames it "expired", which frees the word "archive" for links the owner chooses to keep for good.

## Goals

- Every link carries `points`, returned by the API and shown on its card. Points are the owner's start points plus the link's use count, minus the whole days since its last use or boost.
- A link whose points reach 0 or less, and that is neither pinned nor in a workspace, becomes `expired` within 24 hours. It leaves the stream and is listed on the Expired page with its removal date. It is removed `remove_days` after it expired, unless it is used or restored first.
- The stream and every search made of filters alone list pinned links first, in pin order, then every other link by points descending, then last use descending.
- After the change, every link that was `archived` is `expired` with the same removal date, and every link that was `dormant` is `active`.

## Non-goals

- The new `archived` state: links kept indefinitely, archiving with a refresh first, unarchiving, the Archive page with its new meaning, dimmed archived cards, archived links in search and Ask, and the MCP tool `archive_link` with its new meaning. These land in the next package, `keep_links_in_archive`, from the same PRD. Until then this package withdraws manual archiving: `POST /api/v1/links/{id}/archive`, `GET /api/v1/archive`, the card's Archive action and `archive_link` are removed.
- Weighting uses by their age, their kind (open, read or snapshot view) or their day. Every use counts 1.
- Stickiness and the `dormant` state: both are removed.
- A manual "expire" action. Delete removes a link at once.
- Notifications about links that expire or are removed.
- Recovering a removed link.
- Changing the ranking of searches with free words (keyword or hybrid).
- Liveness checks of expired links. Archived links weren't checked under package 05, and expired links aren't checked either.

## Background

Package 05 (`decay_and_liveness`) implements decay.

- `evaluateDecay` in `src/worker/decay/decay.ts` evaluates one user in one D1 batch transaction.
- `runScheduled` in `src/worker/decay/cron.ts` runs every hour and evaluates each user whose `last_decay_at` is 20 hours old or more.
- The evaluation makes an `active` link `dormant` after `dormant_days` without use (default 60).
- It makes any link that is not archived `archived` after `archive_days` (default 120), unless the link is sticky (`STICKY`: at least 5 uses on 5 distinct UTC days), pinned or in a workspace.
- It removes an archived link `remove_days` (default 180) after `archived_at`. Removal deletes the link's `link_uses`, `link_texts`, `link_passages`, `link_events`, `link_tags` and `workspace_links` rows and, after the transaction, its stored objects.
- `decayFields` in `src/worker/decay/note.ts` gives each link `sticky`, `removal_at` and `decay_note`, read from the `link_views` view (migration `0005_decay_and_liveness.sql`).

A link's state is one value: `pending`, `active`, `unreachable`, `dormant` or `archived`.

- Every use (an open, a read, a snapshot view, an MCP open) goes through `recordUse` in `src/worker/links/use.ts`. It adds 1 to `use_count`, sets `last_used_at` to now, writes a `link_uses` row and turns `dormant` into `active`.
- A re-paste (`addLinkStatement` in `src/worker/links/store.ts`) sets `last_used_at` to now and turns `dormant` into `active`.

`src/worker/decay/archive.ts` serves the archive:

- `GET /api/v1/archive` lists archived links;
- `POST /api/v1/links/{id}/archive` archives a link by hand;
- `POST /api/v1/links/{id}/restore` brings an archived link back as `active`, with `last_used_at` set to now.

The MCP tool `archive_link` (`src/worker/mcp/tools.ts`) calls the archive route.

The website:

- The Archive page (`src/web/pages/Archive.tsx`) lists archived links with Restore and Delete, and searches them with `state:archived`.
- `LinkCard` (`src/web/components/LinkCard.tsx`) has an Archive action. It dims dormant cards and shows their `decay_note`, and shows a "sticky" label.
- `DecaySection` (`src/web/pages/DecaySection.tsx`) edits the three thresholds through `GET`/`PUT /api/v1/settings/decay` (`src/worker/decay/routes.ts`).

Listing and search:

- `listStream` in `src/worker/links/stream.ts` lists pinned links by pin position, then the rest by `last_used_at` descending and id descending, with a keyset cursor `{s: 'u', l, i}`.
- `streamPage` in `src/worker/search/routes.ts` answers every search made of filters alone, the topic and tag searches included, through `listStream`.
- `filterConditions` in `src/worker/search/query.ts` leaves archived links out of every search, hybrid search and Ask included, unless a `state:` filter is given.
- `STATE_VALUES` lists the accepted `state:` values.
- The change feed (`listChanged`) leaves archived links out.

Liveness:

- `enqueueDueChecks` and `isCheckable` in `src/worker/decay/liveness.ts` skip archived links.
- `POST /api/v1/links/{id}/check` refuses an archived link with 409 `link_archived`.

## Requirements

### Points and settings

- A link's points are its user's `start_points`, plus its use count, minus the number of whole 24-hour periods between its last use or boost and now. Points can be negative. Every link the API returns carries `points` (an integer) and `expired_at` (a timestamp, or null). It no longer carries `sticky` or `archived_at`.
- A use (an open, a read, a snapshot view, an MCP open) adds 1 to the use count and sets the last use to now. A re-paste and a restore set the last use to now without adding a use.
- `GET /api/v1/settings/decay` answers `200 {"start_points": 60, "remove_days": 180}` with the owner's values (defaults shown).
- `PUT /api/v1/settings/decay` with both fields, each a whole number from 7 to 3650, stores them and answers `200` with the stored values.
  - A field missing, not a whole number, or outside 7 to 3650 is refused with `400 {"error": "invalid_threshold", "field": "<field>", "message": "<field> must be a whole number from 7 to 3650"}`, and nothing is stored.
- A change to `start_points` applies to every link of the owner at once, because points are always computed from the current setting.
- The Settings page's decay section shows two fields: "Start points", meaning "Points a link starts with and goes back to when used, plus one per use; it loses one a day", and "Remove after expiring (days)". A refusal is shown beside its field.

### Expiry

- The scheduled evaluation (hourly, each user at most once per 20 hours, in one transaction) makes a link `expired`, with `expired_at` set to the evaluation time, when all of these hold:
  - its points are 0 or below;
  - its state is `active`, `pending` or `unreachable`;
  - it is not pinned;
  - it is in no workspace.
- A pinned link, or a link in a workspace, keeps losing points but is never made expired.
- A link that the owner used or re-pasted after the evaluation began is left as that use left it.
- An evaluation that fails for a user changes none of that user's links. That user is evaluated again at the next hourly run.

### Removal

- The same evaluation removes every expired link that is neither pinned nor in a workspace and whose `expired_at` is at least `remove_days` before the evaluation time. Removal deletes everything package 05's removal deletes, the stored objects included. A link one day short of that is kept.
- Every expired link carries `removal_at`, equal to `expired_at` plus `remove_days`. Every other link carries `removal_at: null`.

### Expired links and restoring them

- An expired link is left out of the stream, the change feed, and every search, hybrid search and Ask without a `state:` filter.
- A use of an expired link, or a re-paste of its address, makes it `active` in the same request and clears `expired_at`.
- `GET /api/v1/expired` lists the owner's expired links, most recently expired first (id descending on ties), each with `expired_at` and `removal_at`. It is paged with `limit` (1 to 100, default 50) and `cursor`. An invalid `limit` or `cursor` is refused with 400 `invalid_limit` or `invalid_cursor`, as every paged route refuses them.
- `POST /api/v1/links/{id}/restore` makes an expired link `active`, clears `expired_at`, sets the last use to now, and answers `200 <link>`.
  - A link that is not expired gets `409 {"error": "not_expired", "message": "this link is not expired"}`, and nothing changes.
  - A missing link, or another user's, gets 404.
- The website's Expired page (`/expired`, a navigation entry named "Expired") lists expired links with their removal date, with Restore and Delete. Its search box is limited to `state:expired`. With no expired links it says "Nothing has expired."
- `POST /api/v1/links/{id}/check` on an expired link is refused with `409 {"error": "link_expired", "message": "expired links are not checked"}`. Weekly liveness checks skip expired links.

### Search filters and the withdrawn archive

- `state:` accepts `pending`, `active`, `unreachable`, `expired` and `any`. `state:dormant` and `state:archived` are refused with 400 `invalid_filter`, as any unknown filter value is. A search without a `state:` filter leaves expired links out. `state:expired` keeps only them, and `state:any` keeps every state.
- `POST /api/v1/links/{id}/archive` and `GET /api/v1/archive` answer 404. The MCP tool `archive_link` is no longer listed. Cards have no Archive action. The navigation has no Archive entry.

### Ordering

- The stream lists pinned links first, by pin position, then every other link it lists by points descending, then last use descending, then id descending.
- Example: with `start_points` 60, link A was used 10 times and last used 5 days ago, so it has 65 points. Link B was used once, today, so it has 61. A is listed above B.
- Every search made of filters alone, the topic and tag searches included, lists its links in the same order.
- The pages after the first are ordered by the points as of the time of the first page, so every link that does not change while the owner pages appears exactly once, even across a day boundary.
- A cursor that is not one this order issued is refused with 400 `invalid_cursor`.

### Decay note and link card

- `decay_note` says each link's standing in one sentence:
  - "42 points: expires in 42 days";
  - "pinned: never expires, -3 points";
  - "in a workspace: never expires, 12 points";
  - "expired on 2027-03-01, removed on 2027-08-28".
- Every card shows its `decay_note`. No card is dimmed for decay or shows a "sticky" label. "dead since <date>" and the struck-through title of a dead link stay.

### Changing existing data

- A migration makes every `archived` link `expired`, with `expired_at` set to its former `archived_at`, so its removal date does not change. It makes every `dormant` link `active`.
- Each user's `dormant_days` becomes their `start_points`. `remove_days` is kept, and `archive_days` is dropped.

### End-to-end flows

1. The owner's link is unused for longer than `start_points` days. After the next hourly run it is missing from the stream and listed on the Expired page with its removal date. The owner presses Restore. The link is back in the stream as `active`, and the Expired page says "Nothing has expired."
2. The owner has two links: one used 10 times, last used 5 days ago, and one used once, today. With `start_points` 60, the stream lists the first above the second, and each card shows its points.

## Design Decisions

1. **Package 05's "archived" is renamed "expired", with the same meaning.** This is the owner's decision.
2. **Points are `start_points` plus the use count, minus whole days since the last use or boost. They're computed, never stored.** This is the owner's decision. A settings change therefore applies to every link at once.
3. **Two settings: `start_points` (from `dormant_days`, default 60) and `remove_days` (default 180).** This is the owner's decision. A link is removed `remove_days` after it expired. `archive_days` is dropped.
4. **No `dormant` state and no stickiness. Pinned links and links in a workspace keep losing points but never expire.** This is the owner's decision.
5. **A use or a re-paste of an expired link reactivates it.** This is the owner's decision.
6. **Pending and unreachable links expire like active ones.** Decided in the PRD: package 05 archived them by decay too.
7. **Manual archiving is withdrawn in this package.** Decided in this run, splitting the PRD. Under the new meaning it would set a state this package does not yet have, and the owner chose not to have a manual "expire". The next package brings it back with its new meaning.
8. **Removal skips an expired link that is pinned or in a workspace.** Decided in this run: pinning an expired link or adding it to a workspace doesn't change its state today, and both exempt a link from expiry, so they exempt it from removal too.
9. **Stream paging is ordered as of the first page.** Decided in the PRD: points change at day boundaries, and without this a link could be skipped or repeated while the owner pages.
10. **`archived_at` and `sticky` leave the link's fields.** Decided in this run: no link is archived until the next package, which brings `archived_at` back with its new meaning.
11. **Profile: full.** Decided in this run: the flows cross the scheduler, the API and the website.

## Dependencies

- Package 05 (`decay_and_liveness`, active, all tasks done): superseded in its decay rules, archive, settings and decay notes. Its liveness checks are kept.
- Package 01 (`accounts_links_and_stream`, active, all tasks done): the stream's order and cursor, `recordUse` and the re-paste.
- Package 04 (`workspaces_and_notes`, active, all tasks done): workspace membership exempts a link from expiry and removal.
- Package 06 (`search_and_browse`, active, all tasks done): the `state:` filter values and the order of filter-only searches.
- Package 08 (`mcp_server`, active, all tasks done): `archive_link` is withdrawn.

## Glossary

- **points**: a link's standing: `start_points` plus its use count, minus the whole days since its last use or boost. They order the stream, and a link expires at 0.
- **start points**: the owner's setting that a link's points start from, and go back to (plus its use count) on a use or boost.
- **expired**: a link whose points reached 0. It is out of the stream, kept with its snapshot, and removed `remove_days` after it expired. Package 05 called this "archived".
- **removed**: deleted for good by decay, with its snapshot.
- **use**: an open, a read, a snapshot view or an MCP open of a link. It adds 1 to the use count.
- **boost**: setting a link's last use to now without a use: a re-paste or a restore.
- **restore**: bringing an expired link back to the stream as active.

---
spec_id: "05"
spec_name: "decay_and_liveness"
title: "Let unused links decay and mark dead links"
status: "active"
created_at: "2026-11-07T14:22:15Z"
intent_hash: "3fe632ad8ecd0d484da4219fa1bfd4ca3533a4680eb5047a916fd45be588f595"
schema_version: 3
source: "docs/prd/01-build-the-alexandria-link-library.md"
---

# Let unused links decay and mark dead links

## Intent

A library that only grows becomes the 600 open tabs it was meant to replace. This package lets links the owner does not use sink, leave the stream and finally go, while links that are used, pinned or placed in a workspace stay; it keeps every step visible and reversible until removal, so the owner always knows which state a link is in and why; and it checks every kept link's address weekly, so that a site that has gone is marked dead while its stored copy remains readable.

## Goals

- Every link the owner has not used sinks in the stream by last use, becomes dormant after a fixed period of non-use, is archived after a longer one and removed after a further fixed period, with the owner able to see at any time which state a link is in and why.
- Using a link resets its decay; a link used often enough becomes sticky and never decays; a pinned link and a link in a workspace are never archived by decay.
- The Archive page lists archived links with the date each will be removed, and each can be restored to the top of the stream or deleted.
- Dead links are detected by a weekly liveness check and marked as such in the stream, and a dead link's stored snapshot and reader view stay available.
- Decay and liveness evaluation runs at least once per day for every user; a link's shown state is never more than 24 hours stale.

## Non-goals

- Search on the Archive page (the source PRD's "the same search as the stream"), and the `state:archived`, `state:any` and `is:dead` filters: package 06 (`search_and_browse`) adds the search box to the Archive page.
- Fetching, snapshots, reader view, refresh and the per-host gate: package 02 (`fetch_and_snapshot`); this package sends its checks through package 02's outbound request path and per-host gate.
- The MCP tool `archive_link`: package 08 (`mcp_server`). Decay settings and archive state in the export: package 09 (`export_and_account_deletion`).
- Recovering a removed link: removal is permanent.
- Notifying the owner (email, push) about links that became dormant, archived, removed or dead.
- Checking archived, `pending` or `unreachable` links for liveness.

## Background

Package 01 (`accounts_links_and_stream`) stores links with `state`, `added_at`, `last_used_at`, `use_count` and `pin_position`, records every use in `link_uses` through `recordUse` in `src/worker/links/use.ts`, boosts a re-pasted link in `src/worker/links/store.ts`, already leaves `archived` links out of the stream (`src/worker/links/stream.ts`), and deletes a link with `DELETE /api/v1/links/{id}`. Package 02 (`fetch_and_snapshot`) fetches each link through one outbound request path in `src/worker/fetcher/` that checks every target and redirect for blocked addresses, spaces requests to each host at least 1 second apart through the `HOST_GATE` Durable Object, stores snapshots in R2 (`SNAPSHOTS`) and reader text in D1, deletes those objects with their link, and serves Read and Snapshot even when the origin is gone. Package 04 (`workspaces_and_notes`) stores workspace membership in `workspace_links`. Nothing decays and nothing is checked after the first fetch yet; there is no Cron Trigger, no Archive page and no `dormant` or `archived` link is ever produced. Every component this package names under `src/worker/decay/` and the Archive page are new.

## Requirements

### The stream: decay, sticky, archive

- **Decay**: a link not used for 60 days becomes `dormant`: still in the stream, shown dimmed, with "unused for 2 months". A link not used for 120 days is **archived** automatically: it leaves the stream, keeps its snapshot, and is listed on the Archive page with the date it will be removed. A link archived for a further 180 days (300 days unused in total) is **removed**: deleted permanently with its snapshot. Thresholds are per user settings with these defaults, each between 7 and 3650 days.
- **Use**: using a link resets its decay.
- **Sticky**: a link with at least 5 uses on at least 5 distinct days is sticky: it never becomes dormant or archived by decay; the stream marks it. A pinned link and a link that belongs to at least one workspace are likewise never archived by decay (they can become dormant and show as such). Manual archive and manual delete always work regardless.
- **Archive page**: lists archived links newest-archived first; each can be **restored** (back to `active`, last used = now) or deleted. Removal by decay runs once a day; a link restored before that is kept.
- Decay and liveness evaluation runs at least once per day for every user; a link's shown state is never more than 24 hours stale.

### Liveness

- Every `active`, `dormant` and pinned link is re-checked every 7 days: HEAD then GET on failure, 10-second timeout, at most 5 redirects, never more than 1 request per second per host. A check passes on HTTP 2xx or 3xx (ending in 2xx). A link that fails 3 consecutive weekly checks is marked **dead** with the last status or error, shown in the stream with a strike-through title and "dead since <date>"; its snapshot and reader view remain available. A dead link that passes a later check is cleared automatically. The user can trigger a check for one link on demand (the same 10-minute limit as refresh).
- Archived links are not checked. A dead link follows the normal decay rules; being dead does not itself archive or remove it.
- If the liveness run cannot complete for a user (platform limit, outage) the links keep their previous state and are checked on the next run; nothing is marked dead on the strength of a failed run.

### HTTP API and website

- Archive, restore, the archive list, the on-demand check and the decay settings are authenticated JSON routes under `/api/v1/`, with package 01's error envelope; a request for another user's link gets 404.
- The settings page gains the three decay thresholds.
- End-to-end flows the system must support unbroken:
  1. A link unused for 120 days disappears from the stream and appears on the Archive page with its removal date; the owner restores it; it is back at the top of the stream.
  2. A site goes offline; after three weekly failed checks its card is struck through with "dead since <date>"; "Read" still shows the stored article.

## Design Decisions

1. **Decay is driven solely by last use** (plus the sticky, pin and workspace exemptions), not by a computed score, so the owner can always see why a link is where it is. (Source PRD decision 4.)
2. **Decay thresholds**: dormant at 60 days, archived at 120, removed 180 days after archiving; sticky at 5 uses on 5 distinct days. Owner's decision (source PRD decision 7); every threshold is a per-user setting from 7 to 3650 days.
3. **The dormant threshold must be below the archive threshold**; a setting that breaks this is refused with 400 `invalid_thresholds`. Decided in this run: otherwise a link would skip dormancy and the settings would contradict themselves.
4. **Only an `active` link becomes `dormant`.** A `pending` or `unreachable` link keeps its state while it ages and is archived by decay like any other; a dormant link that is used, re-pasted or restored becomes `active` at once, in the request that boosted it. Decided in this run: `dormant` replaces `active` in the single state column, and an unreachable link's reason is worth more than a dimmed card.
5. **"Distinct days" are UTC calendar days** of the stored use events. Decided in this run: a fixed time zone makes stickiness the same for every reader of the data.
6. **The scheduler runs every hour** (Cron Trigger `0 * * * *`). Each run evaluates decay, removal included, for every user whose last completed evaluation started 20 hours or more ago, and enqueues the liveness checks that are due. Decided in this run: an hourly run keeps every state within 24 hours even when one run fails, and evaluation is set-based SQL per user, so a user of 20,000 links costs a handful of statements.
7. **Liveness checks run on their own Cloudflare Queue, `LIVENESS_QUEUE`.** A link is due when 7 days have passed since its last check (or, never checked, since it was added) and no check of it was enqueued in the last 6 hours; a message that is lost or fails for Alexandria's own reasons is therefore enqueued again by a later run. Decided in this run.
8. **A check's failure is an origin failure only**: a DNS, connection, TLS or timeout error, a blocked redirect, more than 5 redirects, or a final status that is not 2xx. An error of Alexandria's own (the queue consumer failing, the per-host gate unavailable, a platform limit) is a failed run: it changes nothing on the link. Decided in this run, from the source PRD's "nothing is marked dead on the strength of a failed run".
9. **HEAD is retried as GET** when HEAD fails in any way, the GET reading at most the response headers; the GET's outcome is the check's. Decided in this run, from the source PRD's "HEAD then GET on failure".
10. **An on-demand check counts only when it passes.** A pass clears `dead` and the failure count; a failure is shown and stored as the last result but does not add to the consecutive weekly failures, so three quick clicks cannot kill a link. Decided in this run, from the source PRD's "3 consecutive weekly checks".
11. **The on-demand check answers synchronously and is limited to one per link per 10 minutes**, a second answering 429 `checked_recently` with `Retry-After`, as package 02's refresh does. Checking an archived link is refused with 409 `link_archived`. Decided in this run.
12. **Archiving a pinned link unpins it**, closing the gap in the pin positions; workspace memberships are kept. Restoring does not re-pin. Decided in this run: the pinned section is part of the stream, which an archived link leaves.
13. **Restoring is a boost, not a use**: last used becomes now and the use count is unchanged, as for a re-paste in package 01. Restoring a link that is not archived is refused with 409 `not_archived`; archiving an archived link answers 200 and changes nothing. Decided in this run.
14. **Every link carries `decay_note`**, one sentence saying its state and why ("unused for 63 days", "sticky: 7 uses on 6 days, never archived", "pinned: never archived", "in a workspace: never archived", "archived on 2027-03-01, removed on 2027-08-28"). Decided in this run, to meet the goal "able to see at any time which state a link is in and why".
15. **"Unused for N" reads in days below 60 days and in whole months of 30 days from 60 days**, so the default dormant link reads "unused for 2 months". Decided in this run.
16. **Liveness checks go through package 02's outbound request path**, with its blocked-address checks, its `ORIGIN_PROXY_URL` test seam and its `HOST_GATE`, so fetches and checks share one per-host spacing. Decided in this run.

## Dependencies

- Package 01 (`accounts_links_and_stream`): links, `recordUse`, the boost on re-paste, the stream's exclusion of archived links, link deletion, the error envelope, cursors, the OpenAPI document, the Settings page, `LinkCard` and the shared test helpers.
- Package 02 (`fetch_and_snapshot`): the outbound request path, `HOST_GATE`, the snapshot objects deleted with a link, the Read view that works when the origin is gone, and `e2e/fake-origin.ts`.
- Package 04 (`workspaces_and_notes`): workspace membership, which exempts a link from archiving by decay.

## Verified External API

Read from the published packages on 2026-11-07:

- `hono` 4.13.17: `class Hono<E, S, BasePath>`.
- `@cloudflare/vitest-pool-workers` 0.23.0: `env` and `SELF: Fetcher` from `cloudflare:test`, used to drive the scheduled and queue handlers in tests.
- The Workers runtime's `scheduled(controller, env, ctx)` and `queue(batch, env, ctx)` handlers and the Queue binding's `send`/`sendBatch` come from `@cloudflare/workers-types` 5.20261107.1 (no signature read; `af-impl` confirms them before use).

## Glossary

- **use**: an open, read or snapshot view of a link, recorded with a timestamp; the unit decay is measured against.
- **boost**: resetting a link's last use to now (what a use, a re-paste or a restore does).
- **decay**: the progression active → dormant → archived → removed, by days since last use.
- **dormant**: an active link unused for longer than the dormant threshold, shown dimmed.
- **archived**: a link out of the stream, retained with its snapshot, scheduled for removal.
- **removed**: deleted permanently with its snapshot by decay.
- **sticky**: a link with at least 5 uses on at least 5 distinct days, which decay no longer makes dormant or archives.
- **dead**: a link whose URL has failed three consecutive weekly liveness checks.
- **liveness check**: a HEAD (then GET) request to a link's URL that passes on a final 2xx status.
- **failed run**: a scheduled evaluation or check that did not complete for Alexandria's own reasons; it changes no link.

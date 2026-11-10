---
spec_id: "18"
spec_name: "show_library_statistics"
title: "Show the owner statistics about their library and its background work"
status: "active"
created_at: "2026-11-10T12:30:00Z"
intent_hash: "680d3a878add6db3154bedf62909e5f1586f44d65f4f7dc01eb34db9bfdc832d"
schema_version: 3
source: "docs/prd/05-show-library-statistics.md"
---

# Show the owner statistics about their library and its background work

## Intent

An owner of an Alexandria library cannot see their library as a whole: how many links it holds in each state, how its topics and tags are spread, how many links are about to expire or be removed, and whether background work (fetching, enrichment, imports, indexing, liveness checks) is keeping up or stuck. Each page shows one slice. This package adds a Stats page and an API that compute these numbers from what the library already stores, so the owner can see the whole library and its background work in one place.

## Goals

- `GET /api/v1/stats` returns, in one response, the owner's library totals and breakdowns, expiry outlook, health, background backlog and the last 30 days of activity, all computed when the request is made.
- A new **Stats** page at `/stats`, with its own tab in the navigation, shows every number from `GET /api/v1/stats`, with the daily series drawn as bar charts.
- Every count on the page matches what the owner would get by counting on the page that lists those links. For example, the expired count equals the number of links on the Expired page.

## Non-goals

- Stage 2 of PRD `docs/prd/05-show-library-statistics.md`: the daily record of events (added, used, expired, removed, deleted, archived, unarchived, restored links, fetch and enrichment outcomes, Ask questions), the end-of-day library size, AI token usage, `GET /api/v1/stats/history` and the Trends section. They land in package `19_record_daily_activity`.
- Statistics across owners, or an operator view of the whole deployment (queue depths reported by Cloudflare, Worker errors, CPU time). Those belong in Cloudflare's dashboard and Workers observability, which is already enabled.
- Cloudflare Queue depth as Cloudflare reports it. The Worker cannot read it. The backlog shown is what the database says is waiting.
- How long a link takes to go from being added to being fetched, enriched and indexed. A later PRD can add this.
- Statistics in the MCP server's tools, and in the export.
- Choosing a time zone. Every day is a UTC day.
- Alerts or notifications when a number crosses a threshold.

## Background

Nothing in Alexandria counts or summarises the library today. The facts the statistics are computed from already exist:

- **Links** (`links`, `migrations/0001_accounts_and_links.sql` onwards). Each link has `state` (`pending`, `active`, `unreachable`, `expired`, `archived`), `added_at`, `last_used_at`, `use_count`, `pin_position`, `host`, `content_kind`, `has_snapshot`, `reader_empty`, `fetch_attempts`, `state_reason`, `enrichment_status` (`no_key`, `queued`, `enriched`, `failed`, `skipped`, `waiting_for_key`, or null before the first fetch), `enrichment_reason`, `topic_id`, `expired_at`, `archived_at`, `dead_since`, `liveness_failures`, `last_checked_at` and `check_enqueued_at`. A library holds at most 20,000 links.
- **Points and expiry** (`src/worker/decay/note.ts`, `pointsAt`). Points are never stored. They are computed as the owner's `start_points` plus `use_count`, minus whole days since `last_used_at`. The hourly decay run (`src/worker/decay/cron.ts`, `decay.ts`) evaluates each owner about once every 20 hours. It expires active, pending and unreachable links that are at 0 points or below and neither pinned nor in a workspace. It also removes expired links, again neither pinned nor in a workspace, whose `expired_at` is `remove_days` or more in the past. `removal_at` is `expired_at` plus `remove_days`.
- **Topics and tags** (`topics` with `parent_id`, at most three levels; `tags`, `link_tags`). `GET /api/v1/topics` already returns each topic's `count` and `subtree_count`.
- **Workspaces** (`workspaces`, `workspace_links`).
- **History.** `link_uses` holds one row per use, and `link_events` one row per fetch attempt (`kind` `fetch`, `outcome` `ok` or `failed`, `reason`), written by `src/worker/fetcher/queue.ts` and `src/worker/decay/archive.ts`. `GET /api/v1/links/{id}/history` reads both. Liveness checks write no event; only the link's latest result is kept (`last_check_result`). Both tables are deleted with their link (`ON DELETE CASCADE`). So once decay or the owner removes a link, its uses and fetches are no longer counted anywhere, and nothing records that the link expired or was removed.
- **Background work.** Five queues (`alexandria-fetch`, `-enrich`, `-liveness`, `-account`, `-index`, in `wrangler.jsonc`). Background jobs go through a per-owner throttle (`src/worker/enrich/throttle.ts`) that spaces them 3 seconds apart: `users.throttle_next_at` is the owner's next free slot, and `users.import_window_end` is how long an import dispatch keeps the budget. Imports (`imports`, `import_links` with `dispatched_at`) are sent to the fetch worker at most 20 links a minute. `GET /api/v1/imports/{id}` already reports `progress` as waiting, in progress, done and enriched. The meaning index (`link_index_state.text_version`, `link_passages`) treats a link as stale when none of its passages carries its current version. Vectors waiting to be deleted are rows of `vector_deletions`. A liveness check is due for a link that is not expired or archived, is active or pinned, was last checked (or, if never checked, added) 7 or more days ago, and has not been enqueued in the last 6 hours (`src/worker/decay/liveness.ts`).
- **Website.** Pages live in `src/web/pages/` and are routed in `src/web/App.tsx`. The tabs come from `SECTIONS`: Stream, Workspaces, Topics, Tags, Ask, Expired, Archive, Settings. The design language (`src/design/`, Quire) has boxes, tables (`q-table`, `q-table-number`), counters, labels and a progress bar (`q-progress`), but no chart component.
- **Account deletion** (`src/worker/account/deletion.ts`) finds a user's rows in every table that has a `user_id` or `link_id` column, and deletes them.
- **Checks.** `make check` (format, `tsc --noEmit`, ESLint and Prettier, Vitest), and `make e2e` (Playwright against `wrangler dev`).

## Requirements

### Library statistics

`GET /api/v1/stats` answers `200` with a JSON object. Each section below is one key of that object. Every count covers only the signed-in owner's links. A link counts in every group it belongs to, unless a group says otherwise.

- `library`:
  - `total`: every link in the library, in any state.
  - `by_state`: the number of links in each state, `pending`, `active`, `unreachable`, `expired` and `archived`, every key present even when 0. The values add up to `total`.
  - `pinned`: links with a pin position.
  - `in_workspace`: links in at least one workspace.
  - `limit`: 20,000, the most links a library holds.
- `content`:
  - `by_kind`: the number of links whose `content_kind` is `html`, `pdf` or `other`, plus `unfetched` for null.
  - `with_snapshot`: links with a snapshot.
  - `reader_empty`: links whose reader view has no text.
- `topics`:
  - `total`: every topic.
  - `by_level`: topics at levels 1, 2 and 3, as `{"1": n, "2": n, "3": n}`.
  - `links_without_topic`: links with no topic.
  - `largest`: the 10 topics with the most links filed directly under them, each as `{"id", "name", "path", "count"}`, where `path` is the topic's names from the top level down. Ties are broken by name, A to Z.
- `tags`:
  - `total`: every tag.
  - `used_once`: tags on exactly one link.
  - `links_without_tags`: links with no tag.
  - `top`: the 10 tags on the most links, each as `{"id", "name", "count"}`, ties broken by name.
- `workspaces`: `total`, and `largest`, the 10 workspaces with the most links, each as `{"id", "name", "count"}`, ties broken by name.
- `hosts`: `distinct`, the number of distinct hosts, and `top`, the 10 hosts with the most links, each as `{"host", "count"}`, ties broken by host.

An owner with no links gets every count at 0 and every list empty. The website shows each list section's empty state, such as "No topics yet".

### Expiry outlook

Points are computed at the time of the request, as `pointsAt` computes them for a link the API returns. "Unprotected" means a link in state `active`, `pending` or `unreachable` that is neither pinned nor in a workspace: one that decay can expire.

- `expiry.expiring`: the unprotected links at 0 points or below, at 1 to 7 points, and at 8 to 30 points, as `{"today": n, "within_7_days": n, "within_30_days": n}`. The buckets do not overlap, and each one's label matches the link's `decay_note`. "Today" means at the next decay run.
- `expiry.points_histogram`: the unprotected links in the point ranges `≤0`, `1–7`, `8–30`, `31–60`, `61–90` and `>90`, as an ordered list of `{"range", "count"}` with every range present.
- `expiry.protected_at_risk`: links that are pinned or in a workspace, are not archived or expired, and are at 0 points or below. These are links that would expire if they were not protected.
- `expiry.awaiting_removal`: expired links that are neither pinned nor in a workspace (those decay will remove), as `{"total", "within_7_days", "within_30_days"}`. The last two count links whose `removal_at` falls within 7 and 30 days of the request, cumulatively. A `removal_at` already past counts in both.
- `expiry.settings`: the owner's `start_points` and `remove_days`, so the page can say what the numbers depend on.

### Health

- `health.unreachable`: links in state `unreachable`, plus `by_reason`, the 5 most common `state_reason` values with their counts, ties broken by reason.
- `health.dead`: links with one or more consecutive failed liveness checks (`liveness_failures > 0`), plus `dead_over_30_days`, those whose `dead_since` is 30 or more days in the past.
- `health.enrichment`: the number of links in each enrichment status (`no_key`, `queued`, `enriched`, `failed`, `skipped`, `waiting_for_key`, and `none` for null), every key present. Also `failed_by_reason`, the 5 most common `enrichment_reason` values among failed links, with their counts.
- `health.ai_key`: the owner's AI key status, `none`, `verified` or `rejected`, so that a backlog of `waiting_for_key` links can be explained.

### Background backlog

- `backlog.fetch_pending`: links in state `pending`. `backlog.fetch_retrying`: of those, links with one or more failed attempts.
- `backlog.enrichment_queued`: links whose enrichment status is `queued`.
- `backlog.imports`: the owner's imports that still have links waiting or in progress, each as `{"id", "created_at", "added", "waiting", "in_progress", "done"}`, the same numbers `GET /api/v1/imports/{id}` reports, newest first, at most 10.
- `backlog.index_stale`: links whose meaning index is stale.
- `backlog.vector_deletions`: the owner's vectors waiting to be deleted.
- `backlog.liveness_due`: links due a weekly liveness check now, as `src/worker/decay/liveness.ts` selects them.
- `backlog.throttle_clear_at`: when the owner's background throttle frees up, the later of `throttle_next_at` and `import_window_end`, as an ISO 8601 time. It is null when that time has passed. The page shows it as "background work clears in about 12 minutes".

### Activity from history

Days are UTC days. A series covers the last 30 days, today included, oldest first, with a row for every day, including days with 0. These numbers come from the links still in the library. The page says so under each series: "counts only links still in your library".

- `activity.added_per_day`: links added on each day.
- `activity.uses_per_day`: uses recorded on each day.
- `activity.added_last_7_days` and `activity.added_last_30_days`.
- `activity.most_used`: the 10 links with the most uses in the last 30 days, each as `{"id", "title", "host", "uses"}`, ties broken by most recent use.
- `activity.never_used`: links with no use at all (`use_count` 0).
- `activity.fetches`: over the last 30 days, `ok` and `failed` fetch attempts, and `failed_by_reason`, the 5 most common reasons.
- `activity.imports`: the owner's last 10 imports, newest first, each as `{"id", "created_at", "url_lines", "added", "duplicates", "invalid", "not_imported"}`.

### The stats API's behaviour

- `GET /api/v1/stats` takes no parameters. A query parameter is ignored.
- It authenticates and rate-limits like every other route. With no valid session or token it answers `401 {"error": "unauthorized"}`.
- It is read-only: it changes no link, user, or row of any table.
- It is described in `GET /api/v1/openapi.json` and documented in `docs/api.md`.
- For a library at the 20,000-link limit, with 20,000 uses and 20,000 fetch events in the last 30 days, it answers within 2 seconds in the Worker tests.
- A failure while computing any section answers `500 {"error": "internal"}`. There is no partial result.

### The Stats page

- A tab **Stats** sits in the navigation between Archive and Settings, with its own icon. It opens `/stats`. The breadcrumb reads "Stats".
- The page loads `GET /api/v1/stats` once when it opens and shows a spinner until the answer arrives. A **Refresh** button loads it again. The page never reloads by itself.
- The page has these sections, in this order: Library, Expiry, Background work, Health, Activity.
- Every count links to the page that lists those links, where one exists:
  - an expired count to `/expired`, and an archived count to `/archive`;
  - a topic to its `topic:` search, and a tag to its `tag:` search;
  - a workspace to its page, and an import to its downloadable report (`GET /api/v1/imports/{id}/report`), because the Import page shows only the import just made;
  - a most-used link to its detail page.
- Each daily series is a bar chart, one bar per day, with that day's date and count in its tooltip. Each chart also has a table of the same numbers that screen readers can read. The points histogram is a bar chart too.
- When the request fails, the page shows "Couldn't load statistics" and a **Try again** button, in the same error style as the other pages.
- Constraint: the charts are drawn with the website's own code and the Quire design tokens. No charting library is added.

### End-to-end flows

1. The owner adds three links through the website and opens Stats. The Library section shows 3 links, all pending until the fake origin answers. After the fetch, 3 are active, and today's bar in "added per day" reads 3.
2. The owner sets their start points so that a link is at 0 points. Stats shows 1 link under "expires today". After the decay run it shows 1 expired, and the expired count opens the Expired page, which lists that link.
3. The owner imports a file of 50 URLs. While it dispatches, Background work shows the import with links waiting, and the time until background work clears. When the import finishes, the import leaves the backlog and appears in Activity's import history.

## Design Decisions

1. **A separate Stats page, not a section of Settings.** The owner's decision.
2. **The PRD's two stages are two packages.** Decided with the owner when the package was written: stage 1 needs no schema change and is useful on its own; stage 2 is package 19.
3. **One `GET /api/v1/stats` call, computed live.** Stage 1 reads only what is already stored, so it has nothing to keep in step. One call means one spinner and one consistent moment for every number.
4. **The backlog is what the database says is waiting, not the queues' depth.** The Worker cannot read a Cloudflare Queue's depth. Every queue has a database state that says a link is waiting.
5. **UTC days.** Every stored time is UTC, and the owner has no time zone setting.
6. **Activity says it counts only links still in the library.** Otherwise the owner would read a decay removal as a missing addition.
7. **No charting library.** Quire has no chart component. Daily bars and a histogram are simple enough to draw with the website's own code.
8. **The page reloads only when asked.** The owner's decision.
9. **Tab between Archive and Settings.** The owner's decision.
10. **2 seconds at 20,000 links.** Every section is a count over the owner's indexed rows, and 2 seconds leaves room for D1's latency in a single request.
11. **The import backlog uses the import's own progress.** Decided when the package was written: `backlog.imports` reports the same `waiting`, `in_progress` and `done` that `GET /api/v1/imports/{id}` reports, so the two pages never disagree.
12. **Liveness due uses the hourly run's own selection.** Decided when the package was written: `backlog.liveness_due` counts the links the next hourly run would enqueue, by the same conditions.

## Dependencies

- `05_decay_and_liveness` (active): the expiry, removal and liveness rules the statistics count.
- `13_points_and_expiry` (sealed): points, as `pointsAt` computes them.
- `14_keep_links_in_archive` (active): the archived state.
- `03_ai_enrichment` (active): enrichment statuses, the AI key status and the throttle.
- `07_bulk_import` (active): imports and their progress.
- `10_meaning_index` (sealed): the stale-index rule.
- `15_topic_tree` (sealed): topic levels and paths.

## Glossary

- **unprotected link**: a link in state `active`, `pending` or `unreachable` that is neither pinned nor in a workspace, which decay can expire.
- **protected at risk**: a pinned link, or one in a workspace, at 0 points or below, which would expire if it were not protected.
- **backlog**: the links and vectors that the database records as waiting for background work: a fetch, an enrichment, an import dispatch, indexing, vector deletion or a liveness check.
- **throttle**: the per-owner spacing of background jobs, 3 seconds apart, and the import budget of 20 links a minute.

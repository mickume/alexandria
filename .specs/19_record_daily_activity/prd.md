---
spec_id: "19"
spec_name: "record_daily_activity"
title: "Record what happens in a library each day and show it as trends"
status: "active"
created_at: "2026-11-10T13:20:00Z"
intent_hash: "350d0dc68ec1212f7b69e220dc66f5d008ce8ed6015ac4d284ce87fe72615290"
schema_version: 3
source: "docs/prd/05-show-library-statistics.md"
---

# Record what happens in a library each day and show it as trends

## Intent

Some numbers about an Alexandria library are recorded nowhere: when decay removes a link, its uses and fetch history are deleted with it, and nothing records that it expired or was removed; nothing records the library's size over time or the tokens the owner's AI key spent. This package records, per owner and per UTC day, how many events of each kind happened in the library, the library's size at the end of the day, and the AI token usage of the owner's provider calls, and shows them as trends on the Stats page, so that the owner can see how the library and its costs change over time even after the links concerned are gone.

## Goals

- From the day this package is deployed, the Worker records per owner and per UTC day how many links were added, used, expired, removed by decay, deleted by the owner, archived, unarchived and restored, how many fetches succeeded and failed, how many enrichments succeeded and failed, and how many Ask questions were asked. A count stays the same when the link it counted is later deleted.
- The Worker records the library's size in each state at the end of each UTC day, and the tokens each call to the owner's AI provider used, as the provider reports them, by purpose and model.
- `GET /api/v1/stats/history` returns those daily records for up to the last 365 days, and the Stats page shows them in a Trends section.

## Non-goals

- Stage 1 of PRD `docs/prd/05-show-library-statistics.md`: `GET /api/v1/stats` and the Stats page with its live sections. They are package `18_show_library_statistics`, which this package extends.
- Statistics across owners, or an operator view of the whole deployment (queue depths reported by Cloudflare, Worker errors, CPU time). Those belong in Cloudflare's dashboard and Workers observability, which is already enabled.
- Cloudflare Queue depth as Cloudflare reports it. The Worker cannot read it. The backlog shown is what the database says is waiting.
- How long a link takes to go from being added to being fetched, enriched and indexed. A later PRD can add this.
- Counting searches. The header search box sends a keyword search 200 ms after typing stops, so a count of search requests would not count what the owner does. Ask questions are counted.
- Turning token usage into money. Prices differ by provider and model and change over time. The page shows tokens, not costs.
- Token usage of the account's Workers AI embeddings. The binding reports none, and it is billed to the deployment, not to the owner's key.
- Statistics in the MCP server's tools, and in the export.
- Choosing a time zone. Every day is a UTC day.
- Recovering events from before this package is deployed. The daily record starts on the day it is deployed.
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
- **AI provider calls** (`src/worker/enrich/providers.ts`). Every call to the owner's provider goes through this file: `testKey` (checking a key), `enrichWith` (enrichment), `splitWith` (splitting a topic) and `streamAnswer` (Ask). Each goes through Anthropic's SDK (`@anthropic-ai/sdk` 1.6.0) or OpenRouter's chat completions HTTP API, with the owner's `ai_provider` and `ai_model`. No call records the token usage the provider returns.
- **The Stats page** (package `18_show_library_statistics`): `GET /api/v1/stats` (`src/worker/stats/`) and the page `src/web/pages/Stats.tsx`, with the sections Library, Expiry, Background work, Health and Activity, all computed live.
- **Where the counted events are written.** A new link is inserted by `addStatement` in `src/worker/links/store.ts` (pasting, the API, the MCP server's `add_link`) and by `importLines` in `src/worker/imports/imports.ts`. The same statement turns a re-paste of an expired link back to active. A use is recorded by `recordUse` (`src/worker/links/use.ts`), which also brings an expired link back. `POST /api/v1/links/{id}/restore` restores an expired link, and `POST .../archive` and `.../unarchive` (`src/worker/decay/archive.ts`) archive and unarchive one. `deleteLink` (`src/worker/links/store.ts`) deletes one. Decay's expiry and removal statements run in one batch in `evaluateDecay` (`src/worker/decay/decay.ts`). A fetch attempt's event is written by `eventStatement` (`src/worker/fetcher/queue.ts`) and by the archive refresh. `storeEnrichment` and `recordFailedEnrichment` (`src/worker/enrich/queue.ts`) store an enrichment's result or failure. Ask is `askRoutes` in `src/worker/meaning/ask.ts`. The hourly run is `runScheduled` in `src/worker/decay/cron.ts`.
- **Account deletion** (`src/worker/account/deletion.ts`) finds a user's rows in every table that has a `user_id` or `link_id` column, and deletes them.
- **Checks.** `make check` (format, `tsc --noEmit`, ESLint and Prettier, Vitest), and `make e2e` (Playwright against `wrangler dev`).

## Requirements

### Recording daily activity

From the day this package is deployed, the Worker keeps, per owner and per UTC day, these counters. Each event is counted on the UTC day it happens:

- `added`: links added, by pasting, the API, the MCP server or an import.
- `used`: uses recorded.
- `expired`: links that decay made expired.
- `removed`: links that decay removed.
- `deleted`: links the owner deleted (`DELETE /api/v1/links/{id}`).
- `archived`, `unarchived` and `restored`: links archived, unarchived, and brought back from expired by a use or a re-paste.
- `fetch_ok` and `fetch_failed`: fetch attempts and their outcome, as `link_events` records them.
- `enriched` and `enrichment_failed`: enrichments that stored a result, and ones that ended `failed`.
- `asks`: Ask questions the owner sent (`POST /api/v1/ask`), whether or not the provider answered.

Rules:
- An event is counted exactly when its change is stored. An event whose change fails or is rolled back is not counted, and a stored event is never missed or counted twice, including when a queue message is retried.
- A counter never goes down. Deleting a link, restoring it or deleting its history leaves every day's counters as they were.
- Deleting the account deletes its daily records with everything else.
- The library's size at the end of each UTC day: the total, and the count in each state. The first hourly run after midnight UTC records it for the day that just ended. When no run happens between 00:00 and 01:00 UTC, that day's size is not recorded and reads as null. It is never filled in later from other data.
- A recorded day on which nothing happened reads as 0 for every counter.

### Recording AI token usage

- Every call to the owner's AI provider is recorded on the UTC day it ends, under its purpose and model. The purposes are `enrich`, `split`, `ask` and `key_test`, and the model is the `ai_model` the call used. Each record holds:
  - `calls`, the number of calls;
  - `input_tokens` and `output_tokens`, the sums of what the provider reported;
  - `calls_without_usage`, the calls whose answer reported no usage. These are mostly failures and timeouts, and add nothing to the token sums.
- From Anthropic, the tokens are the answer's `usage.input_tokens`, plus `cache_creation_input_tokens` and `cache_read_input_tokens` when present, and `usage.output_tokens`. For Ask's streamed answer they come from the final message. From OpenRouter, they are `usage.prompt_tokens` and `usage.completion_tokens`.
- A call is recorded whether it succeeded or failed. A retried enrichment is recorded once per call made.
- Recording usage never changes the call's outcome. When the record cannot be written, the call's result is kept, and the usage of that call is lost.

### Trends

- `GET /api/v1/stats/history?days=N` answers `200 {"recorded_since": <date or null>, "days": [...]}`. Each entry of `days` is `{"day": "YYYY-MM-DD", "added", "used", "expired", "removed", "deleted", "archived", "unarchived", "restored", "fetch_ok", "fetch_failed", "enriched", "enrichment_failed", "asks", "size": {"total", "pending", "active", "unreachable", "expired", "archived"} or null, "ai": [{"purpose", "model", "calls", "input_tokens", "output_tokens", "calls_without_usage"}]}`, one per UTC day from N−1 days ago to today, oldest first, with every day present.
  - `days` is an integer from 1 to 365, with a default of 30. Any other value answers `400 {"error": "invalid_days", "field": "days", "message": "days is a whole number from 1 to 365"}`.
  - `recorded_since` is the first day recorded for this owner, or null when nothing has been recorded yet. A day before it has every counter null, not 0, so that "not recorded" and "nothing happened" can be told apart.
  - It authenticates and rate-limits like every route, and is described in the OpenAPI document and `docs/api.md`.
- The Stats page gains a **Trends** section. It has a range picker for the last 7, 30, 90 or 365 days, defaulting to 30, and shows:
  - added against removed, expired and deleted per day, as one chart;
  - uses per day;
  - fetch success rate per day;
  - enrichments per day, and Ask questions per day;
  - the library's size per day, as a line per state;
  - AI tokens per day, input and output, as stacked bars. Below it, a table of the range's totals by purpose and model.
  - Days before `recorded_since` are shown as a hatched or empty area labelled "not recorded yet".
- The Activity section's charts of package 18 for added and used keep using the live tables. The Trends section is the only one that counts links that are no longer in the library, and its caption says so: "includes links that have since been removed".

### End-to-end flows

1. A link expires and decay later removes it. Stats → Trends shows 1 expired and 1 removed on their days, and still shows them after the link is gone.
2. With the fake AI provider, the owner saves a key, adds a link that is then enriched, and asks one question. Stats → Trends shows today's AI usage: one `key_test`, one `enrich` and one `ask` call under the owner's model, with the tokens the fake provider reported.
3. The hourly run after midnight UTC records the library's size for the day that just ended, and `GET /api/v1/stats/history` returns it on that day.

## Design Decisions

1. **The PRD's two stages are two packages.** Decided with the owner when the packages were written: this one is stage 2 and builds on package 18.
2. **Counters, not an event log.** A day's counters are small and bounded, at most 365 rows per owner per year. A log of every event grows with use, and the statistics only need the counts.
3. **An event is counted with the change it counts.** Then the count cannot drift from what happened, and a failed or retried job is counted exactly once.
4. **Searches are not counted; Ask questions are.** The owner's decision. The search box searches as the owner types, so a request count would mislead.
5. **The library's size is recorded once a day.** The owner's decision. A size-over-time line cannot be rebuilt from added minus removed, because restores, archives and state changes move links between states without adding or removing any.
6. **Token usage is recorded by purpose and model, as tokens only.** The owner asked for token usage. Purpose and model are what explain a total, and an owner who changes models sees both. Costs are left out because prices change.
7. **UTC days.** Every stored time is UTC, and the owner has no time zone setting.
8. **`added` counts new links only.** Decided when the package was written: a re-paste of a link already in the library adds nothing, and an import counts each link it added.
9. **`restored` counts every way an expired link comes back.** Decided when the package was written: a use, a re-paste, and `POST /api/v1/links/{id}/restore`.
10. **`deleted` counts only the owner's `DELETE /api/v1/links/{id}`.** Decided when the package was written: an account deletion removes the daily records too, so it has nothing to count into.
11. **`enriched` and `enrichment_failed` count each stored result.** Decided when the package was written: a refresh that re-enriches a link counts again, and a retried enrichment that fails twice counts two failures, as it made two calls.
12. **`asks` counts every question Ask accepted.** Decided when the package was written: a `POST /api/v1/ask` that starts its answer, including "Nothing in your library answers this." A question refused before that (an invalid question, no key) is not counted.
13. **A `key_test` call is recorded under the model being tested.** Decided when the package was written: it is the model the provider billed.
14. **The size of an account being deleted is not recorded.** Decided when the package was written, as decay skips such accounts.

## Dependencies

- `18_show_library_statistics` (active, not yet implemented): the stats module, the Stats page and its Activity section this package extends. It must be implemented first.
- `01_accounts_links_and_stream` (active): adding, using and deleting links, whose events are counted.
- `02_fetch_and_snapshot` (active): fetch events, whose outcomes are counted.
- `03_ai_enrichment` (active): enrichment results and the provider calls whose tokens are recorded.
- `05_decay_and_liveness` (active): the decay run whose expirations and removals are counted, and the hourly run that records the end-of-day size.
- `07_bulk_import` (active): links added by an import.
- `12_ask_the_library` (sealed): Ask, whose questions and provider calls are counted.
- `14_keep_links_in_archive` (active): archive, unarchive and restore.
- `17_split_a_topic` (sealed): the split's provider call, whose tokens are recorded.
- `09_export_and_account_deletion` (active): account deletion removes the daily records. The export is unchanged.

## Verified External API

- `@anthropic-ai/sdk` 1.6.0 (`node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts`): `interface Usage { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number | null; cache_read_input_tokens: number | null; … }`, carried as `Message.usage`. `MessageStream.finalMessage(): Promise<ParsedMessage<…>>` (`lib/MessageStream.d.ts`) returns the streamed message with its `usage`.
- OpenRouter chat completions (`POST {OPENROUTER_BASE_URL}/chat/completions`): a non-streamed answer's `usage: {prompt_tokens, completion_tokens, total_tokens}` is **unverified**. It is read from no library, and only `e2e/fake-ai.ts` mimics it. A streamed answer's usage in its final chunk is **unverified**. If it is absent, the Ask call is recorded with `calls_without_usage`.
- Workers AI `env.AI.run` for embeddings (`src/worker/meaning/backend.ts`) returns `{data}` with no usage. It is not recorded.

## Glossary

- **unprotected link**: a link in state `active`, `pending` or `unreachable` that is neither pinned nor in a workspace, which decay can expire.
- **protected at risk**: a pinned link, or one in a workspace, at 0 points or below, which would expire if it were not protected.
- **backlog**: the links and vectors that the database records as waiting for background work: a fetch, an enrichment, an import dispatch, indexing, vector deletion or a liveness check.
- **throttle**: the per-owner spacing of background jobs, 3 seconds apart, and the import budget of 20 links a minute.
- **daily record**: the counters for one owner and one UTC day, with the library's size at its end and its AI token usage.
- **purpose**: why a provider call was made: `enrich`, `split`, `ask` or `key_test`.

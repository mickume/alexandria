# 07. Count the daily record in the writes it counts

## Status

Accepted (2026-11-10).

## Context

The daily record (`daily_stats`, package 19) counts, per owner and UTC day,
the links added, used, expired, removed, deleted, archived, unarchived and
restored, the fetch attempts by outcome, the enrichment results and the Ask
questions. Most of these events have several write paths: a link is added by
`addStatement` (pasting, the batch route, the MCP server) and by an import's
own insert; an expired link comes back through a use, a re-paste or the
restore route; a fetch event is written by the fetch worker and by the archive
refresh. A counter kept beside each path is a counter the next path can
forget, and the counts must stay exact when a write is rolled back or a queue
message is delivered again.

## Decision

- **A counter moves in the same transaction as the write it counts.** Nothing
  counts an event after the fact or from a log.
- **Where the event is a row written or a state changed, a trigger counts
  it**, in migration `0018_daily_stats.sql`: an insert into `links` (added),
  into `link_uses` (used) and into `link_events` of kind `fetch` (fetch_ok,
  fetch_failed); a change of `links.state` from `expired` to `active`
  (restored), to `archived` (archived), from `archived` (unarchived), to
  `expired` (expired); and the enrichment writes (enriched, enrichment_failed).
  The day is the UTC day of the time the write stores (`added_at`, `at`,
  `updated_at`), so a test clock and the stored times agree.
- **Where a trigger cannot tell events apart, the batch counts it**:
  `countStatement` (`stats/daily.ts`) is an upsert put in the same D1 batch as
  the change, conditioned on what the batch reads. Deleting a link and decay
  removing one are both deletes, so `deleteLink` counts `deleted` and the
  decay evaluation counts `removed`, each before the delete, on the same
  conditions. An Ask question writes no row, so the Ask route counts `asks`.
- Counters only grow. Only the account's deletion removes the rows, through
  the `user_id` column every owned table carries.

## Consequences

- Every write path, including ones added later and the test helpers' direct
  inserts, is counted without code of its own.
- A write that changes `links.state` or inserts into these tables for any
  other purpose is counted too; a new kind of write must be checked against
  the triggers' conditions.

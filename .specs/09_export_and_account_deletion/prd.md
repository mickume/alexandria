---
spec_id: "09"
spec_name: "export_and_account_deletion"
title: "Export the whole library and delete the account"
status: "active"
created_at: "2026-11-07T14:27:18Z"
intent_hash: "4cdbd2ee8071299bed5ed86d2b73f0b5858e01c62029dfab6119f2cb2409d3c5"
schema_version: 3
source: "docs/prd/01-build-the-alexandria-link-library.md"
---

# Export the whole library and delete the account

## Intent

The owner's library belongs to the owner. This package lets the owner, and only the owner, take all of it out at any time as one JSON document — every link in every state with everything the library knows about it, every workspace, topic and tag, and a way to fetch each stored snapshot and reader view — and leave for good: deleting the account removes every piece of the owner's data, from database rows to stored snapshots and the AI key, within minutes and without undo, while nothing still running in the background can bring any of it back.

## Goals

- The whole library can be exported as a single JSON file, and the account with all its data deleted, by the owner alone.
- The export holds every link (all fields, all states, manual edits, use counts), workspace, topic and tag of the user; snapshots are not included in the JSON but each link carries a URL from which its snapshot and reader view can be fetched with the same token.
- For 20,000 links the export completes in under 60 seconds.
- Account deletion removes every link, snapshot, workspace, token, session and the stored AI provider key of the user, and the user record with them, within 10 minutes; the user is signed out immediately; there is no undo.
- No request, background job or search can read or change another user's data, and no background job writes anything for a deleted account.

## Non-goals

- Importing an export back into Alexandria, or any structured import format: bulk import is plain text (package 07), and an importer for other formats is a later PRD.
- Exporting settings, the AI key (or any part of it), personal access tokens, sessions or the import reports.
- Scheduled or automatic exports, or exports to a third-party service.
- Undoing an account deletion, a grace period, or soft deletion visible to the owner.
- Deleting individual parts of the library in bulk (other than the whole account).
- The data itself: accounts, links and uses (package 01), snapshots and reader views (02), summaries, tags, topics and the AI key (03), workspaces and notes (04), decay and liveness fields (05), the search index and topic and tag lists (06), imports (07).
- Sharing, collaboration or any cross-user feature.

## Background

After packages 01 to 07 the library stores, per user: the user record (email, display name) and its sessions and personal access tokens (01, `src/worker/auth/`); links, their use events and pin positions (01, `src/worker/links/`); fetch results, fetch history and the snapshots and reader views in the R2 bucket `SNAPSHOTS` under `u/{user_id}/` (02, `src/worker/fetcher/`); summaries, topics, tags and the encrypted AI provider key with its provider and model (03, `src/worker/enrich/`); workspaces, their membership and order, and workspace and link notes (04, `src/worker/workspaces/`); archive, dead and liveness fields and the decay thresholds (05, `src/worker/decay/`); the full-text search index (06, `src/worker/search/`); and imports with their reports (07, `src/worker/imports/`). Background work runs in the `FETCH_QUEUE` and `ENRICH_QUEUE` consumers, the import processing and the daily Cron Trigger. `GET /api/v1/links/{id}` returns a link with every field the packages add, and `GET /api/v1/links/{id}/reader` and `/snapshot` serve the reader view and snapshot while recording a use. There is no export and no way to delete an account; the settings page (`src/web/pages/Settings.tsx`) has the tokens, AI key, decay and import sections. Everything under `src/worker/account/` is new.

Constraints the owner has set:

- Constraint: no built-in user management; identity comes from Google sign-in, and deleting the account is the owner's own action.
- Constraint: strict per-user separation of data and processing.
- Constraint: TypeScript throughout, on Cloudflare Workers, D1, R2 and Queues.

## Requirements

### Export

- `GET` of the export returns a single JSON document with every link (all fields, all states, manual edits, use counts), workspace, topic and tag of the user; snapshots are not included in the JSON but each link carries a URL from which its snapshot and reader view can be fetched with the same token. For 20,000 links the export completes in under 60 seconds.
- The stored AI provider key is never included in the export.
- The settings page offers the export as a download.
- End-to-end flow: the owner downloads the export from the settings page; a script fetches one link's snapshot from the URL in the export with a personal access token.

### Account deletion

- From the settings page the user confirms deletion by typing their email address; every link, snapshot, workspace, token, session and the stored AI provider key of that user is removed, and the user record with them, within 10 minutes. The user is signed out immediately. There is no undo.
- Account deletion is the owner's alone: no other user, and no request that is not the owner's, can delete or read the account's data.
- End-to-end flow: the owner deletes the account from the settings page, is signed out at once, the owner's token stops working, and within 10 minutes nothing of the account remains.

## Design Decisions

1. **The export's snapshot and reader URLs record no use.** They point at `GET /api/v1/export/links/{id}/snapshot` and `GET /api/v1/export/links/{id}/reader`, which serve exactly what the reader and snapshot endpoints serve, with the same token, but record no use. Decided in this run: fetching 20,000 snapshots for a backup through the use-recording endpoints would reset the decay of the whole library.
2. **A link's export entry is its API representation.** Each entry is the body `GET /api/v1/links/{id}` returns, plus `snapshot_url` and `reader_url` (absolute on `PUBLIC_ORIGIN`, `null` when there is nothing stored), so the export grows with every field a later package adds to the link. Decided in this run.
3. **The export is streamed and self-checking.** The document is written as it is read from D1, page by page, and its last member is `"complete": true`; a failure part-way aborts the stream, so a cut-off download never parses as a complete export. Decided in this run: 20,000 links do not fit a response built in memory within the time limit, and a truncated file must not pass for a full one.
4. **The export holds the user's email and name, links, workspaces, topics and tags and nothing else**: no settings, no AI key or any part of it, no tokens, sessions or import reports. Decided in this run: the source PRD lists what the export holds, and the key must never leave the server.
5. **Deleting the account needs a signed-in session.** `DELETE /api/v1/me` with a personal access token is refused with 403 `session_required`. Decided in this run: the source PRD puts deletion on the settings page, and a leaked token or an agent must not be able to destroy the library.
6. **Deletion is two-phase.** The request immediately deletes every session and token and the stored AI key, marks the account for deletion and queues the deletion job on a new queue, `ACCOUNT_QUEUE`; the job then removes the rest in batches, re-queueing itself until nothing remains, and removes the user record last. A Cron Trigger every 5 minutes re-runs the job for any account marked more than 5 minutes ago, so a lost or exhausted message cannot stop a deletion from finishing within 10 minutes. Decided in this run: a library of 20,000 links with snapshots is too much to delete within one request.
7. **The job finds the account's rows through the database itself.** It removes every row of the account from every table that holds a user or link reference, discovered from the schema rather than from a fixed list, so a table a later package adds is covered without changing the job. Decided in this run.
8. **Background work for an account marked for deletion does nothing.** Fetch, enrichment, import, liveness and decay work for such an account, or for a link that no longer exists, writes no row and no object and calls no external service. Decided in this run: otherwise a fetch finishing after the job could write a snapshot back.
9. **Signing in while a deletion is running is refused** with "Your account is being deleted, try again in a few minutes" (`/signin?error=deleting`); once the deletion has finished, the same Google account on the allow-list signs in to a new, empty library. Decided in this run.
10. **The confirmation compares the typed email case-insensitively, ignoring surrounding whitespace**; anything else is refused with 400 `confirmation_mismatch` and nothing is deleted. Decided in this run.

## Dependencies

- 01 `accounts_links_and_stream`: users, sessions, tokens, links, use events, the sign-in flow and page, the error envelope, the settings page.
- 02 `fetch_and_snapshot`: the snapshots and reader views in R2 and the fetch history; the fetch consumer that must write nothing for a deleted account.
- 03 `ai_enrichment`: summaries, topics, tags and the AI key; the enrichment consumer.
- 04 `workspaces_and_notes`: workspaces, membership and notes.
- 05 `decay_and_liveness`: the archive, dead and liveness fields and the decay settings; the daily cron's work.
- 06 `search_and_browse`: the search index, and the topic and tag lists the export reads.
- 07 `bulk_import`: imports and their processing.

External systems: Cloudflare D1, R2, Queues and Cron Triggers.

## Verified External API

No library beyond the project's own and the platform bindings: D1, R2 (`list` with a prefix, `delete` of up to 1,000 keys), Queues and Cron Triggers through `@cloudflare/workers-types`, and `@cloudflare/vitest-pool-workers` 0.23.0 (`env`, `SELF`, `applyD1Migrations` from `cloudflare:test`) for the tests. The R2 and Queue binding methods are typed by `@cloudflare/workers-types` and were not read for this package.

## Glossary

- **export**: the single JSON document holding the owner's whole library, ending with `"complete": true`.
- **marked for deletion**: an account whose deletion was confirmed and whose data the deletion job is still removing.
- **deletion job**: the background work that removes a marked account's rows and objects in batches.
- **snapshot**: the raw HTML (or the whole PDF) stored at fetch time.
- **reader view**: the cleaned, content-only rendering extracted from the snapshot.
- **personal access token**: a user-created secret that authenticates API and MCP requests as that user.
- **AI key**: the user's own Anthropic or OpenRouter API key, stored for enrichment.

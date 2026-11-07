---
spec_id: "07"
spec_name: "bulk_import"
title: "Import a plain-text list of URLs into the library"
status: "active"
created_at: "2026-11-07T14:22:28Z"
intent_hash: "7e0abc2a9a5fb261e4ce44dc90024ec0fc37648287247241c7ea3047782b69a6"
schema_version: 3
source: "docs/prd/01-build-the-alexandria-link-library.md"
---

# Import a plain-text list of URLs into the library

## Intent

Alexandria is a personal, private library of web links for one person at a time. This package moves an existing pile of links into it in one step: the owner uploads a plain-text file of up to 5,000 URLs, every line is normalised and added as if it had been pasted, duplicates and malformed lines are reported rather than added, the order the owner gave the file is kept, and the imported links are fetched and enriched in the background at a pace that keeps the provider calls and the owner's costs low. Without it, the 600 open tabs that motivated the library would have to be pasted one by one.

## Goals

- A plain-text file of up to 5,000 URLs is imported in one upload, with duplicates reported rather than added.
- The owner sees counts of added, duplicate and invalid lines, the invalid lines with their line numbers, and can download the report.
- Imported links enter the stream in file order, the first line highest, with last used = the import time.
- Fetch and enrichment of imported links run in the background at no more than 20 links per minute per user, and the stream fills in as they complete.
- The import is available through the API with the same report returned as JSON.

## Non-goals

- Importing browser bookmark exports (the Netscape bookmark HTML format) or other structured formats; an HTML importer that keeps folder names as tags is a later PRD.
- Crawling beyond the page at each imported URL.
- Accounts, adding links, normalisation, the library limit and the stream: package 01 (`accounts_links_and_stream`), whose rules this reuses.
- Fetching and snapshots: package 02 (`fetch_and_snapshot`). Enrichment, the AI key and the shared background throttle: package 03 (`ai_enrichment`).
- Workspaces (04), decay and liveness (05), search (06), the MCP server (08), export and account deletion (09).
- Sharing or any cross-user feature; cross-user de-duplication of fetching.

## Background

After packages 01 to 03 the library has: users, sessions and tokens; `normalizeUrl` in `src/worker/links/normalize.ts`; the link store in `src/worker/links/store.ts`, which adds a pending link or boosts an existing one, and `POST /api/v1/links/batch`, which gives a batch descending last-used times so that its first URL ends highest; the 20,000-link library limit (409 `library_full`); the stream at `GET /api/v1/links`; the error envelope and the OpenAPI document that a test keeps in step with the routes; the fetch worker (`src/worker/fetcher/`, fed by the `FETCH_QUEUE` Queue) that fetches, snapshots and moves a link out of `pending`, with the website updating the stream in place as links change; enrichment (`src/worker/enrich/`), which runs after a successful fetch when the user has an AI key; and the shared background throttle `src/worker/enrich/throttle.ts`, at most 20 links per minute per user, used by "enrich all unenriched links". The settings page (`src/web/pages/Settings.tsx`) holds the tokens and the AI key. There is no import.

Constraints from the source PRD:

- Constraint: TypeScript; API in Hono on Cloudflare Workers; data in D1; background work on Cloudflare Queues.
- Constraint: strict per-user separation of data and processing.

## Requirements

### Bulk import

- The settings page accepts a file upload: plain text (UTF-8) with one URL per line; blank lines and lines starting with `#` are ignored; anything after the first whitespace on a line is ignored, so a line like `https://example.com some note` imports the URL alone. Any other file type (HTML, JSON, binary) is refused with "only plain-text files with one URL per line are accepted" and nothing is imported.
- Limits: file at most 2 MB and 5,000 URLs; over either, the upload is refused with "too large: at most 5,000 URLs / 2 MB per import" and nothing is imported.
- Processing: each line is normalised and added as in Adding links; the user sees a progress view with counts of added, duplicates (not added, not boosted) and invalid lines, the invalid lines listed with their line numbers, and a downloadable report. Imported links enter the stream with last used = import time, in file order (the first line of the file ends up highest), so a file sorted by the owner is honoured.
- Fetch and enrichment of imported links run in the background at no more than 20 links per minute per user (a 600-line import completes in about 30 minutes), and the stream updates as they complete. The same 20,000-link library limit applies; an import that would cross it stops at the limit and the report says so.
- The import is accepted via the API as well (`POST` of the file) with the same report returned as JSON.

### End-to-end flow

1. The owner uploads a 400-line text file; a progress view counts added/duplicates/invalid; the stream fills in over the following minutes; the report lists the 3 malformed lines.

## Design Decisions

1. **Bulk import is plain text only.** Owner's decision; the browser's HTML export is a later PRD. Imported links take the import time as last used, in file order, because a plain list carries no dates. (Source PRD decision 8.)
2. **Background processing is throttled to 20 links per minute per user** for imports, through package 03's shared throttle, which "enrich all" also uses; links pasted or added through the API one at a time are not throttled. Owner's decision on the rate (source PRD decision 15); the exemption for pasted links decided in this run, so that the 60-second goal for a pasted link holds during an import.
3. **The lines are added within the upload request; only fetching and enrichment are in the background.** The response, `201`, carries the full report. Decided in this run: 5,000 inserts fit one request in D1 batches, and the counts are then final when the progress view first appears.
4. **What counts as "another file type".** A file is refused as not plain text when its declared type (the request's `Content-Type`, or the multipart part's type) is neither `text/plain` nor absent, when it is not valid UTF-8, when it contains a NUL byte, or when its first non-blank characters are `<` (HTML, XML) or it parses as a JSON object or array. A UTF-8 byte-order mark is dropped, and `\r\n` and `\n` both end a line. Decided in this run: the source PRD names the types but not the test.
5. **The refusals' status codes**: 400 `unsupported_file` for another file type, 409 `import_too_large` for more than 2 MB (2,097,152 bytes) or more than 5,000 URL lines (lines that are neither blank nor comments), 400 `no_urls` for a file with no URL line. Decided in this run, following the API's rule that limits answer 409.
6. **A comment line** is one whose first non-whitespace character is `#`. Decided in this run.
7. **Duplicates** are lines whose normalised URL is already in the library or appeared on an earlier line of the file; the report lists each with its line number, and neither is boosted. Decided in this run; the source PRD makes them "not added, not boosted".
8. **Order within one import time**: line 1 gets the import time as last used and each later line one millisecond less, so that the stream's last-used order is the file order. Decided in this run, the same rule package 01 uses for a pasted batch.
9. **Two imports of the same user share the 20-per-minute budget**, dispatched in the order the imports were made; a link deleted before its turn is skipped without using the budget. Decided in this run.
10. **The report** is kept with the import and is available as JSON (`GET /api/v1/imports/{id}`) and as a downloadable text file (`GET /api/v1/imports/{id}/report`); the progress view polls the JSON every 5 seconds until every added link has left `pending`. Decided in this run.

## Dependencies

- Package 01 `accounts_links_and_stream`: `normalizeUrl`, the link store and its de-duplication, the library limit, the stream, the error envelope, the OpenAPI document, the Settings page and the shared test helpers.
- Package 02 `fetch_and_snapshot`: the fetch worker and `FETCH_QUEUE`, which imported links are dispatched to; the stream's in-place update; `e2e/fake-origin.ts`.
- Package 03 `ai_enrichment`: enrichment after fetch and the shared background throttle `src/worker/enrich/throttle.ts`; `e2e/fake-ai.ts`.

## Verified External API

None beyond the packages above: the work uses Hono 4.13.17 (request body and multipart parsing), D1 batches and the Queue binding that packages 01 and 02 set up, and the platform's `TextDecoder` with `fatal: true` to test UTF-8.

## Glossary

- **import**: one upload of a plain-text file of URLs, with its report.
- **URL line**: a line of the file that is neither blank nor a comment; its first whitespace-separated word is taken as the URL.
- **duplicate**: a URL line whose normalised URL is already in the library or on an earlier line of the same file.
- **report**: the counts of added, duplicate and invalid lines, the invalid and duplicate lines with their line numbers, and whether the library limit stopped the import.
- **throttle**: the per-user limit of 20 links per minute on background fetch and enrichment of imported links.
- **stream**: the home page listing, pinned links first then by last use descending.

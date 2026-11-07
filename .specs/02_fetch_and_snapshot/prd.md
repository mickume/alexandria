---
spec_id: "02"
spec_name: "fetch_and_snapshot"
title: "Fetch every link and keep a snapshot that outlives its site"
status: "active"
created_at: "2026-11-07T14:23:44Z"
intent_hash: "3d55ab2f4d151d0491aaceb88630fdb82d53fe628ab8bc51b9b650c26ebb129e"
schema_version: 3
source: "docs/prd/01-build-the-alexandria-link-library.md"
---

# Fetch every link and keep a snapshot that outlives its site

## Intent

A link is only worth keeping if it can still be read when the site behind it changes or disappears. This package fetches every link a user adds, in the background and courteously, records what the page is (its title, description, icon, language and final address), stores the page itself as a snapshot and a cleaned reader view (a PDF whole, with its text), and lets the owner read either one from Alexandria at any time, as a use of the link, even when the origin is down or gone. The stream updates in place as fetches complete, and every fetch and its outcome is visible on the link.

## Goals

- Within 60 seconds of a link being added (p95), the page at its URL is fetched and the stream shows its title without a reload.
- Every successfully fetched link has a stored snapshot and a cleaned reader view that render even when the original site is down or gone; a link to a PDF has the whole PDF stored and readable.
- The fetcher never makes more than 1 request per second to the same host.
- Every failure is visible on the link as a state and a reason, and a link that cannot be fetched stays usable.
- Snapshots and reader views are never served to anyone but the owner, and are deleted with their link.

## Non-goals

- Enrichment (summary, tags, topic), the AI provider key and manual edits of title, summary, tags and topic: package 03 (`ai_enrichment`). This package stores the reader-view text that enrichment reads and says which links have no text to enrich.
- Liveness checks and the `dead` mark: package 05 (`decay_and_liveness`), which reuses this package's per-host rate limit.
- Search over the reader-view text: package 06 (`search_and_browse`). Workspaces (04), bulk import (07), the MCP server (08) and export (09) are their own packages.
- Crawling beyond the page at the pasted URL: linked pages, feeds and sitemaps are not fetched.
- Full-fidelity archiving of web pages (images, scripts, screenshots). The snapshot of a web page is its HTML and cleaned text; a PDF is the exception and is stored whole.
- Respecting `robots.txt`. Fetching is done on the owner's behalf, as a browser would; the only courtesy is the per-host rate limit.
- Offline / PWA operation of the website: the snapshot is for reading when the origin is gone, not when the reader is offline.
- Cross-user de-duplication of fetching: each user's URL is fetched and stored for that user alone, even when another user holds the same URL.

## Background

Package 01 (`accounts_links_and_stream`) creates the project: the Hono Worker in `src/worker/` with D1 (`DB`), the React website in `src/web/`, the allow-listed Google sign-in, sessions and personal access tokens, the error envelope and rate limit in `src/worker/api/`, the OpenAPI document that a test keeps in step with the routes, cursor pagination, and the shared test helpers `src/worker/test/helpers.ts` and `src/web/test/helpers.tsx`. Its links are added by `POST /api/v1/links` and `POST /api/v1/links/batch` in state `pending` with the host as provisional title and stay `pending` forever, because nothing fetches them. `recordUse` in `src/worker/links/use.ts` records a use (use count, last used, a `link_uses` row); `GET /api/v1/links/{id}/history` lists a link's `use` events; `LinkCard.tsx` and `LinkDetail.tsx` show a link on the website; `DELETE /api/v1/links/{id}` deletes a link and its uses. URLs are normalised and checked by `normalizeUrl` in `src/worker/links/normalize.ts`, which rejects localhost, loopback and private hosts.

This package adds the background fetch (a Cloudflare Queue and its consumer), the per-host rate limit (a Durable Object), the snapshot store (R2), the reader view, and the Read and Snapshot views.

Constraints the owner has set:

- Constraint: TypeScript throughout; Cloudflare services where they fit; external libraries only from very well-maintained projects.
- Constraint: strict per-user separation of data and processing.
- Constraint: `robots.txt` is not consulted (owner's decision).

## Requirements

### Fetch

- Within 60 seconds of a link being added (p95), the page at its URL is fetched: method GET, following at most 5 redirects, timeout 15 seconds, response body limit 5 MB, `Accept: text/html, application/pdf`, a User-Agent that identifies the service by name and gives a URL explaining it. Responses with a `text/html` or `application/xhtml+xml` content type are processed as web pages; responses with `application/pdf` (or a URL ending in `.pdf` whose response is a PDF) as PDFs, with a body limit of 50 MB instead of 5 MB. `robots.txt` is not consulted; the fetcher never makes more than 1 request per second to the same host.
- From a successful fetch the following are stored for the link: the final URL after redirects, the HTTP status, the page title (`<title>`, falling back to `og:title`, falling back to the host), the description (`og:description` / `meta description`), the favicon URL, the language if declared, the raw HTML (the **snapshot**) and the cleaned reader view. Link state becomes `active`.
- From a successful PDF fetch: the whole PDF file is stored as the snapshot, the title is the PDF's title metadata, falling back to the last path segment; the text of the document is extracted (first 500,000 characters) as the reader-view text. A PDF with no extractable text (scanned images) is `active` with a note "no text in this PDF".
- Failures, each visible on the link as a state and a reason:
  - fetch fails (DNS, connection, timeout, TLS): the link stays `pending` and is retried after 10 minutes and again after 2 hours; after the third failure it becomes `unreachable` with the reason shown ("could not connect", "timed out", ...), keeps its host as title, and can still be pinned, used and deleted.
  - HTTP 4xx/5xx: treated like a fetch failure, with the status shown ("HTTP 403").
  - a content type that is neither HTML nor PDF (an image, JSON, a video): the link becomes `active` with title = the final path segment or host, no snapshot, and a note "not a web page (image/png)".
  - page body over 5 MB: the first 5 MB are used, and the link is noted "truncated". PDF over 50 MB: not stored; the link is `active` with a note "PDF too large to store (50 MB limit)".
- Re-fetch: the user can request "refresh" on any link; it re-runs the fetch, replaces the snapshot and reader view, and records the new fetch time. At most one refresh per link per 10 minutes; a second within that window is refused with "already refreshed recently".
- The new link appears immediately with its host name as a provisional title and a `pending` indicator; the fetch runs in the background and the stream updates in place when it completes, without a reload.
- The link detail view shows the history of uses and fetches.

### Reader view and snapshot

- For every link with a snapshot the website offers "Read" (the cleaned reader view: article title, byline and body text with headings, lists, code blocks, links and inline images referenced by their original URL, nothing else) and "Snapshot" (the raw stored HTML rendered in a sandboxed frame with scripts disabled). Both work when the origin is unreachable. Both count as a use.
- For a PDF link, "Read" shows the extracted text and "Snapshot" serves the stored PDF itself, inline in the browser's PDF viewer, with a download action.
- Cleaning uses a Readability-style extraction. If extraction yields fewer than 200 characters of text, the reader view says "no readable content extracted" and offers the snapshot instead.
- Reader-view text is stored for search; the stored text is capped at 500,000 characters per link.
- Snapshots and reader views are deleted with their link, and are never served to any user other than the owner.

### End-to-end flows

1. The owner pastes the URL of a reachable article; it appears as `pending`; within a minute the card shows the article's title without a reload; the owner chooses "Read" and sees the cleaned article, and the card's last used is now.
2. A site goes offline after its page was fetched; the owner opens "Snapshot" and "Read" and both still show the stored page.
3. The owner pastes the URL of a PDF; the card shows the PDF's title; "Snapshot" shows the PDF inline with a download action and "Read" shows its text.

## Design Decisions

1. **"Archive" and "snapshot" are separate things.** Every successfully fetched link gets a snapshot immediately; "archived" is a lifecycle state handled in package 05. (Source PRD decision 1.)
2. **PDFs are in scope and stored whole**, up to 50 MB, with text extracted for reading and later search and enrichment. Owner's decision; the 50 MB figure is a per-deployment limit.
3. **robots.txt is not consulted**; the per-host rate limit of 1 request per second is the only courtesy. Owner's decision.
4. **The per-host rate limit is per host across all users**, not per user: one Durable Object per host spaces every request Alexandria sends to it (fetch, refresh, and package 05's liveness checks) at least 1 second apart. Decided in this run: it satisfies the source PRD's per-user rule and is the stricter courtesy, and it shares no user data.
5. **Fetching runs on a Cloudflare Queue** (`FETCH_QUEUE`): adding a link (one or a batch) and refresh each send one message; retries are the same message sent again with a delay of 10 minutes and then 2 hours. Decided in this run: a queue gives the background work its own retries and concurrency without blocking the request that added the link.
6. **Redirect targets are checked like pasted URLs.** A redirect to a non-http(s) scheme, localhost, a loopback, private or link-local address is a fetch failure with the reason "blocked address", so that a pasted public URL cannot make Alexandria read a private network. Decided in this run.
7. **The User-Agent** is `Alexandria/1.0 (+<PUBLIC_ORIGIN>/about/fetcher)`, and `/about/fetcher` is a public page explaining the fetcher. Decided in this run: the source PRD asks for a name and an explaining URL.
8. **A failed refresh keeps what the link had.** A refresh that fails (any fetch failure) leaves the previous snapshot, reader view, metadata and state in place, records a failed fetch event with its reason, and is not retried; only a link still `pending` follows the 10-minute / 2-hour retry chain. Decided in this run: a transient error must not take a working link's snapshot away; whether a link is dead is package 05's liveness check.
9. **The refresh limit answers 429.** A second refresh within 10 minutes answers 429 `{ "error": "refreshed_recently", "message": "already refreshed recently" }` with `Retry-After` in seconds; it is a rate limit, and package 01's convention gives rate limits 429.
10. **Where things are stored.** The snapshot (HTML or PDF) and the reader view's HTML are R2 objects under `u/{user_id}/l/{link_id}/`; the reader-view plain text (at most 500,000 characters) is a D1 row in `link_texts`, so that package 06 can index it; fetch events are rows of `link_events`. Decided in this run.
11. **The stream updates by polling.** While any loaded card is `pending`, the website asks `GET /api/v1/links?changed_since=<server time>` every 5 seconds and replaces changed cards in place. Decided in this run: polling needs no long-lived connection on Workers and meets the 60-second goal with room.
12. **The snapshot is served with a sandbox Content-Security-Policy** (`sandbox; default-src 'none'; img-src * data:; style-src * 'unsafe-inline'; font-src * data:`) and shown in an `<iframe sandbox>`, so stored scripts never run and the page cannot act on the owner's session. Decided in this run.
13. **Test seam for outbound requests.** When the deployment variable `ORIGIN_PROXY_URL` is set (end-to-end tests only), the fetcher sends each request to that URL with the target in the `X-Alexandria-Target` header, so that `e2e/fake-origin.ts` can play every origin site; all checks on the target (scheme, blocked address, redirects, limits) apply to the target URL. Production leaves it unset. Decided in this run: package 01's normaliser rejects localhost, so a local fake site cannot be pasted directly.
14. **A PDF that cannot be parsed** is treated like one without text: stored, `active`, noted "no text in this PDF". Decided in this run.
15. **The public page `/about/fetcher`** is the only page besides `/signin` served without a session, because the User-Agent points site operators at it. Decided in this run.
16. **Every write to a link sets its `updated_at`**, which the change feed `changed_since` reads; this package adds the column to package 01's links. Decided in this run.
17. **Deleting a link deletes its stored objects**, and a fetch message for a link deleted meanwhile is dropped without writing anything. Decided in this run, from the source PRD's "deleted with their link".

## Dependencies

- Package 01 `accounts_links_and_stream` (draft at the time of writing): the links, `recordUse`, the history endpoint, the API conventions, the OpenAPI document, the stream page and card, the test helpers and the project tooling. This package changes its add, batch and delete routes (to send fetch messages and delete stored objects), its history endpoint (to add `fetch` events) and its card and detail page.
- External: Cloudflare Queues, R2 and Durable Objects; every origin site a link points at.

## Verified External API

Read from the published packages on 2026-11-07:

- `@mozilla/readability` 0.6.0: `new Readability(document: Document, options?)`; `parse(): null | { title, content, textContent, length, excerpt, byline, dir, siteName, lang, publishedTime }`.
- `linkedom` 0.18.15: `parseHTML(html: string): Window & typeof globalThis`.
- `unpdf` 2.1.0: `getDocumentProxy(data, options?): Promise<PDFDocumentProxy>`; `extractText(data, { mergePages: true }): Promise<{ totalPages: number; text: string }>`; `getMeta(data, options?): Promise<{ info: PDFInfo; metadata }>`.
- `dompurify` 3.4.17: published and current; the website sanitises the reader view again with it before display (no symbol beyond its default `sanitize` relied on, not read).
- `hono` 4.13.17 and `@cloudflare/vitest-pool-workers` 0.23.0 as in package 01.

## Glossary

- **snapshot**: the raw HTML stored at fetch time, or for a PDF the whole file.
- **reader view**: the cleaned, content-only rendering extracted from the snapshot (for a PDF, its extracted text).
- **fetch event**: one fetch attempt recorded on a link, with its time, outcome, HTTP status and reason.
- **host gate**: the per-host rate limit, at most 1 request per second to one host.
- **use**: an open, read or snapshot view of a link, recorded with a timestamp.
- **unreachable**: the state of a link whose first fetch failed three times.

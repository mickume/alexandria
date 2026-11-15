# Keep a snapshot of a page's article with its images

## Intent

A link's page should be readable in Alexandria as it was when the owner chose to keep it, whatever later happens to the site. A snapshot is that kept copy: the page's article alone (its text and the images that belong to it, everything else stripped), with those images downloaded and stored, so reading it needs nothing from the origin, as a reading service such as Instapaper keeps it. The owner takes a snapshot when they choose, reads it from the link's card and detail page, and archiving a link keeps its snapshot, taking one when there is none.

## Goals

- The owner can take a snapshot of any link from its card, its detail page or the MCP tool `take_snapshot`. A snapshot of an article with up to 20 images on up to 5 hosts is stored within 2 minutes of the request (p95).
- A web page's snapshot renders its article's text and every image it stored with no request to the page's origin or to any image host: the browser's network log while it is open shows requests to Alexandria alone.
- The card and the detail page of a link with a snapshot offer Read, which opens the snapshot. Reading it counts as a use. There is no other reading view.
- A snapshot changes only when the owner takes a new one and the new one succeeds. A refresh, a failed snapshot or archiving never replaces or removes it.
- Archiving a link that has a snapshot fetches nothing. Archiving a link without one takes one.
- A snapshot stores at most 100 images, each at most 10 MB, and at most 50 MB of images in total.

## Non-goals

- Reading without a network on the owner's device (an installable app, a service worker, a device cache).
- Full-fidelity archiving: the page's layout, stylesheets, scripts, fonts, video, audio, embedded frames and inline `<svg>` elements are not kept.
- More than one snapshot per link: no versions and no history of copies.
- Snapshots of a resource that is neither a web page nor a PDF.
- Keeping today's stored copies of web pages: the raw HTML and reader views stored before this change are deleted and not converted (Design Decision 6).
- Changes to search, hybrid search, Ask, enrichment or the meaning index: they keep reading the article text every fetch stores in `link_texts`, as today.
- Respecting `robots.txt` for images, as for pages (package 02's decision).

## Background

What exists today (packages 02 `fetch_and_snapshot` and 14 `keep_links_in_archive`):

- Every fetch (`processFetch` in `src/worker/fetcher/queue.ts`, run from `FETCH_QUEUE`) of a web page stores two objects in the R2 bucket `SNAPSHOTS`, under `u/{user_id}/l/{link_id}/`:
  - `snapshot`: the raw HTML as downloaded, converted to UTF-8 (`storeHtml`);
  - `reader.json`: the reader view, the article that Readability (`@mozilla/readability` over a `linkedom` DOM) extracts, sanitised by an allow-list (`extractReader` in `src/worker/fetcher/reader.ts`), with its title and byline. Its `<img src>` addresses are made absolute and still point at the origin. The allow-list drops `srcset`, `<picture>` sources and inline `<svg>`.
- The article's plain text goes to D1 (`link_texts`, at most 500,000 characters), where search, enrichment and the meaning index read it. A PDF is stored whole as `snapshot`, up to 50 MB (`storePdf`); anything else stores nothing (`storeOther`). The link row records `has_snapshot`, `content_kind` and `reader_empty`.
- Every successful fetch, refreshes included, replaces what the previous one stored (`writeFetched`). A failed refresh keeps what the link had.
- `GET /api/v1/links/{id}/snapshot` (`src/worker/fetcher/routes.ts`) serves the raw HTML under a sandbox Content-Security-Policy that lets the browser load images, stylesheets and fonts from anywhere, so the page renders from the origin and breaks once the origin is gone. A PDF is served inline, or as an attachment with `?download=1`. `GET /api/v1/links/{id}/reader` serves the reader view as JSON. Both record a use and answer 404 `no_snapshot` when `has_snapshot` is false. `POST /api/v1/links/{id}/refresh` queues a refresh at most once per 10 minutes (429 `refreshed_recently`).
- The website: `LinkCard` (`src/web/components/LinkCard.tsx`) shows Read (when `has_snapshot`) beside Open and Pin, and Snapshot in its More actions menu. The Read page (`src/web/pages/Read.tsx`, route `/links/{id}/read`) shows the reader view, sanitised again with DOMPurify. The Snapshot page (same file, route `/links/{id}/snapshot`) shows the raw HTML in an `<iframe sandbox="">`, or a PDF in an `<object>` with Download. The detail page (`src/web/pages/LinkDetail.tsx`) has Refresh, Check, Pin or Unpin, the workspace picker, Archive or Unarchive and Delete, and neither Read nor Snapshot. The stream polls `GET /api/v1/links?changed_since=` every 5 seconds while a card is pending.
- `POST /api/v1/links/{id}/archive` (`src/worker/decay/archive.ts`) sets the link `archived` and queues a refresh on `FETCH_QUEUE`, outside the 10-minute refresh limit. When that fetch succeeds it replaces the stored copy, even with a worse one: a paywall, a cookie wall, or a "page moved" page answered with 200.
- The MCP tool `get_link_content` (`src/worker/mcp/tools.ts`) returns the reader text (`format: "text"`, from `/reader`) or the raw snapshot HTML (`format: "html"`, from `/snapshot`). The export (`src/worker/account/export.ts`) lists each link with `snapshot_url` and `reader_url`, served by `GET /api/v1/export/links/{id}/snapshot` and `/reader` without recording a use. The statistics (`src/worker/stats/stats.ts`) count `with_snapshot` and `reader_empty`. Deleting a link or an account deletes everything under the link's prefix (`deleteLinkObjects` in `src/worker/fetcher/snapshots.ts`).
- The fetcher goes through the host gate (`HostGate` in `src/worker/fetcher/hostgate.ts`: at most 1 request per second per host, across all users). It refuses private and loopback targets on every redirect (`requestFollowing` in `src/worker/fetcher/fetch.ts`), falls back to the owner's Firecrawl key behind a bot check (`fetchThroughFirecrawl`), and identifies itself as `Alexandria/1.0 (+<PUBLIC_ORIGIN>/about/fetcher)`. The public page `/about/fetcher` tells site operators that the fetcher does not fetch images.
- Package 02's PRD put full-fidelity archiving (images) out of scope and described the reader view's images as "referenced by their original URL". Package 14's PRD promises an archived link is kept "with its offline copy". Neither holds once the origin is gone: the copy's images, and the raw snapshot's styles, load from the origin.

## Requirements

### Taking a snapshot

- The owner requests a snapshot with `POST /api/v1/links/{id}/snapshot`, for a link in any state. The request answers `202 {"status": "queued"}` at once, sets the link's `snapshot_requested_at` to now, and queues a fetch of the link's address on `FETCH_QUEUE`.
  - A second request for the same link within 10 minutes of the last accepted one is refused with `429 {"error": "snapshot_recent", "message": "a snapshot was taken recently"}` and a `Retry-After` header in seconds; nothing is queued. This window is separate from the refresh window: a refresh does not count against it, and it does not count against the refresh's.
  - A missing link, or another user's, gets `404 {"error": "not_found"}`, and nothing is queued.
  - When the message cannot be queued, the answer is `503 {"error": "unavailable", "message": "the snapshot could not be queued"}`, and `snapshot_requested_at` is left as it was.
- Taking a snapshot is a refresh that also stores the copy. The fetch is made as every fetch is (host gate, redirect checks, limits, Firecrawl behind a bot check). It updates the link's metadata, its `link_texts` text and its enrichment exactly as a successful refresh does, and then stores the snapshot according to what the address served:
  - **A web page**: the article is extracted as the reader view is today, its images are downloaded and stored (see Images), and the snapshot is stored: the article's title, byline, sanitised HTML, the time it was taken and its notes.
  - **A PDF** up to 50 MB: the file is stored as the snapshot.
- When the new snapshot is stored, it replaces the previous one, and the previous one's objects, images included, are deleted. The link's `has_snapshot` becomes true, `snapshot_at` becomes the time it was taken, and `snapshot_requested_at` becomes null. The link's history records a `snapshot` event with outcome `ok`.
- Every failure leaves the previous snapshot, if any, exactly as it was. It sets `snapshot_requested_at` to null and records a `snapshot` event with outcome `failed` and its reason in the link's history:
  - the page cannot be fetched: the fetch's own reason ("timed out", "HTTP 404", "blocked by a bot check", …). A failed snapshot is not retried, and it never changes the link's state, its metadata or its text;
  - the page has less than 200 characters of article text: the reason "no readable content". The metadata and the text are still updated, as a refresh would update them;
  - the address serves neither a web page nor a PDF: the reason "not a web page (<content type>)";
  - a PDF over 50 MB: the reason "PDF too large to store (50 MB limit)";
  - the link was deleted while the snapshot was being taken: nothing is stored, and every object the attempt wrote is deleted.
- Every link the API returns carries `snapshot_at` (the time the stored snapshot was taken, or null) and `snapshot_requested_at` (set while a requested snapshot is still being taken, otherwise null). `has_snapshot` is true exactly when `snapshot_at` is not null.

### Images

- Every `<img>` in a web page's article is downloaded once and stored with the snapshot, and its address in the stored article is replaced by Alexandria's address for the stored copy: `/api/v1/links/{id}/snapshot/images/{name}`. A new snapshot's image names are never those of an earlier snapshot of the same link.
- For an image with a `srcset`, or inside a `<picture>`, the candidate saved is the largest whose width descriptor is at most 2000 pixels; without width descriptors, the highest density at most 2x; without either, its `src`. Images whose address Readability recovers from a lazy-loading attribute (`data-src`, `data-srcset`) are saved like any other. An image already given as a `data:image/…` address is kept inline and counts against no limit.
- Images are fetched as pages are: through the host gate, refusing private and loopback addresses on every redirect, with Alexandria's User-Agent and a timeout of 15 seconds each, never through Firecrawl. Only a 2xx response whose content is JPEG, PNG, GIF, WebP, AVIF or SVG is stored, with that content type.
- Limits: at most 100 images per snapshot, in the order they appear in the article; each at most 10 MB; at most 50 MB of images per snapshot. An image past any limit is not downloaded or not stored.
- An image that is not stored (a failed request, a 4xx or 5xx, another content type, past a limit) is replaced in the article by a placeholder showing its alt text (or "image" when it has none) and a link to its original address that opens in a new tab. The snapshot never loads anything from the origin by itself. The snapshot's notes then include "N images could not be saved", with N the number of such images. Images that fail do not make the snapshot fail.

### Reading a snapshot

- `GET /api/v1/links/{id}/snapshot` returns the stored snapshot as JSON and records a use:
  - for a web page: `{"content_kind": "html", "title", "byline", "html", "taken_at", "notes"}`, the `html` with every stored image at its Alexandria address;
  - for a PDF: `{"content_kind": "pdf", "title", "byline": null, "html": null, "taken_at", "notes", "file_url"}`, with `file_url` `/api/v1/links/{id}/snapshot/file`.
  - A link without a snapshot gets `404 {"error": "no_snapshot", "message": "no snapshot stored for this link"}`. A missing link, or another user's, gets `404 {"error": "not_found"}`.
- `GET /api/v1/links/{id}/snapshot/file` serves a PDF snapshot's file inline, or as an attachment with `?download=1`, named after the link's title, as the PDF is served today. It records no use. A link whose snapshot is not a PDF, or that has none, gets 404 `no_snapshot`.
- `GET /api/v1/links/{id}/snapshot/images/{name}` serves a stored image with its stored content type, `X-Content-Type-Options: nosniff`, a cache lifetime of one year marked private, and, for SVG, `Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'`. It records no use. An image name that the link's current snapshot does not hold gets 404 `not_found`.
- All three are served to the link's owner alone, by session or personal access token. A link of another user answers 404 `not_found`.
- `GET /api/v1/links/{id}/reader` is removed and answers 404 `not_found`.

### The website

- A card whose link has a snapshot shows Read where Read is today. Read opens `/links/{id}/read`, which shows the snapshot:
  - for a web page: its title, byline and article (headings, paragraphs, lists, code, tables, figures, links, the stored images and the placeholders of images not saved), sanitised again in the browser before it is shown, with the date it was taken and its notes;
  - for a PDF: the file in the browser's PDF viewer, with Download.
- A card whose link has no snapshot shows no Read.
- The card's More actions menu has "Take snapshot", or "Retake snapshot" when the link has one, in place of today's Snapshot entry. Choosing it sends the request and shows "Taking a snapshot…" on the card. A 429 shows "A snapshot was taken recently; try again in N minutes." A 503 shows "The snapshot could not be queued."
- The detail page's Actions group gains Read (when the link has a snapshot) and Take snapshot or Retake snapshot, behaving as on the card. Its history lists `snapshot` events with their outcome and reason.
- While any card or detail page shown has `snapshot_requested_at` set, the website polls the change feed every 5 seconds, as it does for pending cards. When the snapshot is stored, the card shows Read; when it fails, the card shows the failure's reason.
- The page `/links/{id}/snapshot` and the raw-HTML frame are removed; `/links/{id}/snapshot` opens `/links/{id}/read`.

### Fetches and refreshes

- A fetch, whether the first fetch of a new link or a refresh, stores the link's metadata and its article text in `link_texts` as today, and no longer stores a web page's raw HTML or reader view.
- A refresh never changes a link's snapshot, a PDF's included.
- The first successful fetch of a PDF link stores the PDF as its snapshot, as today, so a PDF link has a snapshot as soon as it is fetched, with `snapshot_at` the fetch's time. A later refresh of that link does not replace the stored PDF; Retake snapshot does.
- `reader_empty` keeps its name and now means: the last fetch of this web page found less than 200 characters of article text.

### Archiving

- Archiving a link (`POST /api/v1/links/{id}/archive`) that has a snapshot changes its state as today and queues nothing: no refresh, no snapshot, no re-enrichment.
- Archiving a link without a snapshot changes its state as today and takes a snapshot as Taking a snapshot describes, outside the 10-minute snapshot window and without counting against it. This replaces the refresh that archiving queues today. When the snapshot fails, the link stays archived without one, and its history records the failed `snapshot` event. When the snapshot cannot be queued, the link stays archived, the answer is still `200 <link>`, and the history records a failed `snapshot` event with the reason "snapshot before archiving could not be queued".
- A link stays archived through a snapshot, a refresh and a failed attempt of either.

### Agents and the export

- The MCP tool `take_snapshot` takes `{"link_id": "<id>"}` and requests a snapshot as `POST /api/v1/links/{id}/snapshot` does, returning `{"status": "queued"}`. A link within its 10-minute window returns the tool error `{"error": "snapshot_recent"}`; a missing link returns the tool error `{"error": "not_found"}` that every tool returns for one.
- `get_link_content` with `format: "text"` returns the link's stored article text (a PDF's extracted text) from a new route `GET /api/v1/links/{id}/text`, which answers `{"id", "text"}` and records a use, or `404 {"error": "no_text", "message": "no text stored for this link"}` when there is none; the tool then returns `no_content`. With `format: "html"` it returns the snapshot's article HTML from `GET /api/v1/links/{id}/snapshot`, `no_content` when the link has no snapshot, and `not_html` for a PDF snapshot, as today.
- Each export entry carries `snapshot_url` (null without a snapshot) and `text_url` (null without stored text) in place of `reader_url`.
  - `GET /api/v1/export/links/{id}/snapshot` serves the same JSON as `GET /api/v1/links/{id}/snapshot`, with every image address and the `file_url` made absolute export addresses: `<PUBLIC_ORIGIN>/api/v1/export/links/{id}/snapshot/images/{name}` and `<PUBLIC_ORIGIN>/api/v1/export/links/{id}/snapshot/file`.
  - Those two routes, and `GET /api/v1/export/links/{id}/text`, serve exactly what the link routes serve.
  - None of the export routes records a use.
- The statistics' `with_snapshot` counts links with a snapshot.

### Existing data

- Once, when this change is deployed, every stored raw HTML snapshot and every stored reader view is deleted, and every web-page link's `has_snapshot` becomes false with `snapshot_at` null, archived links included. Stored PDFs stay, and become those links' snapshots with `snapshot_at` their `fetched_at`. Links, their metadata, their `link_texts` text, their enrichment and their history are untouched. A failure part-way can be run again and finishes the same.

### The fetcher's public page

- `/about/fetcher` says that the fetcher also downloads the images of a page's article when its user takes a snapshot of that page, at most 1 request per second per host, and still fetches no stylesheets, scripts, feeds or linked pages.

### End-to-end flows

1. The owner adds the URL of an article with two images, served by the fake origin. Once it is fetched, the card shows no Read. The owner chooses Take snapshot in the card's menu. The card shows "Taking a snapshot…", then Read. The owner opens Read and sees the article with both images. The fake origin is taken offline. The owner opens Read again and still sees both images; no request left Alexandria.
2. The owner archives a link that has no snapshot. On the Archive page its card soon shows Read, which opens the article with its images.
3. The owner takes a snapshot of a link, the fake origin then serves different content at its address, and the owner archives the link and refreshes it. Read still shows the original content; the detail page shows the refresh's new title.
4. The owner takes a snapshot of an article one of whose images the fake origin answers with 404. Read shows the article, the saved image, a placeholder with the missing image's alt text and link, and the note "1 images could not be saved".
5. An agent calls `take_snapshot` for a link. Within a minute the link's card shows Read.

## Design Decisions

1. **A snapshot is the article only, with its images stored. It is not an offline mode.** The owner's decision: the goal is to preserve the page as it was, as a reading service does, not to read without a network.
2. **A snapshot is taken only when the owner asks, or when a link without one is archived.** The owner's decision: images are downloaded only for pages the owner chose to keep.
3. **The snapshot is the only reading view. The reader view, the raw-HTML snapshot and their pages are removed.** The owner's decision: one view, as Instapaper has. The article text is still extracted at every fetch, because search, Ask, enrichment and the meaning index read it.
4. **Taking a snapshot fetches the page now, and does everything a refresh does as well.** The owner's decision: the copy is the page as it is at the moment the owner chose, and the link's metadata should agree with it.
5. **A snapshot changes only when a new one succeeds. A refresh never changes it, a PDF's included, and archiving a link with a snapshot fetches nothing.** The owner's decision: a later fetch must not replace the copy the owner chose to keep with a worse one.
6. **Existing raw HTML and reader views are deleted, not converted, archived links included.** The owner's decision, made knowing that an archived link whose site is already gone loses its only readable copy.
7. **PDFs keep today's behaviour: the first successful fetch stores the file, and that file is the link's snapshot.** The owner's decision.
8. **An image that cannot be saved becomes a placeholder with its alt text and a link to its original address.** The owner's decision: the snapshot never loads anything from the origin by itself.
9. **Image limits: 100 images, 10 MB each, 50 MB per snapshot.** The owner's decision; 50 MB is the PDF limit.
10. **One snapshot per link per 10 minutes, in a window separate from refresh's. Archiving bypasses it.** The owner's decision, following refresh's limit.
11. **Agents can take snapshots (`take_snapshot`); `get_link_content` reads the text and the snapshot; the export's `reader_url` becomes `text_url`.** The owner's decision.
12. **The `srcset` candidate saved is the largest at most 2000 pixels wide (or at most 2x).** Decided in this run: sharp on a large screen without storing originals meant for print.
13. **SVG images are stored and served under a sandbox Content-Security-Policy.** Decided in this run: diagrams are often SVG, and the policy stops a stored SVG's scripts from running if its address is opened directly.
14. **Images never go through Firecrawl.** Decided in this run: Firecrawl returns a page, not an image, and each image request would spend the owner's Firecrawl credits.
15. **A failed snapshot is not retried and changes nothing about the link.** Decided in this run, as a failed refresh: the owner sees the reason and can try again after the window.
16. **`snapshot_requested_at` is on the link, and the website polls the change feed while it is set.** Decided in this run: the stream already polls this way for pending cards.
17. **The route `GET /api/v1/links/{id}/snapshot` now answers JSON for both kinds, with the PDF file at `/snapshot/file`.** Decided in this run: one shape for the website, the MCP tool and the export.
18. **A snapshot that cannot be queued answers `503 unavailable`.** Decided in this run. This error code is new: today a refresh that cannot be queued fails with an unhandled error.
19. **Size.** The requirements cover eight areas (taking a snapshot, images, reading, the website, fetches and refreshes, archiving, agents and the export, existing data). `spec` may split them, with taking a snapshot and its images as the foundation.

## Dependencies

- Package 02 `fetch_and_snapshot` (active): superseded in part. This PRD replaces its meaning of "snapshot" (the raw HTML), its reader view and Read and Snapshot views, and its rule that every successful fetch replaces the stored copy. It keeps its fetch, host gate, retries, refresh and PDF handling.
- Package 14 `keep_links_in_archive` (active): changes what archiving does to the stored copy. A snapshot is reused, or taken when there is none, in place of the refresh and re-enrichment that archiving queues today. Its flow 1 (new content shown after archiving) no longer holds.
- Package 08 `mcp_server` (active): the new tool `take_snapshot`, and `get_link_content`'s sources.
- Package 09 `export_and_account_deletion` (active): the export's content URLs. Account deletion already removes everything under a link's prefix.
- Package 18 `show_library_statistics` (active): `with_snapshot` and `reader_empty` keep their names, with the meanings above.
- Package 03 `ai_enrichment` (active): taking a snapshot re-enriches the link as a refresh does.
- External: Cloudflare R2 (`SNAPSHOTS`) and Queues (`FETCH_QUEUE`), and every image host an article refers to.

## Verified External API

Read from the installed packages (`node_modules`) on 2026-11-15:

- `@mozilla/readability` 0.6.0 (`index.d.ts`, `Readability.js`): `new Readability<T = string>(document, options?)`; `parse(): null | { title, content, textContent, length, excerpt, byline, dir, siteName, lang, publishedTime }`. `parse()` runs `_fixLazyImages` on the article, which moves lazy-loading `data-src` and `data-srcset` addresses into `src` and `srcset`, and makes `src` and `srcset` addresses absolute. Today's allow-list in `src/worker/fetcher/reader.ts` then drops `srcset`.
- `linkedom` 0.18.15: `parseHTML(html: string)`, used today by `src/worker/fetcher/reader.ts` and `src/worker/fetcher/html.ts`.

## Glossary

- **snapshot**: the copy of a page a link keeps, taken when the owner asks or when a link without one is archived. For a web page: its article's title, byline and sanitised HTML, with the article's images stored beside it and referred to by Alexandria's addresses. For a PDF: the whole file. At most one per link. This supersedes package 02's meaning, the raw HTML.
- **article text**: the plain text of a page's article, or of a PDF, that every fetch stores in `link_texts`, for search, Ask, enrichment and the meaning index.
- **take a snapshot**: a refresh of the link that also stores a new snapshot when it succeeds.
- **placeholder**: what a snapshot shows in place of an image it could not store: the image's alt text and a link to its original address.

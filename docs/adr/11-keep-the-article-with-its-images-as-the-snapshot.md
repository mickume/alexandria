# 11. Keep the article with its images as the snapshot

## Status

Accepted (2026-11-15). Supersedes, in part, the decisions of package 02
(`fetch_and_snapshot`) on what a snapshot is, and of package 14
(`keep_links_in_archive`) on what archiving does to the stored copy.
Described by [PRD 08](../prd/08-keep-a-snapshot-of-a-pages-article-with-its-images.md).

## Context

Every fetch of a web page stored two copies: the raw HTML (the "snapshot",
shown in a sandboxed frame) and a reader view (Readability's article). Neither
kept the page once its site was gone. The raw HTML loaded its stylesheets,
fonts and images from the origin, and the reader view's `<img>` addresses
still pointed at the origin. Every successful fetch replaced both, so an
archived link's refresh could replace a good copy with a paywall or a "page
moved" page.

The owner wants what a reading service keeps: the article alone, its text and
the images that belong to it, downloaded and stored, read in Alexandria as the
page was when they chose to keep it.

## Decision

- **A snapshot is the article with its images stored, or a PDF's file.** It is
  taken when the owner asks (`POST /api/v1/links/{id}/snapshot`, the MCP tool
  `take_snapshot`) or when a link without one is archived. The first fetch of a
  PDF stores the file as its snapshot, as before. A link has at most one.
- **Taking a snapshot is a refresh that also stores the copy.** It fetches the
  page now, updates the metadata, text and enrichment, extracts the article
  as the reader view did, and downloads each image through the host gate (at
  most 100, 10 MB each, 50 MB in all, never through Firecrawl). An image that
  is not stored becomes a placeholder with its alt text and a link to its
  address. One snapshot per link per 10 minutes, apart from refreshes.
- **Only a new snapshot that succeeds replaces one.** A refresh never touches
  it, a PDF's included. Archiving a link that has one fetches nothing. A failed
  snapshot leaves the previous one whole: each snapshot is written to its own
  folder, `u/{user}/l/{link}/s/{snapshot_id}/`, the link is pointed at it in
  one D1 batch, and only then is everything else under the link's prefix
  deleted.
- **There is one reading view.** Read shows the snapshot; the reader view, the
  raw-HTML frame and `GET /api/v1/links/{id}/reader` are removed. Fetches still
  extract the article text into `link_texts`, which search, Ask, enrichment
  and the meaning index read, and `GET /api/v1/links/{id}/text` serves it.
- **The old copies are deleted, not converted.** Migration 0024 makes every
  web page snapshot-less and the stored PDFs snapshots; the every-minute run
  sweeps `reader.json` and the stored raw HTML from R2 once.

Choices the PRD left to the implementation, or where it departs from the PRD:

- The link carries `snapshot_kind` (a refresh can change `content_kind`, not
  the snapshot), `snapshot_error` (the last failure, which the card shows) and
  `snapshot_claimed_at` (the window, kept apart from `snapshot_requested_at`,
  which is cleared when the snapshot ends).
- The PRD names the change feed for following a snapshot being taken. The
  website instead asks for the link every 5 seconds while its
  `snapshot_requested_at` is set, because the change feed leaves archived
  links out, and an archived link's snapshot must update its card on the
  Archive page.
- `snapshot_requested_at` reads null once it is 15 minutes old, so that a
  message the queue gave up on does not keep a page waiting.
- Image names start with the snapshot's id, so that a year's private caching
  of an image never shows an earlier snapshot's.

## Consequences

- A snapshot reads the same whatever becomes of the site: its text and stored
  images come from Alexandria alone.
- The fetcher now requests images, which its public page says. It still
  fetches no stylesheets, scripts, feeds or linked pages, and only for a
  snapshot the owner asked for or an archive.
- An archived link whose site was already gone when this was deployed has no
  readable copy left. The owner chose this over converting the old reader
  views.
- A link fetched but never snapshotted has nothing to read in Alexandria: its
  card offers Open and Take snapshot, not Read.

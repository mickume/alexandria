# 12. Retrieve links through their sites' APIs

## Status

Accepted (2026-11-17). Described by
[PRD 09](../prd/09-retrieve-a-links-metadata-through-its-sites-api.md).

## Context

The fetcher reads what a link is from its HTML page: the `<title>`, the
description meta tag and Readability's article. For some sites that is a
poor account. A YouTube watch page's article is the page's chrome, not the
video's description, and its description tag is cut short. A GitHub page's
title carries the site's own name, which the title rules
(`fetcher/title-rules.json`) patch, and nothing records a repository's stars,
language or state. Both sites publish an API that says exactly what the
thing behind the address is.

## Decision

- **Retrievers.** A retriever (`src/worker/retrievers/`) claims the addresses
  of one site, by exact host and path, and asks the site's API instead of
  fetching the page. `registry.ts` lists them; the first are `github`
  (repositories, issues and pull requests, through the GitHub REST API) and
  `youtube` (videos, through the YouTube Data API v3). A retriever is code
  bundled with the Worker, not loaded at run time: a Worker cannot load code
  at run time, and a retriever needs tests like any code. Adding one is its
  module, its tests and a line in the list.
- **The API's answer is stored as a fetch's.** It goes through the same write
  as a page fetch (`writeFetched`): the site's title, a description, the text
  that search, Ask, enrichment and the meaning index read, and the facts in a
  generic `site` column (`{retriever, kind, retrieved_at, facts}`), each fact
  `{key, label, value, card}`, so that a new retriever adds facts without
  changing the API, the website or the export.
- **A failure falls back to the page, in the same attempt.** Whatever the API
  answers that is not a usable success, the page is fetched as before, and
  the fetch event records why. A link is never worse off for having a
  retriever.
- **The keys are deployment secrets.** `GITHUB_TOKEN` (optional: GitHub
  answers without one, at 60 requests an hour) and `YOUTUBE_API_KEY` (without
  it the YouTube retriever is off). Both APIs are free, so there is no
  per-user cost to attribute, unlike the AI and Firecrawl keys, and secrets
  need no Settings screens or key checks.
- **The API hosts go through the host gate**, under their own names, one
  request a second across all users, with the fetcher's User-Agent.
- **Snapshots still take the page.** A snapshot of a claimed address stores
  the page's article; the API's answer gives the link's metadata.
- **Links stored before a retriever are retrieved once.** The every-minute run
  sends them to the fetch worker, 20 a minute across all users, after any
  import's waiting links, and waits an hour when the API's rate limit or
  quota is spent rather than fall back, since a fallback would leave the link
  scraped for good.

## Consequences

- The addresses of GitHub and YouTube links (repository paths and video ids)
  are sent to those sites' APIs instead of their pages; with a key, the
  requests are made in the deployment's name.
- The title rules stay for pages fetched as pages (fallbacks among them), and
  their re-cleaning of stored titles leaves retrieved titles alone.
- A refused key or a spent limit shows only in each affected link's history,
  as the reason of its fetch: nothing checks a key when it is set.
- YouTube's default quota (10,000 calls a day) is below what the one-time
  retrieval can send in a day; it pauses and resumes, and a library with
  more than 10,000 YouTube links takes more than a day.
- The detail page loads a video's thumbnail from YouTube's image host, the
  one image a detail page loads from another site.

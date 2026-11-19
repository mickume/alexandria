# Retrieve a link's metadata through its site's API

## Intent

For some sites, the HTML page is a poor source of what a link is: a YouTube page's article text is the page chrome, not the video's description, and a GitHub page's title carries the site's own name. Those sites publish an API that says exactly what the thing behind the address is. Alexandria should ask that API, through a site-specific retriever chosen by the link's address, and store what it answers as the link's title, description, text and facts, so that the stream, search, Ask and enrichment work from the site's own account of the thing rather than from a scrape. Adding a retriever for another site is a self-contained change to the Worker, and a link whose site has no retriever, or whose retriever fails, is fetched exactly as today.

## Goals

- A newly added GitHub repository, issue or pull request link, and a YouTube video link, is stored with the title, description and text its site's API returns, within the time a fetch takes today: p95 under 30 seconds from adding the link to its card showing the retrieved title.
- The text stored for a GitHub repository is its README; for an issue or pull request, its body; for a YouTube video, its description. Search, Ask, enrichment and the meaning index read that text with no change of their own: a search for a word that appears only in a repository's README finds the link.
- Every retrieved link carries the facts its site gives (a repository's stars and language, a video's channel, duration and publication date) in the API's `site` field, up to 3 of them on its card, and all of them on its detail page.
- When a retriever cannot answer (its API unreachable, rate limited, refusing its key, or not knowing the thing), the link is fetched as a page in the same attempt, exactly as today, and ends no worse off than it would have without the retriever.
- A retriever for another site is added by adding its module and its tests and registering it in one list; the fetch, refresh, snapshot, enrichment and website code does not change, and the links already in the library that the new retriever claims are retrieved once after it is deployed.
- After this change is deployed, every GitHub and YouTube link already in the library that a retriever claims is retrieved once, at most 20 links a minute.

## Non-goals

- Retrievers for sites other than GitHub and YouTube; each later site is its own change.
- Snapshots through a retriever: a snapshot keeps fetching the page as today ([ADR 11](../adr/11-keep-the-article-with-its-images-as-the-snapshot.md)), so a YouTube video's snapshot still fails with "no readable content". A snapshot built from a retriever's answer is a later PRD.
- YouTube transcripts and captions: the Data API serves them only with OAuth as the video's owner.
- Retrievers loaded at run time, configured by the owner, or written outside the repository: a retriever is code, bundled with the Worker.
- Per-user keys for GitHub or YouTube, and Settings screens for them: the keys are deployment secrets (Design Decision 2).
- Searching or filtering by facts (a `channel:` or `stars:` filter); the facts are not added to the word index or the meaning index.
- Following a GitHub repository or YouTube channel for new items, or any write to either site.
- Authenticating as the owner on either site: private repositories and private or unlisted-but-restricted videos are not retrieved, and fall back to the page fetch.
- Changing the weekly liveness check: it keeps probing the page's address.
- Removing the title rules for GitHub and YouTube: they still clean the titles of pages fetched as pages, the fallback included.

## Background

- **Fetching today.** Adding a link sends `{user_id, link_id}` on `FETCH_QUEUE`. `processFetch` in `src/worker/fetcher/queue.ts` fetches the address (`fetchPage` in `src/worker/fetcher/fetch.ts`: host gate, redirect checks, 15 seconds per request, `User-Agent: Alexandria/1.0 (+<PUBLIC_ORIGIN>/about/fetcher)`), falls back to Firecrawl behind a bot check (`fetchThroughFirecrawl`, [ADR 04](../adr/04-fetch-pages-behind-a-bot-check-through-firecrawl.md)), and stores the result with `storeHtml`, `storePdf` or `storeOther` through `writeFetched`: `title` (unless the owner edited it), `description`, `favicon_url`, `language`, `final_url`, `http_status`, `content_kind`, `reader_empty`, `notes`, and the article text in `link_texts` (at most 500,000 characters). Then `afterFetch` hands the link to enrichment and `queueIndexing` to the meaning index. A refresh (`POST /api/v1/links/{id}/refresh`) and a snapshot (`POST /api/v1/links/{id}/snapshot`) go through the same consumer. Every attempt is a `link_events` row (`kind` `fetch` or `snapshot`, `outcome`, `http_status`, `reason`), shown as the link's history.
- **Metadata from HTML.** `extractMetadata` in `src/worker/fetcher/html.ts` reads `<title>` (else `og:title`), `og:description` (else the meta description), the first icon link and `<html lang>`. The article text is Readability's extraction (`extractReader` in `src/worker/fetcher/reader.ts`).
- **Title rules.** `cleanTitle` in `src/worker/fetcher/titles.ts`, driven by `src/worker/fetcher/title-rules.json`, patches GitHub's and YouTube's titles: "GitHub - owner/repo: description · GitHub" reads "repo: description", an issue or pull request reads "Title · owner/repo#123", and " - YouTube" is removed. The every-minute run (`applyTitleRules`) cleans every stored title again whenever the rules file changes. These rules exist because the HTML title is the only source today; they fix the title and nothing else.
- **What the scrape misses.** A YouTube watch page's article text is not the video's description, and its description meta tag is cut short; a video's channel, duration and publication date, and a GitHub repository's stars, language, topics and archived state, are not stored at all.
- **Keys and secrets.** The AI key and the Firecrawl key are each owner's own, stored encrypted per user (`src/worker/enrich/keys.ts`) and managed under Settings, because each call costs the owner money. Deployment-wide settings and secrets are set with `npm run configure` or `wrangler secret put` (`docs/configuration.md`). Third-party base URLs are variables so tests can run fakes (`FIRECRAWL_API_URL`, `ANTHROPIC_BASE_URL`).
- **Paced background work.** An import's links are dispatched to `FETCH_QUEUE` at 20 a minute (`src/worker/imports/dispatch.ts`); the every-minute run also drives the title-rules backfill and the legacy snapshot sweep, which keeps its cursor in `maintenance_state` and resumes after a failure.
- **Showing a link.** The link JSON (`docs/api.md`, Links) has no field for site-specific facts. A card's facts line (`src/web/components/LinkCard.tsx`) shows the host, dates, state and notes; the detail page (`src/web/pages/LinkDetail.tsx`) has a "Technical details" section. The MCP tools (`src/worker/mcp/tools.ts`) and the export (`src/worker/account/export.ts`) return the same link view.
- **Owner edits.** `PATCH /api/v1/links/{id}` edits `title`, `summary`, `tags` and `topic`; each edited field is listed in `edited_fields`, and no fetch or enrichment overwrites it.
- **Tests.** Outbound requests in Worker tests are answered by `onOutbound(origin, handler)` (`src/worker/test/outbound.ts`); the end-to-end tests send every fetch to `ORIGIN_PROXY_URL` with the target in `X-Alexandria-Target`. The checks are `make check` (format, `tsc --noEmit`, ESLint and Prettier, Vitest) and `make e2e`.

## Requirements

### Choosing a retriever

- Every fetch of a link (its first fetch, a retry, a refresh, the fetch of a snapshot, and the one-time retrieval of existing links) first asks whether a retriever claims the link's address (its normalised `url`). A retriever claims an address by its host (the host itself or a subdomain) and its path, as listed under each site below. At most one retriever claims an address. An address no retriever claims is fetched exactly as today.
- A claimed address is retrieved through the retriever. On success, the retriever's answer is stored (see Storing a retrieved link), the link becomes `active` (or stays `archived`), its history records a `fetch` event with outcome `ok`, HTTP status 200 and no reason, and enrichment and the meaning index follow as after any successful fetch.
- A snapshot of a claimed address is taken from the page as today; the fetch of that snapshot stores the retriever's answer as the link's metadata and text, and the page's article only as the snapshot.
- When the retriever fails, the address is fetched as a page in the same attempt, as today (host gate, redirects, Firecrawl behind a bot check), and what that fetch stores is all the link gets; its `site` field keeps what an earlier successful retrieval stored, if any. The retriever fails, with the failure named as shown, when its API:
  - cannot be reached, or answers any 5xx: "unreachable";
  - does not answer within 15 seconds for a request: "timed out";
  - answers 429, or 403 with its rate limit or quota spent: "rate limited";
  - refuses its key (GitHub 401; YouTube 400 with an invalid key, or any other 403): "key refused";
  - answers that the thing does not exist or is not visible (GitHub 404; YouTube an empty `items` list): "not found";
  - answers any other status, or a body that is not the JSON shape the retriever reads: "unusable answer".
- When the fallback page fetch succeeds, its `fetch` event has outcome `ok` and the reason "<Site> API: <failure>; fetched as the page", for example "GitHub API: rate limited; fetched as the page". When the page fetch fails too, the link fails as today, with the page fetch's own reason.
- A retriever's requests go through the host gate under the API's host name (`api.github.com`, `www.googleapis.com`), so that at most one request per second goes to each API host across all users, and carry Alexandria's User-Agent.

### Storing a retrieved link

- A retrieved link stores:
  - `title`, as each site below gives it, unless the owner edited it. The title rules are not applied to it, and their re-cleaning of stored titles after a rules change leaves a retrieved title alone;
  - `description`, at most 300 characters, cut at a word boundary with "…" when longer;
  - `final_url`, the canonical address of the thing, as each site below gives it;
  - `favicon_url`, `https://github.com/favicon.ico` or `https://www.youtube.com/favicon.ico`;
  - `language`, when the API gives one, else null;
  - `http_status` 200 and `content_kind` `html`;
  - the text in `link_texts` (at most 500,000 characters, cut as today), and `reader_empty` true when there is no text;
  - `notes`: "retrieved through the GitHub API" or "retrieved through the YouTube API";
  - the `site` field (below).
- Every link the API returns carries `site`: null for a link no retriever has retrieved, otherwise `{"retriever", "kind", "retrieved_at", "facts"}`:
  - `retriever`: `github` or `youtube`;
  - `kind`: `repository`, `issue`, `pull_request` or `video`;
  - `retrieved_at`: the time of the last successful retrieval;
  - `facts`: an ordered list of `{"key", "label", "value", "card"}`, each `value` a string as it is shown (for example `{"key": "stars", "label": "Stars", "value": "12.3k", "card": true}`); `card` marks the facts the card shows, at most 3. A fact the API does not give is left out of the list, not given an empty value.
- `site` is in the link view everywhere the link view is: the links API, search results, the MCP tools that return links, and each entry of the export.

### GitHub

- Claims `github.com` (and `www.github.com`) addresses of the forms `/{owner}/{repo}` (a repository, with or without a trailing `/`), `/{owner}/{repo}/issues/{n}` (an issue) and `/{owner}/{repo}/pull/{n}` (a pull request), an issue's or pull request's address with any further path after the number (`/files`, `/commits`). `{owner}` and `{repo}` are GitHub names (letters, digits, `.`, `-`, `_`); an address whose first path segment is one GitHub uses for its own pages (`about`, `apps`, `collections`, `customer-stories`, `enterprise`, `explore`, `features`, `issues`, `login`, `marketplace`, `new`, `notifications`, `organizations`, `orgs`, `pricing`, `pulls`, `search`, `security`, `settings`, `site`, `sponsors`, `topics`, `trending`) is not claimed. Other GitHub addresses (a user, a file, a release, a gist) are fetched as pages.
- A repository: two requests, the repository and its README.
  - `title`: "repo: description", or "repo" without a description;
  - `description`: the repository's description;
  - text: the README's Markdown as written; without a README, no text;
  - `final_url`: the repository's `html_url`;
  - facts, in this order: Stars (`card`; 1,234 shown as "1.2k", 12,345 as "12.3k", 1,234,567 as "1.2M", under 1,000 as the number), Language (`card`), Archived ("yes", `card`, only when archived), Owner, Topics (comma-separated), License (its SPDX id), Last push (the date, `YYYY-MM-DD`).
  - A repository found but whose README request fails with anything other than 404 is still retrieved, without text, and its `fetch` event's reason is "GitHub API: README could not be read".
- An issue or pull request: one request.
  - `title`: "Title · owner/repo#123";
  - `description`: the start of its body;
  - text: its body as written; an empty body, no text;
  - `final_url`: its `html_url`;
  - facts, in this order: State (`card`: "open issue", "closed issue", "open pull request", "closed pull request" or "merged pull request"), Comments (`card`, the number), Author, Opened (the date, `YYYY-MM-DD`).
  - A `/pull/{n}` address that GitHub answers as an issue, or an `/issues/{n}` address answered as a pull request, is stored as what GitHub says it is.
- With the deployment secret `GITHUB_TOKEN` set, every request sends it as a bearer token (5,000 requests an hour); without it, the requests are made without a token (60 requests an hour per client address, often spent), and a spent limit falls back to the page fetch.

### YouTube

- Claims, on `youtube.com`, `www.youtube.com`, `m.youtube.com` and `music.youtube.com`: `/watch?v={id}`, `/shorts/{id}`, `/live/{id}` and `/embed/{id}`; and `youtu.be/{id}`. `{id}` is 11 characters of letters, digits, `-` and `_`; any other form (a channel, a playlist, a search) is not claimed.
- Retrieved with the YouTube Data API, one request, only when the deployment secret `YOUTUBE_API_KEY` is set. Without it, the YouTube retriever claims nothing and YouTube addresses are fetched as pages, exactly as today.
- A video:
  - `title`: the video's title;
  - `description`: the start of its description;
  - text: its description; an empty description, no text;
  - `language`: its default audio language, else its default language, else null;
  - `final_url`: `https://www.youtube.com/watch?v={id}`;
  - facts, in this order: Channel (`card`), Duration (`card`: "m:ss", or "h:mm:ss" from an hour; a live stream without a duration leaves the fact out), Published (the date, `YYYY-MM-DD`), Thumbnail (the address of the largest thumbnail given).

### Configuration

- New deployment secrets, both optional: `GITHUB_TOKEN` (a GitHub token; a fine-grained token with no repository access suffices, as only public data is read) and `YOUTUBE_API_KEY` (a Google Cloud API key with the YouTube Data API v3 enabled). Both can be set with `npm run configure` from `.env` (and are listed in `.env.example`) or with `wrangler secret put`, and in `.dev.vars` locally. Neither is checked when it is set; a key the API refuses shows only as the fallback reason "key refused" in each affected link's history.
- New variables in `wrangler.jsonc`, changed only for tests: `GITHUB_API_URL` (`https://api.github.com`) and `YOUTUBE_API_URL` (`https://www.googleapis.com/youtube/v3`).
- `/about/fetcher` says that for GitHub repositories, issues and pull requests and for YouTube videos, Alexandria asks GitHub's and YouTube's APIs instead of fetching the page, and fetches the page only when the API cannot answer.

### Showing a retrieved link

- A card whose link has `site` shows, on its facts line after the host, the facts marked `card`, in their order, separated by " · ", with a GitHub repository's stars shown as "★ 12.3k" (for example "github.com · ★ 12.3k · TypeScript", "youtube.com · Some Channel · 12:34").
- The detail page shows, above Technical details, a section headed "From GitHub" or "From YouTube" listing every fact as its label and value, with the Thumbnail as an image (loaded from YouTube's address, the one image this page loads from another site) and the date of `retrieved_at` as "Retrieved <date>".
- A link without `site` shows neither, as today.

### Links stored before this change

- Once a retriever is deployed, every link in the library whose address it claims and that it has never retrieved, in any state but `pending` (archived, expired and unreachable links included), is fetched once more, through the retriever, as a refresh is: the owner's edited fields are kept, an archived link stays archived with its snapshot untouched, and enrichment runs again when the stored text changed (using the owner's AI key, as a refresh does). It records no use and changes neither `last_used_at` nor `decay_from`.
- The links are sent at most 20 a minute across all users, after the links an import is dispatching. A link deleted before its turn is skipped. A run that fails part-way is resumed by the next, and no link is sent twice by this retrieval once it has been retrieved or has fallen back.
- During this retrieval only, a retriever answering 429, or 403 with its rate limit or quota spent, does not fall back to the page: the link is left to this retrieval to try again after 1 hour, and the others of that retriever wait with it. Every other failure falls back to the page fetch as described under Choosing a retriever, and the link counts as done.
- A future retriever's deployment retrieves the links it claims in the same way, with no further code for it.

### End-to-end flows

1. The owner adds `https://github.com/acme/widget`. The fake GitHub API answers the repository (description "Widgets for everyone", 12,345 stars, language TypeScript) and its README. The card shows "widget: Widgets for everyone" and "github.com · ★ 12.3k · TypeScript". A search for a word that appears only in the README finds the link. The detail page shows "From GitHub" with every fact, and the history shows a successful fetch.
2. With `YOUTUBE_API_KEY` set, the owner adds `https://youtu.be/{id}`. The fake YouTube API answers the video. The card shows the video's title and "youtube.com · Some Channel · 12:34"; the detail page shows its description and "From YouTube" with the thumbnail.
3. The fake GitHub API answers 503. The owner adds a repository address; the link is fetched as a page through the fake origin and stored as it is today (title cleaned by the title rules, no `site`), and its history's fetch event reads "GitHub API: unreachable; fetched as the page".
4. A GitHub link added before the retriever existed, with an edited title, is retrieved by the one-time retrieval: its title stays the owner's, its card gains the repository's facts, and its `last_used_at` is unchanged.

## Design Decisions

1. **A retriever is code bundled with the Worker, chosen by the link's address and registered in one list.** The "plug-in system" is a module boundary, not run-time loading: a Worker cannot load code at run time, and a retriever needs tests like any code. The owner's request.
2. **The GitHub token and the YouTube key are deployment secrets, not per-user keys.** The owner's decision: both APIs are free, so there is no per-user cost to attribute (unlike the AI and Firecrawl keys), and secrets need no Settings screens or key checks.
3. **Site-specific facts are one generic `site` object with an ordered list of label/value facts.** The owner's decision: a new retriever adds facts without changing the API, the website or the export.
4. **The card shows up to 3 facts the retriever marks; the detail page shows all of them in a "From <Site>" section.** The owner's decision.
5. **Snapshots keep going through the page.** The owner's decision; retriever-built snapshots are a later PRD.
6. **Existing links a retriever claims are retrieved once, in the background, at 20 a minute, and re-enriched when their text changed.** The owner's decision, accepting the AI tokens the re-enrichment uses.
7. **A fallback shows only in the history, as the fetch event's reason.** The owner's decision: the link is no worse off than today, so the card says nothing.
8. **A retriever's failure falls back to today's page fetch in the same attempt.** Decided in this run: the link is never worse off for having a retriever.
9. **Retrieved titles keep the shapes the title rules give today** ("repo: description", "Title · owner/repo#123", the bare video title). Decided in this run: links do not change title when they move from scraping to the API.
10. **Without `YOUTUBE_API_KEY`, YouTube addresses are fetched as pages; without `GITHUB_TOKEN`, GitHub is called without a token.** Decided in this run: YouTube's keyless oEmbed gives no description, which is the point of the retriever, while GitHub answers without a token, only with a lower limit.
11. **A README is stored as Markdown as written, not converted to plain text.** Decided in this run: search, enrichment and the meaning index read Markdown well, and a conversion would add a dependency for no gain.
12. **The one-time retrieval waits on a spent rate limit or quota instead of falling back.** Decided in this run: YouTube's default quota (10,000 calls a day) is below what 20 a minute can send in a day, and falling back would leave those links scraped for good.
13. **The facts are not searchable.** Decided in this run: the word and meaning indexes stay as they are; filtering by a fact is a later change.
14. **The weekly liveness check is unchanged.** Decided in this run: it probes the address the owner saved, which is what the owner opens.

## Dependencies

- Package 02 `fetch_and_snapshot` (active): this changes what a fetch of a claimed address stores, and adds the `site` field to the link view of package 01 `accounts_links_and_stream` (active).
- Package 07 `bulk_import` (active): the one-time retrieval shares the pace of the import dispatcher and yields to it.
- [ADR 04](../adr/04-fetch-pages-behind-a-bot-check-through-firecrawl.md): a claimed address that falls back to the page fetch still falls back to Firecrawl behind a bot check.
- [ADR 11](../adr/11-keep-the-article-with-its-images-as-the-snapshot.md): unchanged; a snapshot of a claimed address is taken from the page.
- The title rules (`src/worker/fetcher/title-rules.json`, `applyTitleRules`): kept for the page fetch; their re-cleaning skips retrieved titles.
- External: the GitHub REST API and the YouTube Data API v3.

## Verified External API

None of these could be called from the session that wrote this PRD (its network does not reach them); each is read from the provider's public documentation and is **unverified** against a live answer. The implementation's tests answer them with fakes built to these shapes.

- GitHub REST API, `GET {GITHUB_API_URL}/repos/{owner}/{repo}`, headers `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent` (required), `Authorization: Bearer <token>` when set: `name`, `full_name`, `owner.login`, `description` (nullable), `stargazers_count`, `language` (nullable), `topics` (array), `license.spdx_id` (`license` nullable), `archived`, `pushed_at`, `html_url`, `private`. 404 for a missing or private repository; 301 for a renamed one. **Unverified.**
- `GET {GITHUB_API_URL}/repos/{owner}/{repo}/readme` with `Accept: application/vnd.github.raw+json`: the README's raw content; 404 without one. **Unverified.**
- `GET {GITHUB_API_URL}/repos/{owner}/{repo}/issues/{n}`: `title`, `body` (nullable), `state` (`open` or `closed`), `user.login`, `created_at`, `comments`, `html_url`, and, for a pull request, `pull_request` with `merged_at` (nullable). **Unverified.**
- GitHub rate limits: 60 requests an hour per client address without a token, 5,000 with one; when spent, `403` or `429` with `x-ratelimit-remaining: 0`. **Unverified.**
- YouTube Data API v3, `GET {YOUTUBE_API_URL}/videos?part=snippet,contentDetails&id={id}&key={key}`: `items[].snippet.title`, `.description`, `.channelTitle`, `.publishedAt`, `.defaultAudioLanguage`, `.defaultLanguage`, `.thumbnails.{default,medium,high,standard,maxres}.url`, `items[].contentDetails.duration` (ISO 8601, such as `PT12M34S`; `P0D` for a live stream); an empty `items` for an unknown or private video; `400` with reason `keyInvalid` for an invalid key; `403` with reason `quotaExceeded` when the day's quota is spent. 1 quota unit per call, 10,000 units a day by default. **Unverified.**

## Glossary

- **retriever**: the part of the fetcher that, for the addresses of one site it claims, asks that site's API what the thing behind the address is, instead of fetching its page.
- **claim**: a retriever claims an address when its host and path are of a form the retriever handles.
- **facts**: the site-specific details a retriever stores about a link (a repository's stars, a video's duration), in the link's `site` field, beside the fields every link has.
- **fallback**: fetching a claimed address as a page, as today, because its retriever failed.
- **one-time retrieval**: the background pass that retrieves, once, the links already in the library that a newly deployed retriever claims.

# Build the Alexandria personal link library

## Intent

Alexandria is a personal, private library of web links for one person at a time. Links are pasted in and kept in a reverse-chronological stream; in the background each one is fetched, summarised, tagged and grouped by topic, and snapshotted so it survives the original site disappearing. Links that are not used sink, get archived and are eventually removed; links that are used, pinned or placed in a workspace stay. Everything the website can do is reachable through an HTTP API and an MCP server, so scripts, agents and a later native app work against the same library. It exists because 600+ open tabs and bookmark folders are no longer manageable and no existing tool combines capture, automatic curation, decay and agent access.

## Goals

- Pasting a URL into the site adds it to the top of the stream within 1 second; its title, summary, tags and topic appear without reload within 60 seconds for a reachable page.
- Every link the owner has not used sinks in the stream by last use, is archived after a fixed period of non-use and removed after a further fixed period, with the owner able to see at any time which state a link is in and why.
- Using a link resets its decay; a link used often enough becomes sticky and never decays; a pinned link is always at the top.
- Every successfully fetched link has a stored snapshot and a cleaned reader view that render even when the original site is down or gone; a link to a PDF has the whole PDF stored and readable.
- Enrichment runs only with the user's own AI provider key, entered once in settings; without one, everything else works and links are simply not enriched.
- A search over title, summary, tags, topic, host and reader-view text returns results in under 500 ms (p95) for a library of 10,000 links.
- Links are grouped automatically by discovered topic and by tag, and manually into workspaces; a link can be in any number of workspaces.
- Dead links are detected by a periodic liveness check and marked as such in the stream.
- A plain-text file of up to 5,000 URLs is imported in one upload, with duplicates reported rather than added.
- Every capability of the website is available through the HTTP API with a personal access token, and the core capabilities through an MCP server, with the same per-user isolation.
- Each user's data is strictly separate: no request, background job, search or MCP call can read or change another user's links.
- The whole library can be exported as a single JSON file, and the account with all its data deleted, by the owner alone.

## Non-goals

- A native iPad / iOS app. It is a later PRD, built on the API this PRD defines; this PRD only requires that the API be sufficient for it (token auth, pagination, snapshot retrieval).
- Sharing, collaboration, public pages, or any cross-user feature. Links are private to one user.
- Cross-user de-duplication of fetching and processing. Each user's URL is fetched and processed for that user alone, even when another user holds the same URL.
- Built-in user management: no passwords, password reset, profile pages, or roles. Identity comes from Google OAuth only. Further OAuth providers are a later PRD.
- Crawling beyond the front page of the pasted URL. Only the page at the URL itself is fetched; linked pages, feeds and sitemaps are not.
- Browser extension, bookmarklet, share-sheet integrations or email-in capture. Capture is the website, the API and the MCP server. (A bookmarklet is trivially built on the API later.)
- Full-fidelity archiving of web pages (images, scripts, screenshots). The snapshot of a web page is its HTML and cleaned text. (A PDF is the exception: it is stored whole, see Reader view and snapshot.)
- Respecting `robots.txt`. Fetching is done on the owner's behalf, as a browser would; the only courtesy is the per-host rate limit.
- Importing browser bookmark exports (the Netscape bookmark HTML format) or other structured formats. Bulk import is a plain-text list of URLs; an HTML importer that keeps folder names as tags is a later PRD.
- Offline / PWA operation of the website itself. The snapshot is for reading when the *origin* is gone, not when the *reader* is offline.
- Analytics, recommendations, or discovery of links the owner did not add.
- Semantic / vector search. Search in this PRD is keyword search; semantic search is a later PRD once there is content to evaluate it on.

## Background

The repository `mickume/alexandria` is a skeleton: `README.md` ("My personal library"), an MIT `LICENSE`, and empty `docs/` and `.specs/` directories. There is no code, no `package.json`, no CI, no existing spec package and no steering file. Every component this PRD names is new.

The owner currently keeps 600+ sites open in browser tabs and folders: sites in daily use, articles to read later, reference material such as API documentation, and duplicates, with no way to tell them apart or to let the stale ones go. The intended feel is a cross between a flexible workspace, GitHub Gists, and a 1995-era Yahoo directory: a flat stream of everything, with automatic categorisation and search layered on top, and manual workspaces for project work.

Constraints the owner has set:

- Constraint: TypeScript throughout. Website in React with Vite; API in Hono; deployed to Cloudflare with `wrangler`. Cloudflare services (Workers, D1, R2, Queues, Cron Triggers, Workers AI, and others) are used where they fit; which ones is for the architecture, not this PRD.
- Constraint: external libraries only from very well-maintained projects with large communities; nothing stale (see Verified External API for the candidates and their last-publish dates).
- Constraint: no built-in user management. Authentication is OAuth 2.0 with Google as the only provider at launch. Only the Google account's email and display name are stored, nothing else from the profile. The one further secret stored per user is the AI provider key the user enters themselves (bring your own key).
- Constraint: strict per-user separation of data and processing.
- Constraint: visual design is minimalistic and modern: one typeface, generous whitespace, no decorative chrome, responsive down to a 375 px wide phone screen, light and dark mode following the system setting.

## Requirements

### Accounts and access

- A visitor who is not signed in sees only a sign-in page with one action: "Sign in with Google". Every other page and every API route returns 401 (API) or redirects to the sign-in page (website).
- Signing in completes the Google OAuth 2.0 authorization-code flow with PKCE. On success the user's email and display name are stored (created on first sign-in, updated on later ones) and a session is established. Nothing else from the Google profile is stored, and the Google access and refresh tokens are not retained after the sign-in completes.
- Only Google accounts whose email address is on an **allow-list** in the deployment configuration may sign in. A Google account not on the list completes the Google flow and is then shown "This library is private"; no user record and no session are created. The allow-list is read on every sign-in; changing it is a configuration change and touches no stored data. Removing an address from the list ends that user's ability to sign in or create tokens at the next request; their existing data is kept until the account is deleted.
- A session lasts 30 days of inactivity and is renewed on use; sign-out ends it immediately. A request with an expired or missing session is treated as not signed in.
- If Google returns an error or the state/PKCE check fails, the user is returned to the sign-in page with the message "Sign-in failed, please try again" and no user or session is created.
- Personal access tokens: a signed-in user can create a token with a name, see the list of their tokens (name, created date, last used date, never the secret again after creation), and revoke one. The secret is shown exactly once at creation. A token authenticates API and MCP requests as that user with the same rights as a session. A revoked token is refused with 401 from the next request on. A user can hold at most 20 tokens; creating the 21st fails with 409 and "token limit reached".
- Account deletion: from the settings page the user confirms deletion by typing their email address; every link, snapshot, workspace, token, session and the stored AI provider key of that user is removed, and the user record with them, within 10 minutes. The user is signed out immediately. There is no undo.

### Adding links

- The main page has one input at the top. The user pastes one URL or several (separated by whitespace or newlines) and presses Enter. Each URL is validated, normalised, and either added at the top of the stream as a new link in state `pending` or, if the normalised URL already exists for that user, the existing link is boosted and moved to the top instead and the user sees "already in your library, moved to top".
- URL normalisation, applied identically everywhere a URL enters (paste, API, MCP, import): trim whitespace; require scheme `http` or `https` (a bare `example.com` is given `https://`); lower-case the scheme and host; drop the fragment; drop a default port; drop these tracking query parameters and no others: every parameter whose name starts with `utm_`, and `fbclid`, `gclid`, `mc_cid`, `mc_eid`; sort remaining query parameters; drop a trailing slash on an otherwise empty path. Duplicate detection is on the normalised URL. The original pasted URL is kept and shown on the link's detail view.
- Invalid input (not a URL, unsupported scheme such as `javascript:`, `file:`, `data:`, a host that is a private or loopback IP address or `localhost`) is rejected with the message "not a valid web address" (website) or 400 with `{ "error": "invalid_url", "url": "<input>" }` (API). In a multi-URL paste, the valid ones are added and the invalid ones listed back.
- A user's library holds at most 20,000 links (all states). Adding past the limit fails with "library full (20,000 links)" / 409 `library_full`.
- The new link appears immediately with its host name as a provisional title and a `pending` indicator; the fetch and enrichment below run in the background and the stream updates in place when they complete, without a reload.

### Fetch, enrich and snapshot

- Within 60 seconds of a link being added (p95), the page at its URL is fetched: method GET, following at most 5 redirects, timeout 15 seconds, response body limit 5 MB, `Accept: text/html, application/pdf`, a User-Agent that identifies the service by name and gives a URL explaining it. Responses with a `text/html` or `application/xhtml+xml` content type are processed as web pages; responses with `application/pdf` (or a URL ending in `.pdf` whose response is a PDF) as PDFs, with a body limit of 50 MB instead of 5 MB. `robots.txt` is not consulted (constraint, owner's decision); the fetcher never makes more than 1 request per second to the same host, across all of a user's links and background jobs.
- From a successful fetch the following are stored for the link: the final URL after redirects, the HTTP status, the page title (`<title>`, falling back to `og:title`, falling back to the host), the description (`og:description` / `meta description`), the favicon URL, the language if declared, the raw HTML (the **snapshot**) and the cleaned reader view (see Reader view). Link state becomes `active`.
- From a successful PDF fetch: the whole PDF file is stored as the snapshot, the title is the PDF's title metadata, falling back to the last path segment; the text of the document is extracted (first 500,000 characters) as the reader-view text, and enrichment runs on it as for a page. A PDF with no extractable text (scanned images) is `active` with a note "no text in this PDF" and no enrichment.
- Enrichment: from the cleaned text, an LLM produces a summary of at most 60 words, 3 to 8 tags (lower-case, single words or hyphenated phrases), and one topic. Tags and topic are drawn from the user's existing tags and topics where one fits and new ones are created where none does, so that vocabulary converges rather than fragments. These are stored on the link and shown in the stream.
- Constraint: **bring your own key.** Enrichment is only ever run with an AI provider key the user has entered on the settings page. Each user chooses a provider, the **Anthropic Claude API** (default, through the official `@anthropic-ai/sdk`) or **OpenRouter** (through its API, so any model it hosts can be used), enters their API key, and optionally a model identifier (default `claude-opus-5-5` for Anthropic; for OpenRouter the user must name a model). Saving the key runs a test request; a key the provider rejects is refused with the provider's message and not stored. The stored key is encrypted at rest, shown only as its last 4 characters afterwards, can be replaced or removed, and is never included in the export, the API or MCP responses. Changing provider, model or key does not re-enrich existing links.
- Without a stored key, fetch and snapshot run as normal and every link skips enrichment; the stream shows such links with "not enriched: add an AI key in settings" once as a banner, not per link. When a key is added later, the user can trigger "enrich all unenriched links" from settings, which processes them at the import rate below.
- Page text sent to the provider is the cleaned reader-view text, truncated to the first 20,000 characters, never the raw HTML, cookies or the user's identity. The provider is called with the user's key and nothing shared between users.
- Manual edits win: a user can edit title, summary, tags and topic on the link detail view. A field a user has edited is never overwritten by later automatic enrichment or re-fetch.
- Failures, each visible on the link as a state and a reason:
  - fetch fails (DNS, connection, timeout, TLS): the link stays `pending` and is retried after 10 minutes and again after 2 hours; after the third failure it becomes `unreachable` with the reason shown ("could not connect", "timed out", ...), keeps its host as title, and can still be pinned, tagged, placed in workspaces and used.
  - HTTP 4xx/5xx: treated like a fetch failure, with the status shown ("HTTP 403").
  - a content type that is neither HTML nor PDF (an image, JSON, a video): the link becomes `active` with title = the final path segment or host, no snapshot and no enrichment, and a note "not a web page (image/png)".
  - page body over 5 MB: the first 5 MB are used, and the link is noted "truncated". PDF over 50 MB: not stored; the link is `active` with a note "PDF too large to store (50 MB limit)" and no enrichment.
  - enrichment fails (provider error, rate limit, model refusal, empty text): the link is `active` with its fetched title and description, no summary/tags/topic, and a "re-run enrichment" action; the enrichment is retried once after 10 minutes automatically. A key the provider starts rejecting (revoked, out of credit) is reported once on the settings page as "your AI key was rejected: <provider message>" and enrichment pauses until the key is replaced; links added meanwhile wait in the unenriched state.
- Re-fetch: the user can request "refresh" on any link; it re-runs fetch and enrichment, replaces the snapshot, keeps manual edits, and records the new fetch time. At most one refresh per link per 10 minutes; a second within that window is refused with "already refreshed recently".

### The stream: ordering, decay, boost, pin

- The main page is the **stream**: pinned links first, then all `active` and `pending` links ordered by **last used** descending (a new link's last used = its added time). The stream is paged, 50 links per page, infinite-scroll on the website and cursor-paged on the API. Each entry shows: favicon, title, host, summary (two lines, expandable), tags, topic, added date, last-used date, state, and actions (open, pin/unpin, archive, add to workspace, edit, delete).
- **Use**: opening a link from the website, API or MCP goes through a per-link "open" endpoint that records a use (increments the use count, sets last used = now) and redirects to the original URL. Using a link resets its decay. Viewing the snapshot or reader view also counts as a use.
- **Decay**: a link not used for 60 days becomes `dormant`: still in the stream, shown dimmed, with "unused for 2 months". A link not used for 120 days is **archived** automatically: it leaves the stream, keeps its snapshot, and is listed on the Archive page with the date it will be removed. A link archived for a further 180 days (300 days unused in total) is **removed**: deleted permanently with its snapshot. Thresholds are per user settings with these defaults, each between 7 and 3650 days.
- **Sticky**: a link with at least 5 uses on at least 5 distinct days is sticky: it never becomes dormant or archived by decay; the stream marks it. A pinned link and a link that belongs to at least one workspace are likewise never archived by decay (they can become dormant and show as such). Manual archive and manual delete always work regardless.
- **Pin**: a link can be pinned; pinned links form the top section of the stream in manual order (drag on the website, an explicit `position` on the API). At most 30 pinned links; pinning the 31st fails with "unpin something first" / 409 `pin_limit`.
- **Archive page**: lists archived links newest-archived first with the same search as the stream; each can be **restored** (back to `active`, last used = now) or deleted. Removal by decay runs once a day; a link restored before that is kept.
- **Delete**: removes the link and its snapshot immediately. On the website a 10-second undo toast follows; on the API deletion is immediate and final.
- Decay and liveness evaluation runs at least once per day for every user; a link's shown state is never more than 24 hours stale.

### Search and browse

- A search box on every page. A query matches, case-insensitively, against title, summary, tags, topic, host, the original URL and the reader-view text; results are ordered by relevance with pinned and recently used links breaking ties; each result shows the same card as the stream plus a highlighted matching snippet. Prefix filters narrow the query: `tag:foo`, `topic:bar`, `host:example.com`, `state:archived`, `in:workspace-name`, `is:pinned`, `is:dead`. Archived links are included only with `state:archived` or `state:any`.
- Empty query shows the stream; a query with no match shows "nothing found for <query>" and the active filters. Queries are capped at 200 characters.
- **Topics** page: every topic with its link count, newest first within a topic; clicking opens the stream filtered to that topic. **Tags** page: the same for tags. A topic or tag with zero links disappears.
- A user can rename or merge topics and tags (merging moves every link to the surviving one). Automatic enrichment of later links uses the renamed vocabulary.

### Workspaces

- A user can create workspaces (name, up to 100 characters, unique per user, optional one-paragraph description), rename and delete them, and add or remove any link to or from any number of workspaces. Deleting a workspace never deletes its links. At most 200 workspaces per user.
- A workspace page shows its links in manual order: a newly added link goes to the bottom, and the user reorders by drag on the website or with an explicit `position` on the API.
- Notes: a workspace carries one Markdown note (shown above its links) and every link carries one Markdown note (shown on its detail view and, as a first line, on its card); each is up to 20,000 characters, rendered as Markdown with scripts and raw HTML stripped, editable in place, and included in search. A note over the limit is refused with "note too long (20,000 characters)" / 400 `note_too_long`.
- Membership in a workspace exempts a link from decay archiving (see Stream). The stream card shows the workspaces a link is in.

### Liveness

- Every `active`, `dormant` and pinned link is re-checked every 7 days: HEAD then GET on failure, 10-second timeout, at most 5 redirects, never more than 1 request per second per host. A check passes on HTTP 2xx or 3xx (ending in 2xx). A link that fails 3 consecutive weekly checks is marked **dead** with the last status or error, shown in the stream with a strike-through title and "dead since <date>"; its snapshot and reader view remain available. A dead link that passes a later check is cleared automatically. The user can trigger a check for one link on demand (same 10-minute rate limit as refresh).
- Archived links are not checked. A dead link follows the normal decay rules; being dead does not itself archive or remove it.
- If the liveness run cannot complete for a user (platform limit, outage) the links keep their previous state and are checked on the next run; nothing is marked dead on the strength of a failed run.

### Bulk import

- The settings page accepts a file upload: plain text (UTF-8) with one URL per line; blank lines and lines starting with `#` are ignored; anything after the first whitespace on a line is ignored, so a line like `https://example.com some note` imports the URL alone. Any other file type (HTML, JSON, binary) is refused with "only plain-text files with one URL per line are accepted" and nothing is imported.
- Limits: file at most 2 MB and 5,000 URLs; over either, the upload is refused with "too large: at most 5,000 URLs / 2 MB per import" and nothing is imported.
- Processing: each line is normalised and added as in Adding links; the user sees a progress view with counts of added, duplicates (not added, not boosted) and invalid lines, the invalid lines listed with their line numbers, and a downloadable report. Imported links enter the stream with last used = import time, in file order (the first line of the file ends up highest), so a file sorted by the owner is honoured.
- Fetch and enrichment of imported links run in the background at no more than 20 links per minute per user (a 600-line import completes in about 30 minutes), and the stream updates as they complete. The same 20,000-link library limit applies; an import that would cross it stops at the limit and the report says so.
- The import is accepted via the API as well (`POST` of the file) with the same report returned as JSON.

### Reader view and snapshot

- For every link with a snapshot the website offers "Read" (the cleaned reader view: article title, byline and body text with headings, lists, code blocks, links and inline images referenced by their original URL, nothing else) and "Snapshot" (the raw stored HTML rendered in a sandboxed frame with scripts disabled). Both work when the origin is unreachable. Both count as a use.
- For a PDF link, "Read" shows the extracted text and "Snapshot" serves the stored PDF itself, inline in the browser's PDF viewer, with a download action.
- Cleaning uses a Readability-style extraction. If extraction yields fewer than 200 characters of text, the reader view says "no readable content extracted" and offers the snapshot instead; enrichment then uses the page title and description only.
- Reader-view text is stored and indexed for search; the stored text is capped at 500,000 characters per link.
- Snapshots and reader views are deleted with their link, and are never served to any user other than the owner.

### HTTP API

- Every website capability is an authenticated JSON HTTP API under one base path, versioned in the path (`/api/v1/`). Authentication is a session cookie (website) or `Authorization: Bearer <personal access token>` (everything else). An unauthenticated request gets 401 `{ "error": "unauthorized" }`; a request for another user's resource gets 404, never 403, so existence is not leaked.
- Resources: links (list with cursor pagination, filters mirroring the search prefixes, create, get, update editable fields, delete, open, refresh, check, pin/unpin, archive/restore), search, topics, tags, workspaces and their membership, imports, tokens, the export, and the current user. Each list endpoint returns at most 100 items per page with an opaque cursor.
- Validation errors return 400 with `{ "error": "<code>", "field": "<name>", "message": "<text>" }`; limits return 409 with their code (`library_full`, `pin_limit`, `token_limit`, ...); rate limits return 429 with `Retry-After`. The rate limit is 600 requests per minute per user.
- The API is described by an OpenAPI 3.1 document served at a documented path and kept in step with the implementation (a test fails when they differ).
- Export: `GET` of the export returns a single JSON document with every link (all fields, all states, manual edits, use counts), workspace, topic and tag of the user; snapshots are not included in the JSON but each link carries a URL from which its snapshot and reader view can be fetched with the same token. For 20,000 links the export completes in under 60 seconds.

### MCP server

- An MCP server over the Streamable HTTP transport, authenticated with the same personal access tokens, exposes to agents: `add_link(url, tags?, workspace?)`, `search_links(query, limit?)`, `get_link(id)` (metadata and summary), `get_link_content(id, format: "text" | "html")` (reader-view text or snapshot), `list_workspaces()`, `add_to_workspace(link_id, workspace)`, `pin_link(link_id)`, `archive_link(link_id)`, and `list_recent(limit?)`. Each tool returns the same shapes and the same errors (as structured tool errors, not exceptions) as the API, and each counts a use where the API would.
- Every MCP action is bound to the token's user; there is no tool that can address another user's data. An invalid token fails the connection with 401.
- The server's instructions text tells an agent what the library is and that `search_links` should be tried before `add_link` to avoid duplicates (the server de-duplicates anyway).

### Website

- Pages: sign-in, stream (home), archive, topics, tags, workspaces (list and one workspace), link detail (with edit, read, snapshot, history of uses and fetches), search results, settings (AI provider and key, tokens, decay thresholds, import, export, delete account). Keyboard: `/` focuses the search box from any page and `Escape` clears it and returns focus to the page; there are no other shortcuts.
- Responsive from 375 px wide; light/dark follows the system; the stream's first page is interactive within 1.5 seconds on a 4G connection (Lighthouse "Performance" at or above 90 on the stream with 50 links).
- End-to-end flows the system must support unbroken:
  1. The owner signs in with Google, enters an Anthropic API key in settings and sees "key verified", pastes `https://example.com/article?utm_source=x`, sees it at the top as `example.com` / pending; within a minute the card shows the title, summary, tags and topic; the owner clicks the title, is redirected to the article, and the card now shows last used = now.
  2. The owner uploads a 400-line text file; a progress view counts added/duplicates/invalid; the stream fills in over the following minutes; the report lists the 3 malformed lines.
  3. An agent with a personal access token calls `search_links("cloudflare queues")` through the MCP server, gets two links, calls `get_link_content` on one and receives the reader-view text; the link's last used is updated.
  4. A link unused for 120 days disappears from the stream and appears on the Archive page with its removal date; the owner restores it; it is back at the top of the stream.
  5. A site goes offline; after three weekly failed checks its card is struck through; "Read" still shows the stored article.

## Design Decisions

1. **"Archive" and "snapshot" are separate things.** Every successfully fetched link gets a snapshot immediately; "archived" is a lifecycle state (out of the stream, retained, scheduled for removal). This resolves the two senses of "archive" in the input. (Proposed.)
2. **Use is recorded through a redirect endpoint**, not client-side tracking, so the website, API, MCP and a later iOS app record uses the same way. (Proposed.)
3. **Duplicates on paste boost the existing link** rather than being refused or added, because re-pasting is a signal of use. On bulk import duplicates are only reported, because an import is not a use. (Proposed.)
4. **Decay is driven solely by last use** (plus the sticky/pin/workspace exemptions), not by a computed score, so the owner can always see why a link is where it is. (Proposed.)
5. **Enrichment runs on the Anthropic Claude API by default, with OpenRouter as the alternative provider**, chosen per user in settings together with the model. Owner's decision; Workers AI was considered and rejected for weaker summaries and tag discipline. Default model `claude-opus-5-5`; a cheaper model is a per-user setting, not a code change.
6. **Sign-in is allow-listed**, not open. Owner's decision: this is a personal site, and open sign-up would make it a hosting service with abuse, cost and data-protection consequences.
7. **Decay thresholds**: dormant at 60 days, archived at 120, removed after a further 180; sticky at 5 uses on 5 distinct days; 30 pinned links. Owner's decision, accepting the proposed defaults; every threshold is a per-user setting.
8. **Bulk import is plain text only.** Owner's decision; the browser's HTML export is a later PRD. Imported links take the import time as last used, in file order, because a plain list carries no dates.
9. **Bring your own key.** Enrichment never runs on a shared or deployment-wide key; each user enters their own Anthropic or OpenRouter key in settings. Owner's decision: it keeps the operator's cost at zero for AI, and puts the data-sharing choice with the person whose pages are sent.
10. **PDFs are in scope and stored whole**, up to 50 MB, with text extracted for reading, search and enrichment. Owner's decision ("store the entire PDF"); the 50 MB figure is mine and is a per-deployment limit.
11. **robots.txt is not consulted**; the per-host rate limit of 1 request per second is the only courtesy. Owner's decision.
12. **Workspaces are manually ordered and carry Markdown notes**, one per workspace and one per link. Owner's decision.
13. **The tracking parameters stripped are exactly `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`.** `ref` and `source` are kept because some sites use them meaningfully. Owner's decision.
14. **Session length 30 days of inactivity**, renewed on use. Owner's decision.
15. **Background processing is throttled to 20 links per minute per user** for imports and "enrich all". Owner's decision ("slower" than the proposed 60); the figure keeps a 5,000-link import under 5 hours and the provider call rate at one every 3 seconds.
16. **Two keyboard shortcuts only**, `/` and `Escape`. Owner's decision; a clipboard-paste shortcut was rejected because it needs a browser permission prompt.
17. **A split into several spec packages is expected**: the requirement areas above exceed what one package holds. The foundational package is Accounts and access + Adding links + the stream (ordering, pin, delete) with the HTTP API for those; fetch/enrich/snapshot, decay and liveness, search and browse, workspaces, bulk import, reader view, MCP server and export each follow as packages that can be built and tested on their own.

## Dependencies

None: the repository has no existing packages, ADRs or PRDs. External systems: Google OAuth 2.0 (identity), Cloudflare (hosting and storage), the Anthropic Claude API (enrichment, default) and OpenRouter (enrichment, alternative).

## Verified External API

No `package.json` exists yet, so no symbol signatures could be read from installed sources; every entry below is **unverified** at the signature level. What was verified, against the npm registry on 2026-11-07, is that each candidate is currently published and maintained:

| Package | Version | Last publish | Role |
|---|---|---|---|
| `hono` | 4.13.17 | 2026-11-07 | API framework (constraint) |
| `@anthropic-ai/sdk` | 1.6.0 | 2026-11-05 | enrichment, default provider (constraint) |
| `@openrouter/sdk` | 1.5.64 | 2026-11-07 | enrichment, alternative provider (constraint); OpenRouter's HTTP API is the fallback if the SDK does not run on Workers |
| `@hono/oauth-providers` | 0.9.1 | 2026-10-28 | Google OAuth flow for Hono, option 1 |
| `arctic` | 3.7.0 | 2026-07-29 | Google OAuth flow, option 2 (provider-agnostic, PKCE) |
| `@modelcontextprotocol/sdk` | 1.32.2 | 2026-10-23 | MCP server |
| `agents` (Cloudflare) | 0.33.0 | 2026-11-03 | MCP on Workers, alternative host for the SDK |
| `@mozilla/readability` | 0.6.0 | 2025-03-03 | reader-view extraction (slow-moving but the reference implementation) |
| `linkedom` | 0.18.15 | 2026-11-01 | DOM for Readability on Workers |
| `unpdf` | 2.1.0 | 2026-10-30 | PDF text extraction on Workers (wraps `pdfjs-dist` 6.5.438, 2026-11-01) |
| `wrangler` / `@cloudflare/workers-types` | 4.158.0 / 5.20261107.1 | 2026-11-05 / 2026-11-07 | deploy and types (constraint) |
| `vite` / `@cloudflare/vite-plugin` | 8.3.6 / 1.67.0 | 2026-11-05 | website build (constraint) |
| `react` / `react-dom` | 19.3.1 | 2026-11-06 | website (constraint) |
| `zod` / `@hono/zod-validator` | 4.6.7 / 0.9.1 | 2026-10-12 / 2026-08-31 | request validation |
| `drizzle-orm` | 0.45.4 | 2026-10-21 | D1 access, candidate |
| `jose` | 6.2.15 | 2026-11-01 | token/JWT handling, candidate |

Rejected: `@openauthjs/openauth` (last publish 2025-03, stale); `better-auth` (well maintained but is a full user-management system, which the constraint excludes).

## Glossary

- **link**: one URL in a user's library, with its metadata, state and snapshot.
- **stream**: the home page listing, pinned links first then by last use descending.
- **use**: an open, read or snapshot view of a link, recorded with a timestamp; the unit decay is measured against.
- **boost**: resetting a link's last use to now (what a use, a re-paste or a restore does).
- **decay**: the progression active → dormant → archived → removed, by days since last use.
- **sticky**: a link with enough uses that decay no longer archives it.
- **pinned**: a link held in the manually ordered section at the top of the stream.
- **dormant**: an active link unused for longer than the dormant threshold, shown dimmed.
- **archived**: a link out of the stream, retained with its snapshot, scheduled for removal.
- **dead**: a link whose URL has failed three consecutive liveness checks.
- **snapshot**: the raw HTML stored at fetch time.
- **reader view**: the cleaned, content-only rendering extracted from the snapshot.
- **enrichment**: the background step that produces summary, tags and topic.
- **topic**: the single automatically assigned category of a link; **tag**: one of several automatically or manually assigned labels.
- **workspace**: a user-created, manually ordered collection of links for a project.
- **personal access token**: a user-created secret that authenticates API and MCP requests as that user.
- **AI key**: the user's own Anthropic or OpenRouter API key, stored for enrichment (bring your own key).

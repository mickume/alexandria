# Architecture

Alexandria is one Cloudflare Worker with a D1 database. The decisions behind
the layout are in [ADR 01](adr/01-build-on-a-cloudflare-worker-with-d1.md).

## Components

```
browser ──► Worker (src/worker/index.ts)
              ├── /api/v1/*   the JSON API (Hono)
              ├── /auth/*     sign-in with Google, sign-out
              ├── /about/*    public pages (the fetcher)
              └── pages       website's static assets (dist/client), after the session check
                     │
                     ├──► D1 (DB)          users, sessions, tokens, links, link_uses, rate_limits, …
                     ├──► FETCH_QUEUE ──► queue consumer ──► HOST_GATE (one DO per host) ──► origin sites
                     └──► R2 (SNAPSHOTS)   snapshots and reader views
```

- **The Worker** (`src/worker/`): `index.ts` is the entry point and hands every
  request to the Hono application built in `app.ts`, which mounts the API
  under `/api/v1/` (behind authentication and the rate limit), the sign-in
  routes under `/auth/`, and the website's pages. `env.ts` declares the
  bindings and variables, `clock.ts` the injectable clock. Feature code lives
  in one directory per area:
  - `auth/`: sign-in with Google (`google.ts`, `allowlist.ts`), sessions
    (`sessions.ts`), personal access tokens (`tokens.ts`), the authentication
    middleware and the page guard (`middleware.ts`), and their routes.
  - `api/`: the error envelope (`errors.ts`), the rate limit (`ratelimit.ts`),
    signed cursors (`pagination.ts`) and the OpenAPI document (`openapi.ts`).
  - `links/`: URL normalisation (`normalize.ts`), the link store with adding,
    pinning and deleting (`store.ts`), the stream (`stream.ts`), uses and
    history (`use.ts`), and the routes.

## Sign-in

`GET /auth/google` starts Google's OAuth 2.0 authorization-code flow with PKCE
(`auth/google.ts`, through `arctic`), keeping the state and the code verifier
in ten-minute HttpOnly cookies scoped to `/auth/`. `GET /auth/google/callback`
checks the state against its cookie, exchanges the code with the verifier,
reads the email and display name from the ID token and drops every token
Google returned. The email is checked against `ALLOWED_EMAILS` at that moment
(`auth/allowlist.ts`); an address not on it is sent to `/signin?error=private`
and nothing is stored, any other failure to `/signin?error=failed`. On success
the user is created or their display name updated, and a session is created
(`auth/sessions.ts`) whose identifier is stored only as its SHA-256 hash; the
identifier goes to the browser in the `alexandria_session` cookie (HttpOnly,
Secure, SameSite=Lax, 30 days).

The end-to-end tests point `GOOGLE_AUTH_URL` and `GOOGLE_TOKEN_URL` at
`e2e/fake-google.ts`, a local fake provider that signs in one configured
account and checks the PKCE verifier as Google does.
- **The website** (`src/web/`): a React single-page application built by Vite.
  `main.tsx` mounts `App.tsx`, which picks the page for the current path:
  `pages/SignIn`, `pages/Stream` (the add input, the cards, infinite scroll,
  pinning by drag, deleting with undo), `pages/LinkDetail` and
  `pages/Settings` (tokens), `pages/Search` (the results of the search box,
  `components/SearchBox`, which every page's header carries and which owns the
  `/` and Escape keys), and `pages/Topics` and `pages/Tags`
  (`components/VocabularyList`). `App.tsx` follows the path and the query
  string. `api.ts` is the client of the API, `format.ts`
  formats dates. `styles.css` holds the whole visual design: one system
  typeface, light and dark from `prefers-color-scheme`.

## Data

| Table | Holds |
|---|---|
| `users` | email (lower-case) and display name, nothing else from Google |
| `sessions` | the SHA-256 hash of each session id, its user and expiry |
| `tokens` | the SHA-256 hash of each token secret, its name, dates and revocation |
| `links` | per user: normalised and original URL, host, title, state, dates, use count, pin position |
| `link_uses` | one row per use of a link |
| `link_events` | one row per fetch attempt: time, outcome, HTTP status, reason |
| `link_texts` | the reader-view text of a link, for search and enrichment |
| `workspaces` | per user: name (unique ignoring case through `name_key`), description, Markdown note |
| `workspace_links` | the members of each workspace, at positions 1..n |
| `rate_limits` | requests per user per minute |
| `link_search` | the FTS5 full-text index: one row per link (see Search) |
| `link_search_keys` | the index row id of each link |
| `workspace_search`, `workspace_search_keys` | the FTS5 index of workspaces' names, descriptions and notes |
| `topic_aliases`, `tag_aliases` | per user: the former names of renamed and merged topics and tags, each with its survivor |

Every query of a user's resources is filtered by the authenticated user, so
another user's id is answered exactly as a missing one.
- **The database** (`migrations/`): plain SQL migrations applied in order.

## Fetching

Adding a link sends one message `{user_id, link_id}` on `FETCH_QUEUE`
(`links/routes.ts`). The queue consumer (`fetcher/queue.ts`, the Worker's
`queue` handler) processes a batch's messages concurrently. Each fetch
(`fetcher/fetch.ts`) sends a GET with `Accept: text/html, application/pdf` and
`User-Agent: Alexandria/1.0 (+PUBLIC_ORIGIN/about/fetcher)`, follows at most 5
redirects by hand and refuses any target that is not a public http(s) address
(the normaliser's address rules), and gives each request and its body 15
seconds. Before every request it waits for the host gate
(`fetcher/hostgate.ts`): one Durable Object per host name hands out slots at
least one second apart, across all users and jobs. `robots.txt` is not read.
`GET /about/fetcher` is the public page that explains the fetcher.

What a fetch stores (`fetcher/queue.ts`): for a web page, its metadata
(`fetcher/html.ts`), the raw HTML as the snapshot and the reader view
(`fetcher/reader.ts`: Readability over a linkedom DOM, sanitised by an
allow-list) in R2 under `u/{user_id}/l/{link_id}/` (`snapshot`,
`reader.json`), and the reader text (at most 500,000 characters) in
`link_texts`; for a PDF, the whole file and its text (`fetcher/pdf.ts`,
unpdf); for anything else, a note and no snapshot. Objects are written first,
then the row in one D1 batch; a link deleted meanwhile leaves nothing, and a
failed write removes what the attempt wrote and hands the message back. A
failed first fetch is retried after 10 minutes and 2 hours, then the link is
`unreachable`; a failed refresh changes nothing but the history. Every
attempt is a `link_events` row.

Read and Snapshot (`fetcher/routes.ts`) serve only what is stored, to the
owner alone, and record a use. The stream keeps cards current by polling
`GET /api/v1/links?changed_since=` every 5 seconds while a card is pending or
refreshing; every write to a link sets its `updated_at`.

## Enrichment

When a fetch (first or refresh) makes a link `active`, the fetch worker hands
it to enrichment (`enrich/queue.ts`, `afterFetch`): a link whose notes say it
has nothing to read is `skipped`; without an AI key it is `no_key`; while the
key is rejected it is `waiting_for_key`; otherwise it is `queued` and one
`ENRICH_QUEUE` message is sent. The enrichment worker (the Worker's `queue`
handler for `alexandria-enrich`) decrypts the user's own key
(`enrich/keys.ts`: AES-GCM under `KEY_ENCRYPTION_KEY`, the user id as
additional data), builds the request (`enrich/enrich.ts`: instructions, title,
host, the user's 100 most used topics and 300 most used tags, and the first
20,000 characters of the reader text, or the title and description), asks
the user's provider for a structured result (`enrich/providers.ts`: a forced
tool call through `@anthropic-ai/sdk`, or a JSON-schema response format
through OpenRouter's HTTP API), normalises it, resolves the names against the
user's vocabulary (`enrich/vocabulary.ts`), and stores summary, topic and
tags (`topics`, `tags`, `link_tags`). Links are read through the
`link_views` view, which adds the topic's name and the tags in order.

### The background throttle

Background enrichment ("enrich all") goes through
`enrich/throttle.ts`: `scheduleThrottled` reserves a user's slots 3 seconds
apart (at most 20 a minute), starting at the user's next free slot
(`users.throttle_next_at`) or now, in one statement so concurrent calls never
share a slot; users are independent. `sendThrottled` sends each message with
its slot and the delay to it, at most the queue's 12 hours; a message that
arrives before its slot is sent again for the time left instead of being
processed. A single pasted link is not throttled.

## Imports

`POST /api/v1/imports` (`imports/`) reads the file (`parse.ts`), adds its new
URLs as pending links within the request (`imports.ts`, in D1 batches of 500)
and records the import: `imports` holds the report, `import_links` each added
link with its line, when it was sent to the fetch worker (`dispatched_at`)
and whether it was skipped. The links are not sent to the fetch worker by the
add; the import dispatcher (`dispatch.ts`) sends them:

- once at the end of the upload request, then every minute from the
  `* * * * *` Cron Trigger for every user with links waiting;
- earlier imports first, each in line order, all at once with no delay;
- at most 20 of a user's imported links in any 60 seconds (counted from
  `dispatched_at`), less the 'enrich all' slots that may fall within a minute
  of now (estimated from `throttle_next_at`, from a minute before now);
- a link deleted meanwhile is gone from `import_links` (cascade); one that
  another action already sent (it left `pending`, or was refreshed or fetched)
  is marked skipped and uses no budget;
- after sending, `users.import_window_end` is set a minute ahead, and
  `scheduleThrottled` starts no 'enrich all' job before it, so the two share
  the budget.

Each sent link is then fetched, and enriched after its fetch, as any added
link is. A link pasted or added through the API during an import goes to the
fetch worker at once, outside the budget.

## Decay

Every hour a Cron Trigger (`0 * * * *`) runs the Worker's `scheduled` handler
(`decay/cron.ts`). It evaluates decay for every user whose last completed
evaluation (`users.last_decay_at`) started 20 hours or more ago, one user at a
time. One user's evaluation (`decay/decay.ts`) is a single D1 transaction of
set-based statements, each carrying its own conditions, so a link boosted
meanwhile keeps what the boost gave it and a failed evaluation changes
nothing (that user is evaluated again at the next run):

- a sticky dormant link (at least 5 uses on 5 UTC days) becomes `active`;
- an `active` link unused for `dormant_days` that is not sticky becomes
  `dormant` (pinned and workspace links too);
- a link unused for `archive_days` that is neither sticky, pinned nor in a
  workspace is `archived` (`archived_at` set; it leaves the stream);
- an archived link archived `remove_days` ago is removed with everything
  `DELETE /api/v1/links/{id}` removes, its stored R2 objects deleted after the
  transaction;
- `last_decay_at` is set.

A use, a re-paste or a restore makes a dormant link active in its own
request. `decay/note.ts` gives every link its `decay_note`.

### Liveness

The same hourly run enqueues one `LIVENESS_QUEUE` message per link due a
weekly check (`decay/liveness.ts`): kept, active, dormant or pinned, last
checked (or, never checked, added) 7 days ago or more, and not enqueued in
the last 6 hours (`check_enqueued_at`, set in the selecting statement). The
consumer drops a message for a link deleted, archived or no longer due;
otherwise it sends HEAD through the fetcher's request path
(`fetcher/fetch.ts`, `requestFollowing`: blocked addresses refused, at most 5
redirects, `ORIGIN_PROXY_URL`, and the host gate shared with fetches), and
when the HEAD fails a GET that reads only the headers. A final 2xx passes:
the failure count resets and `dead_since` clears. Any other answer counts one
failure; the third in a row sets `dead_since`. A failure of Alexandria's own
(the host gate unavailable, a write failing) is thrown: the message is
retried and nothing on the link changes.

## Search

`link_search` (`migrations/0006_search_index.sql`) is an FTS5 table with the
`unicode61` tokenizer removing diacritics. It holds one row per link with the
columns `title`, `tags` (the tag names, space-separated), `topic`, `summary`,
`host`, `original_url`, `note` and `reader_text`, then `owner`, the term `u`
followed by the user's id without hyphens, and the link's id, unindexed.
Every query matches the owner term, so the full-text match itself cannot
return another user's link. Links have text ids, so `link_search_keys` gives
each link the integer row id of its index row, which every write looks up.

Triggers keep the index current, so no writer can forget it:

- a link inserted gets its row; a link deleted (by the API or by decay's
  removal) loses it;
- a change to a link's title, summary, host, original URL, note or topic
  rewrites those columns (only when one of them really changed);
- a `link_tags` row inserted or deleted rewrites the link's `tags`;
- renaming a topic or a tag rewrites the rows of the links that carry it.

Three more triggers delete a topic or tag whose last link loses it: a
`link_tags` row deleted (an edit, a merge, decay's removal, or a link deleted,
through the cascade), a link's topic changed, and a link deleted. Writers
therefore never empty a link's tags before setting them:
`enrich/vocabulary.ts`'s `setTagsStatements` removes only the tags the link
loses and upserts the rest with their positions.

The reader-view text is written by the fetch worker in the batch that stores
it in `link_texts` (`search/search.ts`, `indexReaderTextStatement`): at most
its first 500,000 characters, replacing what was indexed before, and nothing
when a fetch stores no text. The migration indexed the links and texts stored
before it.

## MCP server

`/mcp` (`mcp/server.ts`) serves the Model Context Protocol over Streamable
HTTP with the official SDK (`@modelcontextprotocol/sdk`). Every POST builds a
new `McpServer` and a `WebStandardStreamableHTTPServerTransport` (no session
id generator, JSON responses) bound to the request's user; nothing is kept
between requests. `requireToken` (`auth/middleware.ts`) accepts only a bearer
token, and the API's `rateLimit` counts the request once.

The tools (`mcp/tools.ts`) do no work of their own: each sends the equivalent
requests to the API sub-application in the same Worker, as the agent's user.
Those requests are `Request` objects the Worker creates and records in
`internalRequests` with their user; `requireAuth` takes the user from there
and `rateLimit` does not count them. So a tool's shapes, errors, limits and
use recording are the API's by construction. The server registers the tools
with `registerTool` (for `tools/list`) and handles `tools/call` itself, so
that argument errors and unexpected failures are tool errors in the API's
envelope.

## Export and account deletion

`GET /api/v1/export` (`account/export.ts`) streams the library as one JSON
document from a `ReadableStream` fed page by page (100 links a query, in id
order); each link is serialised by the same `toFullView` as
`GET /api/v1/links/{id}`, and a read error errors the stream, so that a cut-off
download lacks the closing `"complete": true`. The export's content URLs
(`/api/v1/export/links/{id}/snapshot` and `/reader`) serve through the same
`snapshotResponse` and `readerBody` as the link routes (`fetcher/routes.ts`),
without `recordUse`.

`DELETE /api/v1/me` (`account/deletion.ts`), with a session only, deletes the
user's sessions, tokens and AI key at once, sets `users.deletion_requested_at`
and sends a message on `ACCOUNT_QUEUE`. Each message is one run of the
deletion job (`runDeletion`):

- one batch of at most 1,000 of the user's R2 objects under `u/{user_id}/`;
- one batch of at most 1,000 rows from each table that holds the user's rows,
  found from the schema (every table with a `link_id` or `user_id` column,
  except full-text tables and the tables triggers keep): rows referencing the
  user's links first, then the links once none references them (their
  triggers remove their search index rows), then the rest;
- when nothing is left, the users row.

A run that removed a full batch anywhere queues the next run. A failed run is
retried and continues with what remains; a run for an account that is gone
(or not marked) does nothing. A sign-in for a marked account is refused. The
`*/5 * * * *` Cron Trigger (`account/sweep.ts`) runs the job for every account
marked more than 5 minutes ago, so that a lost message cannot stop a deletion.

Nothing in the background writes for an account once it is marked:
`accountActive` is checked by the fetch consumer (before fetching and again
before writing), the enrichment consumer, the import dispatcher and the
liveness consumer (before checking and before recording), and the hourly
decay evaluation and the liveness enqueue select only accounts not marked.
Their messages are acknowledged, not retried.

## Test layers

| Layer                       | Where                     | Runs in                                           | What it proves                                                      |
| --------------------------- | ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| Worker unit and integration | `src/worker/**/*.test.ts` | workerd via `@cloudflare/vitest-plugin`, local D1 | Routes, middleware, SQL and pure functions, through the real Worker |
| Website                     | `src/web/**/*.test.tsx`   | jsdom, fake API                                   | Pages and components                                                |
| End to end                  | `e2e/*.spec.ts`           | Playwright (Chromium) against `wrangler dev`      | The whole flows, with only Google faked                             |

Shared helpers: `src/worker/test/helpers.ts` (requests through the Worker,
users, sessions, tokens, seeded links, the clock), `src/worker/test/outbound.ts`
(answers the Worker's outbound requests) and `src/web/test/helpers.tsx`
(`renderPage` with a `FakeApi`).

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
                     ├──► INDEX_QUEUE ──► index worker ──► Workers AI (AI) and Vectorize (VECTORIZE)
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
    signed cursors and the reading of a list's `limit` and `cursor`
    (`pagination.ts`: `readLimit`, `readCursor`) and the OpenAPI document (`openapi.ts`).
  - `links/`: URL normalisation (`normalize.ts`), the link store with adding,
    pinning and deleting (`store.ts`), the stream (`stream.ts`), uses and
    history (`use.ts`), and the routes.
  - `stats/`: the library statistics (`stats.ts`) and their route.

The stream (`links/stream.ts`, `listStream`) lists the pinned links by pin
position, then every other link by its points descending, then `last_used_at`
descending, then id descending. The points are computed in SQL at one
reference time, the time of the first page, with the same integer day count
as `pointsAt`. Archived links have no points: where a list includes them
(a search made of filters alone, or `state=archived`), they come after every
ranked link, by `last_used_at` then id descending. The cursor carries that
time (`{s: 'p', t, p}` in the pinned section, `{s: 'r', t, n, l, i}` after
it, `n` being the last row's points at `t`, and `{s: 'a', t, l, i}` among the
archived links), so later pages rank by the first page's points and a link
crossing a day boundary while the owner pages is neither skipped nor
repeated; any other cursor shape is refused. Every search made of filters
alone, the topic and tag searches included, goes through `listStream` and has
the same order. The stream itself (`GET /api/v1/links`) and the change feed
leave archived links out; searches and Ask keep them.

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
  `pages/SignIn`, `pages/Stream` (the add input, which reads a paste line by
  line as an import file is read, through `urlLines` of
  `src/worker/imports/parse.ts`; the cards, infinite scroll,
  pinning by drag, deleting with undo), `pages/LinkDetail` and
  `pages/Settings` (tokens), `pages/Import` (the drop zone, the workspace to
  add the links to, which can be a new one, and the import's progress,
  reached by the header's Import button), `pages/Search` (the results of the search box,
  `components/SearchBox`, which every page's header carries and which owns the
  `/` and Escape keys), and `pages/Topics` and `pages/Tags`
  (`components/VocabularyList`). `App.tsx` follows the path and the query
  string. `api.ts` is the client of the API, `format.ts`
  formats dates. The look is shadcn/ui's, with GodUI's motion
  ([ADR 08](adr/08-adopt-shadcn-ui-with-godui.md)): `main.tsx` imports
  `theme.css` (Tailwind CSS v4, shadcn/ui's neutral variables in light and
  dark, and GodUI's motion tokens from `motion.css`) before `styles.css`,
  which holds Alexandria's own layout and parts, written with the theme's
  variables. `components/ui/` holds the components as their registries publish
  them (Button, Input, Textarea, Dropdown Menu, Alert Dialog and Sonner from
  GodUI; Card, Badge, Alert, Label,
  NativeSelect and Spinner from shadcn/ui), `lib/utils.ts` the `cn` helper,
  and `@/` names `src/web` in imports. Every page
  sits under a light header on one line: the mark (a link to the Stream), a
  row of underlined tabs (Stream, Workspaces, Topics, Tags, Ask, Expired,
  Archive, Stats, Settings), the search box, the Import button and a sign-out
  button. The search box narrows first when the window does; below 78rem the
  tabs show only their icons, and on a phone they move, with their labels, to
  a line of their own under the rest that scrolls sideways. A section page shows no title of
  its own (its tab already names it; the heading is there for screen readers
  only), so its content starts right under the header; a link's or a
  workspace's name is a light heading. Links are the rows of one bordered box (title and actions,
  a line of facts, a two-line summary, the topic as an outlined badge and the
  tags as filled ones; no thumbnails, the actions showing on hover or focus).
  The main action of a screen is the dark primary button and destructive ones
  are red; the account's deletion sits in a red-bordered box. Light and dark
  follow `prefers-color-scheme`. `components/Icon.tsx` draws the 16 px line icons
  and Alexandria's mark.
  `components/LinkCard` shows one link: its title, its site address and
  Open open the site in a new tab, through `/api/v1/links/{id}/open` so the
  visit counts as a use. Open, Read (when a copy is stored) and Pin stay on
  the card; Snapshot, Details, Refresh, Add to workspace, Remove from
  workspace and Delete are behind its ⋯ More actions button, a
  dropdown menu (the workspace picker its submenu) that closes on Escape, on
  a click elsewhere and once an action is chosen; what an action in it did is
  said in a toast. Toasts (a delete's Undo among them) come from the one
  `<Toaster>` in `App.tsx`, and a deletion that cannot be undone is confirmed
  in a dialog, asked through `useConfirm` (`confirm.tsx`). Everywhere else a link appears, its address opens the same way:
  the headline of the link's detail page and a source's title on the Ask page
  go through the open route in a new tab (`SiteLink`), and the web links in a
  note (`components/Markdown`) and in a Read page's article are given
  `target="_blank"` and `rel="noopener noreferrer"` by their sanitiser
  (`openWebLinksInNewTab`).

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
| `link_passages` | per link: the passages it is cut into for search by meaning, each with its vector id and the text version it was made from (see Search by meaning) |
| `link_index_state` | per link: the text version, which triggers move whenever the indexed text changes, and when the link was last queued for indexing |
| `vector_deletions` | the ids of vectors to delete from the Vectorize index, filled by a trigger on every deleted passage |
| `topics`, `tags` | per user: the names a link is filed under; a topic's `parent_id` places it in the topic tree (at most three levels) |
| `topic_aliases`, `tag_aliases` | per user: the former names of renamed and merged topics and tags, each with its survivor |
| `link_tags` | the tags of each link, at positions |
| `imports`, `import_links` | each import's report, and the links it added with their line and dispatch time (see Imports) |
| `title_rules_state` | one row: the hash of the title rules the stored titles were last cleaned with, and when (see Fetching) |

Every query of a user's resources is filtered by the authenticated user, so
another user's id is answered exactly as a missing one.
- **The database** (`migrations/`): plain SQL migrations applied in order.

Besides D1, a link's data lives in two more stores: the R2 bucket `SNAPSHOTS`
(under `u/{user_id}/l/{link_id}/`) and the Vectorize index
`alexandria-passages` (one namespace per user).

### What a link stores

A link's data is stored in four stages, each written by its own step. The
quantities in the last list are never stored.

1. **On add** (`links/store.ts`, `addStatement`; `imports/imports.ts` for an
   import): one `links` row with the normalised `url`, the `original_url` as
   given, the `host`, the host as a placeholder `title`, `state` `pending`,
   `added_at`, `last_used_at`, `decay_from` (equal to `last_used_at`) and
   `updated_at`. An insert trigger gives it its
   `link_search` row (and `link_search_keys` id), with empty reader text. One
   `FETCH_QUEUE` message is sent (an import's links go through its
   dispatcher). Adding a URL the library already has stores nothing new: it
   *boosts* the link (`last_used_at` and `decay_from` now, and an expired link
   becomes active again). It records no use and sends no fetch.
2. **On fetch** (`fetcher/queue.ts`, `writeFetched`): the objects are written
   to R2 first: `snapshot` (the raw HTML, or the whole PDF up to 50 MB) and, for
   a web page with a readable article, `reader.json` (the reader view's title,
   byline and sanitised HTML). Then one D1 batch writes:
   - on `links`: `final_url`, `http_status`, `description`, `favicon_url` and
     `language` (from the page's metadata, `fetcher/html.ts`), the page's
     title cleaned by the title rules unless the owner edited it,
     `content_kind`, `fetched_at`,
     `has_snapshot`, `reader_empty`, `notes` and the state (`active`, or
     unchanged when `archived`);
   - `link_texts`: the reader text (or the PDF's text), at most 500,000
     characters, which replaces the earlier text;
   - the same text into `link_search.reader_text`;
   - a `link_events` row for the attempt.

   A failed attempt writes only its event and the retry bookkeeping
   (`fetch_attempts`, `state_reason`); a failed first fetch also titles the
   link from the words of its URL.
   Anything other than a page or a PDF keeps no snapshot, only a note.
3. **Derived after the fetch:**
   - *Enrichment*, with the owner's own key (`enrich/queue.ts`): `summary`,
     `topic_id` (a topic path filed into `topics`, creating the topics it
     lacks), tags (`tags`, `link_tags`), `enriched_at` and
     `enrichment_status`. Fields listed in `edited_fields` keep the owner's
     value.
   - *The meaning index* (`meaning/indexing.ts`): the passages in
     `link_passages` (the metadata passage carries the topic path as
     `A > B > C`), their vectors in Vectorize, and `link_index_state`.
   - *The word index*: triggers keep `link_search` current, its `topic`
     column holding every name of the topic path.
   - *Over the link's life*: each recorded use (`link_uses`, `use_count`,
     `last_used_at`); the owner's `note`, `pin_position` and workspace
     memberships; the weekly liveness check (`liveness_failures`,
     `dead_since`, `last_checked_at`, `last_check_result`); decay's
     `expired_at` and state; `archived_at`.
4. **Computed on every read, never stored:**
   - the link's `points` (`pointsAt` in `decay/points.ts`), its `removal_at` and
     its `decay_note`; decay compares the same quantity in SQL;
   - the topic's name, the `topic_path`, the tags in order and the
     workspaces, joined in by the `link_views` view;
   - related links (`meaning/related.ts`), worked out on each request;
   - keyword and hybrid rankings, snippets, and the passages found for a
     question;
   - Ask's answers: nothing about a question or an answer is stored, and no
     use is recorded.

The page's content is therefore kept in several places: the R2 snapshot and
reader view, the text in `link_texts` and again in the FTS5 index (a table
with its own content), its passages in `link_passages`, and their vectors.
`deleteLink` and decay's removal delete them all: the rows in one batch, the
R2 objects after it, and the vectors through `vector_deletions`.

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
fetch's failure is stated as a reason (`fetcher/fetch.ts`): "host not found",
"could not connect", "TLS error", "timed out", "blocked by a bot check" (an
answer marked `cf-mitigated: challenge`, such as Cloudflare's "Just a moment…"
page, which only a browser running JavaScript passes), or "HTTP <status>". The runtime
hides an unknown host and a bad certificate behind one opaque error, so for
that error a DNS-over-HTTPS lookup of the host (`cloudflare-dns.com`) tells the
two apart; Cloudflare's own 52x answers are named as the failures they stand
for. A failed first fetch is retried after 10 minutes and 2 hours, then the link is
`unreachable`; a bot check makes it `unreachable` at once, as trying again
will not pass it. A failed first fetch also titles the link from the words of
its address (`titleFromUrl` in `fetcher/queue.ts`), unless the owner edited
the title; a failed refresh changes nothing but the history. Every
attempt is a `link_events` row.

A fetched title is cleaned by the title rules (`fetcher/titles.ts`,
`cleanTitle`) before it is stored: per host, `fetcher/title-rules.json`
lists, optionally per path, regular expressions whose matches are the site's
name rather than the page's (GitHub's "GitHub - " and " · GitHub"), which it
removes, and rewrites that shorten a long title (a GitHub repository's
"owner/repo: description" to "repo: description", an issue's or pull
request's to "Title · owner/repo#123"), which it applies after. The reader
view's title is cleaned the same way as it is served, so a stored
`reader.json` needs no rewrite. The rules file is bundled with the Worker; the
every-minute run (`applyTitleRules`) cleans every stored title once after the
rules change, which it notices by the hash of the file recorded in
`title_rules_state`, skipping titles the owner edited, and sets `updated_at` on
the links it changes so that open pages show the new title. The format is in
[configuration.md](configuration.md#title-rules).

A page behind a bot check can still be fetched through Firecrawl
(`fetcher/firecrawl.ts`, [ADR 04](adr/04-fetch-pages-behind-a-bot-check-through-firecrawl.md))
when its owner stored their own Firecrawl key, encrypted like the AI key. After
a direct fetch meets a bot check, the consumer sends the address to Firecrawl
(`POST {FIRECRAWL_API_URL}/v2/scrape` for the page's raw HTML) and stores the
answer as it would a direct fetch's, with the note "fetched through
Firecrawl". Firecrawl refusing the key marks it rejected; Firecrawl being
unavailable leaves the fetch to its retries. No other page goes to Firecrawl.

Read and Snapshot (`fetcher/routes.ts`) serve only what is stored, to the
owner alone, and record a use. The stream keeps cards current by polling
`GET /api/v1/links?changed_since=` every 5 seconds while a card is pending or
refreshing; every write to a link sets its `updated_at`.

A page is decoded in the encoding its `Content-Type` declares, else the one
its byte order mark or first `<meta charset>` names, else UTF-8
(`decodeHtml`), and its snapshot is stored as UTF-8. A page that cannot be
parsed, or nests its elements deeper than 256 levels (`MAX_DEPTH` in
`fetcher/reader.ts`; Readability's time grows steeply with depth), keeps its
snapshot with the note "page could not be read" and is not enriched. The
writes of a fetch check the row as it is when they run: a failed first fetch
changes only a link still `pending` (one archived meanwhile stays archived),
and a failed write of a refresh leaves the copy the link had.

### Lost messages

A queue send can fail after the row it belongs to is stored, and a message can
be dropped after its last retry. The hourly run (`fetcher/stranded.ts`,
`recoverStranded`) recovers what that leaves behind: a link `pending` and
untouched for 3 hours, not an imported link the dispatcher still holds, counts
one more attempt and is sent to the fetch worker again (500 a run), or at its
third attempt becomes `unreachable` with the reason "the fetch did not
complete"; a link `queued` for enrichment that long, with none of its user's
throttled slots still ahead, becomes `failed` ("the enrichment did not
complete"), which "enrich all" takes up.

## Enrichment

When a fetch (first or refresh) makes a link `active`, the fetch worker hands
it to enrichment (`enrich/queue.ts`, `afterFetch`): a link whose notes say it
has nothing to read is `skipped`; without an AI key it is `no_key`; while the
key is rejected it is `waiting_for_key`; otherwise it is `queued` and one
`ENRICH_QUEUE` message is sent. The enrichment worker (the Worker's `queue`
handler for `alexandria-enrich`) decrypts the user's own key
(`enrich/keys.ts`: AES-GCM under `KEY_ENCRYPTION_KEY`, the user id as
additional data), builds the request (`enrich/enrich.ts`: instructions, title,
host, the paths of the user's 100 topics whose newest link (under the topic
or beneath it) is the most recent, one per line and without counts, the 300
most used tags, each with the number of links that carry it, and the first
20,000 characters of the reader text, or the title and description; it asks
for the topic as a path of one to three names, the most specific that fits),
asks
the user's provider for a structured result (`enrich/providers.ts`: a JSON
schema through structured outputs, `output_config.format`, with
`@anthropic-ai/sdk`, since current models refuse a forced tool call; or a
JSON-schema response format through OpenRouter's HTTP API), normalises it
(1 to 5 tags), resolves the names against the user's vocabulary
(`enrich/vocabulary.ts`), and stores summary, topic and
tags (`topics`, `tags`, `link_tags`). Links are read through the
`link_views` view, which adds the topic's name, its topic path (the names from
the top-level topic down, `topic_path_json`) and the tags in order.

Resolution keeps the vocabulary converging. A name equal to an existing one
(ignoring case, spaces read as hyphens) reuses it, for enrichment and for the
owner's edits alike. Enrichment also reuses a *near* name when there is no
equal one (`nearKeys` in `enrich/enrich.ts`): the same with the hyphens
dropped (`webdev` and `web-dev`), or with its last word made singular or
plural (`databases` and `database`, `libraries` and `library`). A few words
whose plural-looking form names something else (`news`, `windows`, `ios`) are
never varied. The owner's own edits are taken as typed.

A topic, from enrichment or an edit, is a path of up to three names
(`resolveTopicPath` in `enrich/vocabulary.ts`), resolved from the first: a
name that matches a topic (its name, then an alias, then for enrichment and
splits a near name) is that topic wherever it is in the tree, and the next
name belongs under it; any other name is created under the topic before it,
beside a level-3 topic rather than below it. Topics created for a path that
end up empty are deleted again. The owner's edits win whenever they are made:
`storeEnrichment` and the fetch write check `edited_fields` on the row itself
(`ownerEdited` in `links/store.ts`), so an edit made while the provider
answers is kept, and `applyEdit` writes only the fields it was given. Enrichment keeps the first two and the last
name of a longer path and refuses an empty name or one over 100 characters as
an unusable result.

A split (`POST /api/v1/topics/{id}/split`, `prepareSplit` and `applySplit` in
`search/vocabulary.ts`) is one structured request to the owner's provider
(`splitWith` in `enrich/providers.ts`, `SPLIT_SCHEMA`), made while the HTTP
request waits. Its answer is checked whole before anything is written; then
each sub-topic name is resolved with `resolveTopicPath` as the last name of
the topic's own path, and the links are moved in one batch. A link the owner
moved while the provider answered stays where it is, and a sub-topic no link
reached is deleted again.

### Token usage

Every call to the owner's provider (`enrich/providers.ts`: `testKey`,
`enrichWith`, `splitWith`, `streamAnswer`, with the owner's id in the
`ProviderCall`) is recorded when it ends, through `metered`, under its UTC
day, purpose (`key_test`, `enrich`, `split`, `ask`) and model in
`daily_ai_usage` (`stats/daily.ts`, `recordUsage`): one call, and the tokens
the answer reported. From Anthropic the input is `usage.input_tokens` plus the
prompt-cache tokens (`cache_creation_input_tokens`, `cache_read_input_tokens`)
and the output `usage.output_tokens`, from the final message of a streamed
answer; from OpenRouter `usage.prompt_tokens` and `usage.completion_tokens`,
from the last chunk of a streamed answer when it carries one. A call whose
answer reported none (a failure, a timeout, a stream without usage) counts in
`calls_without_usage`. Recording never changes the call's outcome: a failed
record is logged, and only that call's usage is lost. The embeddings of the
account's Workers AI report no usage and are not recorded.

### The background throttle

Background enrichment ("enrich all") goes through
`enrich/throttle.ts` (the slots alone space the jobs; there is no second gate
on their starts): `scheduleThrottled` reserves a user's slots 3 seconds
apart (at most 20 a minute), starting at the user's next free slot
(`users.throttle_next_at`) or now, in one statement so concurrent calls never
share a slot; users are independent. `sendThrottled` sends each message with
its slot and the delay to it, at most the queue's 12 hours; a message that
arrives before its slot is sent again for the time left instead of being
processed. A single pasted link is not throttled.

## Imports

`POST /api/v1/imports` (`imports/`) reads the file (`parse.ts`: a text or
Markdown file, the first `http(s)://` address of each line, other lines
ignored), adds its new
URLs as pending links within the request (`imports.ts`, in D1 batches of 500)
and records the import: `imports` holds the report (and the workspace the
links joined, if any, with how many joined it: with a workspace, each of the
file's links in the library is inserted into `workspace_links` at the end, in
file order, skipping those already there), `import_links` each added
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

- a link whose points are 0 or below, that is `active`, `pending` or
  `unreachable`, not pinned and in no workspace, becomes `expired`
  (`expired_at` set to the evaluation time);
- an expired link that is neither pinned nor in a workspace, expired
  `remove_days` ago or more, is removed with everything
  `DELETE /api/v1/links/{id}` removes, its stored R2 objects deleted after the
  transaction, a thousand keys to a call (a link's two keys are known, so
  nothing is listed);
- `last_decay_at` is set.

A link's points are never stored. `decay/points.ts` holds the one definition
of them: `pointsAt`, which `decay/note.ts` answers every link the API returns
with (the user's `start_points` plus the link's `use_count`, minus the whole
24-hour periods since `decay_from`, negative allowed), and `pointsSql`, the
same quantity as SQL. `decay_from` is the time the link's decay counts from,
kept apart from `last_used_at`, which the card, the stream's tie-break, the
searches and the statistics read as the last use. The expiry statement, the
stream's order (`links/stream.ts`) and the statistics (`stats/stats.ts`) all
use `pointsSql`, which counts milliseconds in integers (`epochMs`) so the day
boundary falls where `pointsAt` puts it; a link expires once the whole days
since its decay start reach its start points plus its use
count. A change of `start_points` therefore applies to every link at once.

A use (`recordUse` in `links/use.ts`) moves `decay_from` in the same UPDATE
that counts it, from the row's values before the update: when the previous
`last_used_at` falls on an earlier UTC day, `decay_from` moves forward by the
user's `use_boost` percent of the time from `decay_from` to now (integer
milliseconds, rebuilt as a timestamp by `isoFromMs`); on the same UTC day it
stays, so the uses of one visit add a point each and do not compound, and of
concurrent first uses only the first moves it. A use of an expired link sets
it to now. A re-paste, a restore and an unarchive set it to now with
`last_used_at`; archiving leaves it. Migration `0019` started every link's
decay at its last use, and an insert trigger gives a link inserted without a
decay start its `last_used_at` as one. Pinned links and links in a workspace keep losing points
but never expire, and an expired link that is pinned or in a workspace is
never removed. `removal_at` is `expired_at` plus `remove_days`.
`decay/note.ts` also gives every link its `decay_note`.

### The archive

An archived link (`state` `archived`, `archived_at` set) is one the owner
chose to keep, and decay leaves it alone: the expiry statement takes only
`active`, `pending` and `unreachable` links and removal only `expired` ones,
and `decay/note.ts` gives it no points and no removal date.
`POST /api/v1/links/{id}/archive` (`decay/archive.ts`) sets the state in one
batch with the unpin statements (`unpinStatements`), then sends a refresh
message on `FETCH_QUEUE` without touching `refresh_requested_at`, recording a
failed fetch event when the send fails. The fetch worker's write
(`writeFetched`) keeps the state `archived`, so the refresh replaces the
snapshot and reader text and re-enriches the link without un-archiving it.
`POST .../unarchive` makes it `active` with `last_used_at` and `decay_from`
now. The stream
and the change feed leave archived links out; searches and Ask keep them,
and `listStream` lists them after the ranked links. Pinning one is refused,
the weekly liveness checks skip it and the on-demand check refuses it.
`GET /api/v1/archive` shares its paging with `GET /api/v1/expired`
(`listByTime`). The Archive page (`web/pages/Archive.tsx`) shows each archived
link on the stream's `LinkCard`, which dims it, gives its decay note
("archived on …: kept until deleted") and offers Unarchive where other cards
offer Pin.

### Liveness

The same hourly run enqueues one `LIVENESS_QUEUE` message per link due a
weekly check (`decay/liveness.ts`): neither expired nor archived, and active or pinned, last
checked (or, never checked, added) 7 days ago or more, and not enqueued in
the last 6 hours (`check_enqueued_at`, set in the selecting statement). The
consumer drops a message for a link deleted, expired, archived or no longer due;
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
- renaming a topic or a tag rewrites the rows of the links that carry it, a
  topic's also those of the links beneath it, since the `topic` column holds
  every name of a link's topic path.

Three more triggers delete a topic or tag whose last link loses it: a
`link_tags` row deleted (an edit, a merge, decay's removal, or a link deleted,
through the cascade), a link's topic changed, and a link deleted. Topics form
a tree of at most three levels (`topics.parent_id`): a topic goes only when it
has no link and no child topic, and its parent and grandparent go with it when
that leaves them the same way. D1 runs without recursive triggers, so the two
topic triggers delete those ancestors themselves, the grandparent first. Writers
therefore never empty a link's tags before setting them:
`enrich/vocabulary.ts`'s `setTagsStatements` removes only the tags the link
loses and upserts the rest with their positions.

The reader-view text is written by the fetch worker in the batch that stores
it in `link_texts` (`search/search.ts`, `indexReaderTextStatement`): at most
its first 500,000 characters, replacing what was indexed before, and nothing
when a fetch stores no text. The migration indexed the links and texts stored
before it.

## Search by meaning

`GET /api/v1/search?mode=hybrid` (`search/hybrid.ts`, `search/routes.ts`)
merges the keyword ranking with the links whose best passage matches by
meaning. `hybridRanking` runs `findPassages` (up to 100 links, one passage
each, 600 ms) beside the full keyword ranking (`keywordMatches`) and the set of
strong keyword matches (`strongMatchIds`: every free word in title, tags and
topic together), then orders the links in two tiers, strong matches first, each
by reciprocal rank fusion with k = 60 over competition ranks (links of equal
bm25 or equal similarity share a rank, so equal scores fall to the pin, last-use
and id tie-breaks of keyword search). Past the first 1,000 keyword matches the
keyword order is kept below the fused links of the tier. The route pages the
whole ranking with a `{s: 'h', o}` cursor and reads snippets for the page's
keyword matches only. If meaning is unavailable the ranking is the keyword
matches, `meaning: "unavailable"`.

Keyword search is unchanged. Beside it, every link is indexed by what it means
([ADR 05](adr/05-index-links-by-meaning-with-vectorize-and-workers-ai.md)):
Workers AI embeds passages of the link's text and Vectorize holds the vectors,
one namespace per user.

- **Passages** (`meaning/cut.ts`). A link is cut into passages of at most 1,500
  characters: its title, summary, topic, tags and note first, then the first
  50,000 characters of its reader text. They are rows of `link_passages`, with
  the id of the vector made from each: `{link_id}:{version}:{position}`. Each
  vector carries the metadata `kind`, `metadata` or `reader`, after what its
  passage was cut from; the Vectorize index has a metadata index on `kind`
  (`scripts/provision.sh`), so a query can be filtered on it.
- **The text version.** Triggers (`migrations/0011_meaning_index.sql`) move
  `link_index_state.text_version` whenever the title, summary, topic, tags, note
  or reader text changes, or a topic or tag the link carries is renamed — for a
  topic, also when it or a topic above the link's own is renamed or moved
  (`migrations/0016_topic_path_index.sql`, `0017_topic_moves.sql`). A link
  is stale when no passage carries its version; a link never indexed is stale
  too. Writers need do nothing for that to hold.
- **Queueing** (`meaning/indexing.ts`, `queueIndexing`). The fetch consumer,
  enrichment, `PATCH /api/v1/links/{id}`, the rename and merge of topics and
  tags and the move of a topic send `{user_id, link_id}` on `INDEX_QUEUE` for each of their links that is
  stale. A send that fails is logged and fails nothing; the backfill picks the
  link up.
- **The index worker** (`handleIndexBatch`, the `alexandria-index` consumer,
  batch 10, 5 retries). It acknowledges a message for an account being deleted,
  a deleted link or a link whose passages are current. Otherwise it reads the
  link, cuts it, embeds the passages, upserts the vectors into the owner's
  namespace and replaces the passages in one D1 batch whose writes depend on
  the link existing, its account not being deleted and its text version being
  the one it read. If that no longer holds it queues the vectors it stored for
  deletion and stores nothing. A failing Workers AI or Vectorize throws before
  anything is written to D1, and the message is retried.
- **The every-minute run** (`meaning/backfill.ts`, `maintainIndex`, beside the
  import dispatcher) deletes the vectors queued in `vector_deletions` (a
  thousand ids to a call, 20 calls a run, a failed call leaves its ids queued)
  and then queues, for each user not marked for deletion, up to 60 stale links
  not queued in the last 10 minutes, the most recently used first.
- **Passages for a question** (`meaning/passages.ts`). `GET /api/v1/passages`
  embeds the question's free words, takes the 100 nearest vectors in the user's
  namespace, keeps those scoring at least 0.5 (`SIMILARITY_THRESHOLD`,
  `meaning/backend.ts`), reads them from the user's own `link_passages` joined
  with their links under the query filters, and returns at most 3 a link and
  `limit` in all. The embedding and the query together have 5 seconds; a failure
  or the timeout is `503 search_unavailable`. `findPassages` is the function
  other features call. The `search_passages` MCP tool is this route.
- **Related links** (`meaning/related.ts`). `GET /api/v1/links/{id}/related`
  takes the link's newest first passage (its title, summary, topic, tags and
  note) as the question to `findPassages` with one passage a link, no filters,
  only vectors of `kind` `metadata` and the stricter threshold 0.7
  (`RELATED_SIMILARITY_THRESHOLD`), drops the link itself and returns the 5 best
  other links, worked out on each request; nothing is stored
  ([ADR 06](adr/06-relate-links-by-their-metadata-alone.md)). Migration
  `0013_reindex_passage_kinds.sql` moved every link's text version, so that the
  backfill re-indexed the links stored before vectors carried their kind. A
  link not yet indexed has no first passage and no related links. The detail
  page shows them as "Similar links" above its history, each with its score as
  a percentage ("82% similar"), and says so instead while they load, when there
  are none and when they cannot be worked out.
- **Deletion.** `deleteLink` and decay's removal delete a link's passages in the
  batch that deletes the link, and a trigger queues each passage's vector in
  `vector_deletions`; the account deletion job deletes `link_passages` like any
  table that references the links, and leaves `vector_deletions` and
  `link_index_state`, which triggers fill, to the drain and the cascade. A
  passage request reads only passages still in D1, so a deleted link is never
  returned while its vectors await deletion.
- **The backend** (`meaning/backend.ts`) is the one interface to Workers AI and
  Vectorize. With `MEANING_FAKE_URL` set (end-to-end tests only) it speaks HTTP
  to `e2e/fake-meaning.ts` instead of using the `AI` and `VECTORIZE` bindings.

## Asking the library

`POST /api/v1/ask` (`meaning/ask.ts`) answers a question from the owner's own
links with the owner's own AI provider. It refuses in this order: the body, the
question (`parseQuery` with a cap of 500 characters), the owner's key
(`getAiSettings`: none, or marked rejected), and the index (`findPassages`
for the 8 best passages, at most 3 a link; 16 for a detailed ask). Then it numbers the sources from 1
in the order of their best passage, reads each as `toView` shows it, and
answers with a `ReadableStream` of server-sent events: `sources` first, a
`delta` for each piece `streamAnswer` (`enrich/providers.ts`) hands on, and
`done`. `streamAnswer` streams Anthropic through the SDK's `messages.stream` and
OpenRouter through `POST /chat/completions` with `stream: true`, and bounds the
whole answer by the provider timeout. The prompt gives the provider each passage
headed by its source's number and title and the free words of the question
(the filters only narrow the passages); a detailed ask (`detailed: true`, the
Ask page's Tell me more) adds an instruction to answer thoroughly and allows
4,096 tokens instead of 1,024. Both are told to write plain text without
formatting, since an answer is often passed on to another agent. The Ask page
shows the detailed answer under the first and renders each with
`renderAnswer` (`components/Markdown.tsx`), the note sanitiser that also keeps
links to `/links/{id}`, which each citation `[n]` becomes. Nothing about a
question or an answer is stored, and no use of any link is recorded.

## MCP server

`/mcp` (`mcp/server.ts`) serves the Model Context Protocol over Streamable
HTTP with the official SDK (`@modelcontextprotocol/sdk`). Every POST builds a
new `McpServer` and a `WebStandardStreamableHTTPServerTransport` (no session
id generator, JSON responses) bound to the request's user; nothing is kept
between requests. `requireToken` (`auth/middleware.ts`) accepts only a bearer
token, and the API's `rateLimit` counts the request once; a JSON-RPC batch
(an array of messages) is refused with 400, so that every tool call is counted.

The tools (`mcp/tools.ts`) do no work of their own: each sends the equivalent
requests to the API sub-application in the same Worker, as the agent's user.
Those requests are `Request` objects the Worker creates and records in
`internalRequests` with their user; `requireAuth` takes the user from there
and `rateLimit` does not count them. So a tool's shapes, errors, limits and
use recording are the API's by construction. The server registers the tools
with `registerTool` (for `tools/list`) and handles `tools/call` itself, so
that argument errors and unexpected failures are tool errors in the API's
envelope.

## Statistics

`GET /api/v1/stats` (`stats/routes.ts`, `stats/stats.ts`, `computeStats`)
computes the owner's statistics live from the rows the library stores; nothing
is precomputed or kept in step. The answer is a list of sections (`SECTIONS`),
each naming the read-only statements it needs and how it turns their rows into
its part of the answer. Every statement of every section runs in one D1 batch
at one instant, after one shared count over the owner's links (`linkCounts`),
so the numbers describe one moment and cost one round trip, even at the
20,000-link limit. Every statement is bound to the owner's id. An error in any
statement or section reaches `app.onError`, which answers
`500 {"error": "internal"}`: there is no partial answer. `statsHooks` is the
test seam that makes a section fail.

### The daily record

`daily_stats` holds one row per user and UTC day with a counter per event
(`stats/daily.ts`, `COUNTERS`) and the library's size at the end of the day;
`daily_ai_usage` one row per user, day, purpose and model with the provider
calls and their tokens. A counter moves in the same transaction as the write
it counts ([ADR 07](adr/07-count-the-daily-record-in-the-writes-it-counts.md)):
triggers of migration `0018_daily_stats.sql` count the rows written and the
state changes (a link added, a use, a fetch event, a link restored, archived,
unarchived or expired, an enrichment stored or failed), and `countStatement`,
an upsert put in the same D1 batch as a change, counts what a trigger cannot
tell apart (a delete by the owner or by decay, an Ask question). A change that
fails or is rolled back is never counted, and a stored one is counted exactly
once, a redelivered message included. The hourly run (`decay/cron.ts`), when it starts between 00:00
and 01:00 UTC, first records every owner's library size (the total and each
state) under the day that just ended (`recordDaySizes`), before decay changes
anything; a day's size is written once, and a day without such a run keeps
none. Counters only grow; nothing deletes a row but the account's
deletion, which finds both tables by their `user_id` column.
`GET /api/v1/stats/history` (`readHistory`) answers a range of days, filling
the days without a row.

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
  except full-text tables and the tables triggers keep, `vector_deletions` and
  `link_index_state` among them): rows referencing the user's links first (the
  passages' vectors are queued for deletion by a trigger), then the links once
  none references them (their triggers remove their search index rows), then
  the rest;
- when nothing is left, the users row.

The every-minute run then deletes the queued vectors from the Vectorize index,
so the index holds nothing of the account within a minute of the job ending.

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
users, sessions, tokens, seeded links, the clock, queue recorders and
`deliver…` functions), `src/worker/test/outbound.ts` (answers the Worker's
outbound requests), `src/worker/test/meaning.ts` (fake Workers AI and Vectorize
bindings, reset before each test, and seeded articles; the embedder they share
with `e2e/fake-meaning.ts` is `src/worker/test/embedder.ts`) and
`src/web/test/helpers.tsx` (`renderPage` with a `FakeApi`).

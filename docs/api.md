# HTTP API

The API is served by the Worker under `/api/v1/`, as JSON.

## Authentication

Every route under `/api/v1/` needs one of:

- the website's session cookie `alexandria_session`, set by signing in with
  Google (`GET /auth/google`), or
- `Authorization: Bearer <personal access token>`.

A session lasts 30 days after its last use; every authenticated request moves
its expiry, and the cookie is re-sent with the new lifetime.

| Situation | Answer |
|---|---|
| No credentials, an unknown or expired session, an unknown or revoked token | `401 {"error": "unauthorized"}`; nothing is performed |
| `POST`, `PUT`, `PATCH` or `DELETE` authenticated by the cookie whose `Origin` header is missing or not `PUBLIC_ORIGIN` | `403 {"error": "forbidden_origin"}`; nothing is performed. Token-authenticated requests are not affected |
| A link or token that belongs to another user | `404 {"error": "not_found"}`, exactly as for one that does not exist |
| A path under `/api/v1/` that names no route | `404 {"error": "not_found"}` |

## Conventions

- **Errors.** Every error body carries `error`, a stable code. Validation
  errors are `400 {"error": <code>, "field": <name or null>, "message": <text>}`;
  a body that is not valid JSON (or not a JSON object) is
  `400 {"error": "invalid_json", "field": null, ...}`. Limits are `409` with
  their code and a message (`library_full`, `pin_limit`, `token_limit`). An
  unexpected failure is `500 {"error": "internal"}`.
- **Rate limit.** A user may make 600 requests to `/api/v1/` per clock minute,
  counted across all their sessions and tokens. Past that, each request is
  refused without being performed: `429 {"error": "rate_limited"}` with a
  `Retry-After` header of whole seconds (1 to 60) until the next minute.
- **Pagination.** List endpoints take `limit` (an integer from 1 to 100; the
  default is the endpoint's) and `cursor`, and answer
  `{"items": [...], "next_cursor": <string or null>}`. A cursor is opaque and
  signed: pass back the `next_cursor` of the previous page unchanged.
  `next_cursor` is `null` on the last page. A bad `limit` is
  `400 invalid_limit`, a cursor the API did not issue `400 invalid_cursor`.
- **Description.** `GET /api/v1/openapi.json` serves the OpenAPI 3.1 document
  of every route, with the `bearer` and `session` (cookie) security schemes.
  The tests fail when the document and the registered routes differ, or when
  a response the tests receive is not one the document declares.

## Sign-in routes

These are outside `/api/v1/` and are used by the website.

| Route | What it does |
|---|---|
| `GET /auth/google` | Starts sign-in with Google (OAuth 2.0 authorization code with PKCE): `302` to Google |
| `GET /auth/google/callback` | Completes it: `302` to `/` with the session cookie, to `/signin?error=private` for an address not on `ALLOWED_EMAILS`, or to `/signin?error=failed` for any other failure |
| `POST /auth/signout` | Ends the session at once and expires the cookie: `302` to `/signin`. With the cookie, the `Origin` must be `PUBLIC_ORIGIN` |

## Website pages

Every page other than `/signin` and the public pages under `/about/` redirects
to `/signin` (`302`) without a valid session.

## Routes

### `GET /api/v1/me`

The current user: `200 {"email": "...", "name": "..."}`, and nothing else
from the account.

### `GET /api/v1/openapi.json`

The OpenAPI 3.1 document: `200`, `application/json`.

### Personal access tokens

A token authenticates API requests as its user with the same rights as a
session: `Authorization: Bearer alx_…`. Its secret is shown once, at creation,
and stored only as its SHA-256 hash. A user holds at most 20 unrevoked tokens.
Every request with a token records its `last_used_at`.

#### `POST /api/v1/tokens`

Body `{"name": "<1 to 100 characters>"}` (trimmed).

- `201 {"id", "name", "created_at", "last_used_at": null, "secret": "alx_…"}`
- `400 {"error": "invalid_name", "field": "name", "message"}` for a missing,
  empty, whitespace-only or too long name
- `403 {"error": "not_allowed", "message"}` when the user's address is no
  longer on `ALLOWED_EMAILS` (existing tokens keep working until revoked)
- `409 {"error": "token_limit", "message": "token limit reached"}`

#### `GET /api/v1/tokens`

The unrevoked tokens, newest first, never with their secrets:
`200 {"items": [{"id", "name", "created_at", "last_used_at"}]}`.

#### `DELETE /api/v1/tokens/{id}`

Revokes the token: `204`. From the next request on it is refused with `401`.

### Links

A link is shown as:

```json
{
  "id": "…",
  "url": "https://example.com/article",
  "original_url": "https://example.com/article?utm_source=x",
  "host": "example.com",
  "title": "example.com",
  "state": "pending",
  "added_at": "2026-06-01T08:00:00.000Z",
  "last_used_at": "2026-06-01T08:00:00.000Z",
  "use_count": 0,
  "pinned": false,
  "pin_position": null,
  "final_url": null,
  "http_status": null,
  "description": null,
  "favicon_url": null,
  "language": null,
  "fetched_at": null,
  "state_reason": null,
  "notes": [],
  "content_kind": null,
  "has_snapshot": false,
  "updated_at": "2026-06-01T08:00:00.000Z",
  "summary": null,
  "tags": [],
  "topic": null,
  "enrichment_status": null,
  "enrichment_reason": null,
  "edited_fields": []
}
```

`state` is `pending` until the link's first fetch, then `active`, or
`unreachable` after three failed attempts, or after the first when the site
answers with a bot check (`state_reason` says why: "timed out", "HTTP 503",
"blocked by a bot check", …; a page behind a bot check is fetched through
Firecrawl instead when the owner stored a [Firecrawl key](#firecrawl-settings),
and then carries the note "fetched through Firecrawl"). Until a fetch
succeeds, `title` is the host,
then, once an attempt fails, words read from the address (unless the owner
edited it). A fetch fills `final_url`, `http_status`, `title`,
`description`, `favicon_url`, `language`, `fetched_at` and `content_kind`
(`html`, `pdf` or `other`); `notes` holds remarks such as "truncated", "not a
web page (image/png)", "no text in this PDF" or "PDF too large to store (50 MB
limit)"; `has_snapshot` says whether Read and Snapshot are available.

Enrichment adds `summary` (at most 60 words), `tags` (1 to 5, lower-case,
hyphenated) and `topic`. `enrichment_status` says where the link stands:
`no_key` (no AI key), `queued`, `enriched`, `failed` (with
`enrichment_reason`), `skipped` (nothing to read: not a web page, a PDF
without text, a PDF too large), or `waiting_for_key` (the key was rejected);
it is `null` before the first fetch. `edited_fields` lists the fields the
owner set by hand, which enrichment and refresh never overwrite.

Decay adds `sticky` (at least 5 uses on 5 UTC days: never dormant or archived
by decay), `archived_at`, `removal_at`, `dead_since`, `last_checked_at`,
`last_check_result` and `decay_note`, one sentence saying the link's decay
state and why: "unused for 3 days" (in months of 30 days from 60 days),
"sticky: 7 uses on 6 days, never archived", "pinned: never archived, unused
for …", "in a workspace: never archived, unused for …", or "archived on
2027-03-01, removed on 2027-08-28". A use, a re-paste or a restore makes a
`dormant` link `active` again at once.

Every URL that enters the library is normalised the same way: whitespace is
trimmed; `https://` is added when there is no scheme; only `http` and `https`
are accepted; scheme and host are lower-cased; the fragment and a default port
are dropped; the query parameters `utm_*`, `fbclid`, `gclid`, `mc_cid` and
`mc_eid` are dropped and the others sorted by name; a lone `/` path is dropped
when no query follows. A bare word (no dot), `localhost`, and loopback,
private and link-local addresses are refused. Duplicates are found on the
normalised URL; the input is kept as `original_url`. A new link's title is its
host until it is fetched. A library holds at most 20,000 links.

#### `POST /api/v1/links`

Body `{"url": "<url>"}`.

- `201 {"status": "added", "link": <link>}`: a new link, `pending`, with
  `added_at` and `last_used_at` now.
- `200 {"status": "boosted", "link": <link>}`: the user already has this
  normalised URL; its `last_used_at` is now, its `use_count` unchanged.
- `400 {"error": "invalid_url", "field": "url", "url": <the input or null>, "message": "not a valid web address"}`
- `409 {"error": "library_full", "message": "library full (20,000 links)"}`

Concurrent adds of one URL store one link: one is answered `added`, the
others `boosted`.

#### `POST /api/v1/links/batch`

Body `{"urls": ["<url>", …]}` with 1 to 100 entries. Each valid URL is added
or boosted as above; repeats (after normalisation) collapse to their first
occurrence; the first URL gets the latest `last_used_at`, so the batch appears
in the stream in the order given.

- `200 {"added": [<link>], "boosted": [<link>], "invalid": [{"url": <input>, "error": "invalid_url" | "library_full"}]}`
- `400 {"error": "no_urls" | "too_many_urls", "field": "urls", "message"}`;
  nothing is stored.

#### `GET /api/v1/links`

The stream: the links that are not archived, the pinned ones first in pin
position order, then the rest by `last_used_at`, newest first, with the id
breaking ties. Query: `limit` (1 to 100, default 50), `cursor`.

- `200 {"items": [<link>], "next_cursor": <string or null>}`
- `400 {"error": "invalid_limit", "field": "limit", "message"}` or
  `400 {"error": "invalid_cursor", "field": "cursor", "message"}`

While the library is unchanged, following the cursors returns every link
once.

The filters of the search (below) narrow the list as query parameters, in
the same stream order: `tag`, `topic`, `host`, `state`, `in` and `is`, each
with the meaning of its prefix filter; repeated parameters all apply
(`?tag=cloudflare&tag=queues`). A `state` other than pending, active,
unreachable, dormant, archived or any, or an `is` other than pinned or dead,
is `400 {"error": "invalid_filter", "field": <the parameter>, "message"}`.

With `changed_since=<ISO 8601 time>` instead, the answer is the change feed:
every link that is not archived and changed at or after that time (every
write to a link sets its `updated_at`), oldest change first, with the
server's time to ask from next:
`200 {"items": [<link>], "server_time": "…"}`. A link changed in the very
millisecond asked from may come again. A value that is not an ISO 8601
timestamp is `400 {"error": "invalid_changed_since", "field": "changed_since", "message"}`.
The website polls this every 5 seconds while a card is pending or
refreshing.

#### `GET /api/v1/links/{id}`

One link: `200 <link>`, or `404 {"error": "not_found"}`.

#### `GET /api/v1/links/{id}/open`

Records a use of the link (its `use_count` goes up by one, `last_used_at`
becomes now, and a `use` event is stored) and redirects to its normalised
URL: `302` with `Location: <url>`. This is how the website, scripts and apps
open links, so that every use is counted. Concurrent opens are each counted.

#### `GET /api/v1/links/{id}/history`

The link's uses and fetch attempts, newest first:
`200 {"items": [<event>], "next_cursor"}`, where an event is
`{"kind": "use", "at"}` or
`{"kind": "fetch", "at", "outcome": "ok" | "failed", "http_status": <number or null>, "reason": <string or null>}`.
Query: `limit` (1 to 100, default 100), `cursor`.

#### `POST /api/v1/links/{id}/pin`

Pins the link. The pinned links form the top of the stream in their own
order, positions `1..n`. Optional body `{"position": <integer ≥ 1>}`: the
link goes to that place (a position past the end means the end) and the
others keep their order; without one, a new pin goes to the end and an
already pinned link stays where it is. At most 30 links are pinned.

- `200 <link>` with `pinned: true` and its `pin_position`
- `400 {"error": "invalid_position", "field": "position", "message"}`
- `409 {"error": "pin_limit", "message": "unpin something first"}`; nothing
  changes. Moving a link that is already pinned is always possible.

#### `DELETE /api/v1/links/{id}/pin`

Unpins the link: `200 <link>` with `pinned: false` and `pin_position: null`.
It returns to its place by last use, and the remaining positions close up.

#### `DELETE /api/v1/links/{id}`

Deletes the link and its history at once and for good: `204`. A pinned
link's place in the pinned section closes up. Adding the same URL again
creates a new link. (The website holds a delete for 10 seconds so that it can
be undone; the API does not.)

### Stored copies: Read and Snapshot

Every fetched web page keeps a snapshot (its raw HTML) and a reader view (its
article alone, sanitised); a fetched PDF keeps the whole file and its text.
Both are served from storage alone, never from the origin, so they work when
the site is down or gone, and only to the link's owner. Reading either
records a use of the link. A link with nothing stored (pending, unreachable,
not a web page, a PDF over 50 MB) answers
`404 {"error": "no_snapshot", "message": "no snapshot stored for this link"}`
and records no use.

#### `GET /api/v1/links/{id}/reader`

`200 {"content_kind": "html" | "pdf", "title", "byline", "html": <string or null>, "text", "empty": <boolean>}`.
For a web page, `html` is the sanitised article; when fewer than 200
characters of text were extracted the view is `empty` (`html` null, `text`
''), and the snapshot is still there. For a PDF, `html` is null and `text` is
its text.

#### `GET /api/v1/links/{id}/snapshot`

For a web page: the stored HTML, `Content-Type: text/html; charset=utf-8`,
with `Content-Security-Policy: sandbox; default-src 'none'; img-src * data:; style-src * 'unsafe-inline'; font-src * data:`,
`X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`, so that
its scripts never run. For a PDF: the stored file, `application/pdf`,
`Content-Disposition: inline; filename="<title>.pdf"`, or `attachment` with
`?download=1`.

Deleting a link (`DELETE /api/v1/links/{id}`) also deletes its stored copies,
its text and its fetch events.

#### `POST /api/v1/links/{id}/refresh`

Fetches the link again in the background: `202 {"status": "queued"}`. When
the fetch succeeds it replaces the snapshot, reader view and fetched
metadata, sets the link `active` and clears its reason and notes; when it
fails, the link keeps everything it had and its history gains a failed fetch
event (a refresh is not retried). At most one refresh per link per 10
minutes: a second one is
`429 {"error": "refreshed_recently", "message": "already refreshed recently"}`
with `Retry-After` in seconds.

### AI provider settings

Enrichment runs only with the owner's own AI key ("bring your own key"),
Anthropic or OpenRouter. The key is stored encrypted and never returned: the
API shows only its last 4 characters.

#### `GET /api/v1/settings/ai`

`200 {"configured": true, "provider": "anthropic" | "openrouter", "model", "key_last4", "status": "verified" | "rejected", "rejected_message": <string or null>, "unenriched_count"}`,
or `{"configured": false, "unenriched_count"}` without a key. `unenriched_count`
counts the links waiting to be enriched (`no_key`, `waiting_for_key` or
`failed`).

#### `PUT /api/v1/settings/ai`

Body `{"provider": "anthropic" | "openrouter", "api_key": "…", "model": "…"}`.
The model is optional for Anthropic (default `claude-opus-5-5`) and required
for OpenRouter (at most 200 characters). The key is stored only after a test
request the provider accepts, replacing any earlier settings and lifting a
rejection.

- `200` with the settings as above (without `unenriched_count`), `status: "verified"`
- `400 {"error": "invalid_provider" | "invalid_key" | "model_required" | "invalid_model", "field", "message"}`,
  without calling the provider
- `400 {"error": "key_rejected", "field": "api_key", "message": <the provider's message>}`
- `502 {"error": "provider_unavailable", "message"}` when the provider cannot
  be reached, answers 5xx, or does not answer within 60 seconds

When the provider later answers an enrichment with HTTP 401, 402 or 403 (a
revoked key, no credit), the key's `status` becomes `rejected` with the
provider's message in `rejected_message`, the user's enrichment pauses, and
links reaching enrichment wait as `waiting_for_key`. Saving a key the
provider accepts lifts the pause; the waiting links are enriched by
`POST /api/v1/links/enrich-unenriched`.

#### `DELETE /api/v1/settings/ai`

Forgets the provider, model and key: `204`. Later links are not enriched.

#### `POST /api/v1/links/enrich-unenriched`

Schedules every link waiting to be enriched (`no_key`, `waiting_for_key` or
`failed`) through the background throttle, at most 20 a minute, and marks
them `queued`: `202 {"queued": <n>}`. Without a key, or with a rejected one:
`409 {"error": "no_ai_key", "message": "add an AI key in settings"}`.

#### `POST /api/v1/links/{id}/enrich`

Runs the link's enrichment again, at once and outside the throttle:
`202 {"status": "queued"}`. Without a verified key:
`409 {"error": "no_ai_key", …}`; for a link that is pending, unreachable or
skipped: `409 {"error": "nothing_to_enrich", "message"}`.

A failed automatic enrichment (a provider error, a rate limit, a refusal, no
answer within 60 seconds, or an unusable result) leaves the link `active`
with its fetched title and description, marks it `failed` with
`enrichment_reason`, and is tried once more 10 minutes later; a re-run asked
for here is not retried.

#### `PATCH /api/v1/links/{id}`

Edits any of `title` (1 to 500 characters), `summary` (at most 2,000),
`tags` (a list of at most 20 names, each non-empty once normalised as
enrichment's tags are) and `topic` (1 to 100 characters). Tag and topic
names reuse the user's existing ones (case ignored, spaces read as hyphens).
Each given field is recorded in `edited_fields` for good: later enrichment,
re-runs and refreshes never overwrite it.

- `200 <link>`
- `400 {"error": "invalid_title" | "invalid_summary" | "invalid_tags" | "invalid_topic", "field", "message"}`;
  nothing is changed when any field is invalid.

### Firecrawl settings

Pages whose site answers with a bot check ("blocked by a bot check") can be
fetched through Firecrawl with the owner's own key; see
[ADR 04](adr/04-fetch-pages-behind-a-bot-check-through-firecrawl.md). Without
a key, no page is sent to Firecrawl. The key is stored encrypted and never
returned: the API shows only its last 4 characters.

#### `GET /api/v1/settings/firecrawl`

`200 {"configured": true, "key_last4", "status": "verified" | "rejected", "rejected_message": <string or null>}`,
or `{"configured": false}` without a key.

#### `PUT /api/v1/settings/firecrawl`

Body `{"api_key": "…"}`. The key is stored only after Firecrawl accepts it on
a request that costs no credits, replacing any earlier key and lifting a
rejection.

- `200` with the settings as above, `status: "verified"`
- `400 {"error": "invalid_key", "field": "api_key", "message"}` without a key,
  without calling Firecrawl
- `400 {"error": "key_rejected", "field": "api_key", "message": <Firecrawl's message>}`
- `502 {"error": "provider_unavailable", "message"}` when Firecrawl cannot be
  reached, answers 5xx, or is rate limited

When Firecrawl later refuses the key while fetching a page (HTTP 401, 402 or
403: a revoked key, no credits left), the key's `status` becomes `rejected`
with Firecrawl's message, and no page goes to Firecrawl until a key is saved
again.

#### `DELETE /api/v1/settings/firecrawl`

Forgets the key: `204`. Pages behind a bot check stay unreachable.

### Workspaces

A workspace is a named, manually ordered collection of the owner's links,
with a Markdown note. A link can be in any number of workspaces; deleting a
workspace never deletes a link. A user holds at most 200 workspaces. Names
are 1 to 100 characters (trimmed) and unique per user ignoring case; a
description is one paragraph of at most 1,000 characters without a line
break.

A workspace is shown as `{"id", "name", "description", "note", "link_count", "created_at"}`;
lists leave out `note`.

#### `POST /api/v1/workspaces`

Body `{"name", "description"?}`: `201 <workspace>` (empty note, no members).
`400 invalid_name | invalid_description`; `409 {"error": "name_taken", "message": "a workspace with this name already exists"}`;
`409 {"error": "workspace_limit", "message": "workspace limit reached (200)"}`.

#### `GET /api/v1/workspaces`

The workspaces by name ignoring case, with member counts, at most 100 per
page: `200 {"items": [...], "next_cursor"}`.

#### `GET /api/v1/workspaces/{id}`

`200 <workspace>` with its note.

#### `PATCH /api/v1/workspaces/{id}`

Any of `name`, `description` and `note` (see Notes). The members and their
order stay as they are. `200 <workspace>`; the same `400` and `409 name_taken`
as on create.

#### `DELETE /api/v1/workspaces/{id}`

Deletes the workspace, its note and its memberships, keeping every link:
`204`.

#### `GET /api/v1/workspaces/{id}/links`

The members in their order, whatever their state (archived ones included),
each a link as in the stream plus its `position`, at most 100 per page:
`200 {"items": [...], "next_cursor"}`.

#### `POST /api/v1/workspaces/{id}/links`

Body `{"link_id", "position"?}`. A new member goes to the bottom (`201`); a
`position` (1-based; past the end means the end) places or moves the link
there, the others keeping their order (`201` new, `200` moved); an existing
member without a position stays (`200`). The answer is
`{"workspace_id", "link_id", "position"}`. `400 invalid_link_id | invalid_position`;
`404 not_found` for a link that is not the user's.

#### `DELETE /api/v1/workspaces/{id}/links/{link_id}`

Takes the link out of the workspace and closes the gap; the link stays:
`204`, or `404` when it was not a member.

Deleting a link (`DELETE /api/v1/links/{id}`) takes it out of every
workspace it was in.

Another user's workspace answers `404 {"error": "not_found"}`, as an unknown
one does.

### Notes

A workspace and a link each carry one Markdown note of at most 20,000
characters (Unicode code points), stored exactly as written; an empty note
clears it. Set it with `PATCH /api/v1/workspaces/{id}` or
`PATCH /api/v1/links/{id}` and `{"note": "…"}`; nothing else changes.
`400 {"error": "note_too_long", "field": "note", "message": "note too long (20,000 characters)"}`,
or `400 {"error": "invalid_note", …}` for a value that is not text.

Links in lists (the stream, the change feed, a workspace's links) carry
`note_preview` (the note's first non-empty line without Markdown heading or
list markers and raw HTML, cut to 200 characters, or null) and `workspaces`
(`[{"id", "name"}]` by name); only `GET /api/v1/links/{id}` and the answer of
`PATCH /api/v1/links/{id}` carry the whole `note`. The website renders notes
as Markdown and removes raw HTML, scripts, event handlers and every URL that
is not http, https or mailto.

### Decay settings

Links the owner does not use decay: after `dormant_days` without use an
active link becomes `dormant` (dimmed, still in the stream); after
`archive_days` it is archived (out of the stream, kept with its snapshot);
`remove_days` after archiving it is removed for good.

#### `GET /api/v1/settings/decay`

`200 {"dormant_days": 60, "archive_days": 120, "remove_days": 180}` (the
defaults).

#### `PUT /api/v1/settings/decay`

Body with all three, each a whole number of days from 7 to 3650, and
`dormant_days` below `archive_days`: `200` with the stored values.
`400 {"error": "invalid_threshold", "field": <name>, "message"}`, or
`400 {"error": "invalid_thresholds", "field": "dormant_days", "message": "the dormant threshold must be below the archive threshold"}`.

### The archive

#### `POST /api/v1/links/{id}/archive`

Archives the link by hand, whatever would keep it from decay (stickiness, a
pin, a workspace): `archived_at` is now, the link is unpinned (the pinned
positions close up) and keeps its workspaces. `200 <link>`; an archived link
answers `200` unchanged.

#### `GET /api/v1/archive`

The archived links, most recently archived first, each with `archived_at` and
`removal_at`, at most 100 per page: `200 {"items": [...], "next_cursor"}`.

#### `POST /api/v1/links/{id}/restore`

Brings an archived link back: `active`, `last_used_at` now (a boost, not a
use: the use count stays), no archive date. `200 <link>`, or
`409 {"error": "not_archived", "message": "this link is not archived"}`.

### Liveness

Every kept link (active, dormant or pinned, not archived) is checked weekly:
HEAD, then a headers-only GET when the HEAD fails, 10 seconds each, at most 5
redirects, never more than one request per second to one host. A final 2xx
passes. Three failed weekly checks in a row set `dead_since`; a later pass
clears it. `last_checked_at` and `last_check_result` ("HTTP 200", "could not
connect", "timed out", …) say how the last check went. A dead link keeps its
snapshot and reader view and decays like any other.

#### `POST /api/v1/links/{id}/check`

Checks the link now:
`200 {"passed": <boolean>, "result", "checked_at", "link": <link>}`. A pass
clears `dead_since` and the failure count; a failure is stored as the last
result but does not count towards the three. At most one per link per 10
minutes:
`429 {"error": "checked_recently", "message": "already checked recently"}`
with `Retry-After`. An archived link:
`409 {"error": "link_archived", "message": "archived links are not checked"}`.

### Search

#### `GET /api/v1/search`

Searches the library: `?q=<query>`, at most 200 characters, with `limit` (1
to 100, default 50) and `cursor` as every list takes them.

A query is free words and prefix filters. Every free word must match, as the
start of a word, case- and accent-insensitively (`cloud` finds "Cloudflare",
`cafe` finds "Café"), in the link's title, summary, tags, topic, host,
original URL, note or reader-view text. Quotes and the full-text engine's
operators (`AND`, `OR`, `NOT`, `NEAR`, `*`, `(`, `)`, `:`, `-`, `^`) are
plain text. Archived links are left out.

```json
{
  "items": [
    {
      "link": { "id": "…", "title": "Cloudflare Queues explained", "…": "…" },
      "snippet": [
        { "text": "Cloudflare ", "match": false },
        { "text": "Queues", "match": true },
        { "text": " explained", "match": false }
      ]
    }
  ],
  "workspaces": [{ "id": "…", "name": "Kitchen remodel", "snippet": [] }],
  "next_cursor": null
}
```

Results are ordered by relevance, with the fields weighted title 10, tags and
topic 5, summary 3, host, original URL and note 2, reader text 1; equally
relevant links put pinned links first (by position), then the more recently
used. Each result's `snippet` is a passage of at most 32 words from the field
that matched best, split into segments with the matched words marked; it is
text, never HTML. The first page also lists, in `workspaces`, the workspaces
whose name, description or note holds every free word; later pages have
`[]`.

An empty or blank query answers with the stream, exactly as
`GET /api/v1/links` lists it, each snippet `[]`.

Prefix filters narrow the results; each is a name, a colon and one word or
a double-quoted phrase (`topic:"web development"`), names in any case, and
every filter given applies:

| Filter | Keeps the links |
|---|---|
| `tag:<name>` | with that tag, ignoring case |
| `topic:<name>` | with that topic, ignoring case |
| `host:<host>` | on that host or a subdomain of it (`host:cloudflare.com` keeps `developers.cloudflare.com`) |
| `in:<workspace>` | in the workspace with that name, ignoring case |
| `is:pinned`, `is:dead` | pinned; dead (`dead_since` set) |
| `state:<state>` | in that state: `pending`, `active`, `unreachable` or `dormant`; `archived` keeps only archived links, `any` every state |

Without a `state:` filter archived links are left out. Any other `word:` is
a free word. A query of filters only lists the matching links in stream
order, each snippet `[]`, with the stream's cursor.

Errors: `400 {"error": "query_too_long", "field": "q"}`, and
`400 {"error": "invalid_filter", "field": "q", "message"}` naming the filter;
`invalid_limit`, `invalid_cursor`, and
`400 {"error": "invalid_mode", "field": "mode", "message": "mode takes keyword, hybrid"}`.

**`mode`.** `keyword` (the default) is the search described above, and an
answer without a `mode` is the same bytes as one with `mode=keyword`: no
`match` and no `meaning` field. `mode=hybrid` also finds links by what they
mean (see Searching by meaning below). A hybrid query of filters only, or an
empty one, is answered as in keyword mode, with `"meaning": "used"` added and
nothing embedded.

#### Searching by meaning

`mode=hybrid` with at least one free word returns the links that match the
free words by keyword, by meaning, or both, in one ranking, so that a page
saved as "Durable Objects alarms" is found by "scheduling work in the
background". Meaning uses the same index as `GET /api/v1/passages`: a link is
found by meaning when its best passage scores at least 0.5 against the free
words, and meaning adds at most the 100 nearest such links to a query. The
filters apply to those links as to keyword matches.

```json
{
  "items": [
    { "link": { "id": "…", "…": "…" }, "snippet": [{ "text": "…", "match": false }], "match": "meaning" }
  ],
  "workspaces": [],
  "next_cursor": null,
  "meaning": "used"
}
```

- **`match`** says how the link was found: `keyword`, `meaning` or `both`. A
  keyword or both match has the snippet keyword search gives (at most 32 words,
  the matched words marked); a meaning match has the first at most 32 words of
  its best passage as one segment, nothing marked.
- **The ranking** has two tiers. First the links whose title, tags and topic
  together hold every free word; then every other match. Within a tier links
  are ordered by reciprocal rank fusion of their place in the keyword ranking
  (the first 1,000 keyword matches take part) and in the meaning ranking, so a
  strong keyword match is never below a link found by meaning alone, and a link
  found both ways comes before one found a single way. Links of equal score are
  ordered as keyword search orders its ties: pinned (by position), then the more
  recently used, then by id. Every link keyword search finds is returned.
- **Paging** is by a signed `next_cursor` of its own kind: for a query with free
  words, a cursor of one mode is `400 invalid_cursor` in the other (a query of
  filters only is answered alike in both modes, with the stream's cursor). Every result appears once across the
  pages, and the first page lists the matching workspaces, as in keyword mode.
- **`meaning`** is `used`, or `unavailable` when Workers AI or Vectorize
  failed or had not answered within 600 ms: the answer is then the keyword
  results of the query, each `match: "keyword"`. A hybrid search never answers
  5xx because of the index.

### Passages

#### `GET /api/v1/passages`

The pieces of the owner's links that best answer a question, found by what
they mean and not by the words they share with it. `?q=<question>`, at most
200 characters, with `limit` (1 to 20, default 8). The question is written in
the search query language: its free words are the question (they are joined by
single spaces and embedded), and the prefix filters narrow the links exactly
as in `GET /api/v1/search`, with archived links left out unless a `state:`
filter says otherwise.

```json
{
  "items": [
    {
      "link_id": "…",
      "title": "Durable Object alarms",
      "url": "https://example.com/durable-object-alarms",
      "passage": "An alarm lets a Durable Object schedule a task to run later…",
      "score": 0.7071
    }
  ],
  "meaning": "used"
}
```

Each link is cut into passages of at most 1,500 characters: its title,
summary, topic, tags and note together, then its reader-view text up to the
first 50,000 characters (a link with no reader-view text has only the first).
Items are the best-matching passages, best first by `score`, the passage's
similarity to the question; only a score of 0.5 or more is returned, so a
question unrelated to anything in the library answers `{"items": [], "meaning":
"used"}`. At most 3 passages of one link are returned and the rest of the
limit goes to other links. `url` is the link's original URL. The request
records no use of any link.

A link is found by meaning once it is indexed: within about a minute of its
reader text, title, summary, topic, tags or note being stored or changed, and
for links that existed before the index, once the backfill has reached them
(60 links a minute per user). Nothing shows whether a link is indexed yet. A
deleted link's passages are gone at once.

Errors: `400 {"error": "invalid_question", "field": "q", "message": "ask with
at least one word"}` for a `q` that is absent, blank or only filters;
`query_too_long` and `invalid_filter` (field `q`) as in search;
`400 {"error": "invalid_limit", "field": "limit", "message": "limit must be an
integer from 1 to 20"}`. When Workers AI or Vectorize fails or has not answered
within 5 seconds: `503 {"error": "search_unavailable", "message": "search by
meaning is unavailable, try again"}`.

### Topics and tags

The topics and tags enrichment and the owner's edits give links. A topic or
tag whose last link loses it (by an edit, a merge, decay's removal or a
deletion) is deleted: it is neither listed nor offered to enrichment again.

#### `GET /api/v1/topics`

Every topic that has a link, with the number of its links in any state
(archived included) and the added date of its newest link, newest first:
`200 {"items": [{"id", "name", "count", "newest_added_at"}], "next_cursor"}`,
with `limit` (1 to 100, default 50) and `cursor`.

#### `GET /api/v1/tags`

The same for tags.

#### `PATCH /api/v1/topics/{id}` and `PATCH /api/v1/tags/{id}`

Renames a topic or tag: `{"name": "<new name>"}`. Every link carrying it shows
the new name, and the old name becomes an alias of it (see below).
`200 {"id", "name", "count"}`.

A tag name is lower-cased and must be 1 to 50 characters of letters and digits
in hyphen-joined words (`web-dev`); a topic name is trimmed, its spaces
collapsed, and must be 1 to 100 characters. Otherwise
`400 {"error": "invalid_name", "field": "name", "message"}`. A name another
topic (or tag) of the user has, ignoring case, is
`409 {"error": "name_taken", "message": "another tag is named javascript: merge this tag into it instead"}`
and nothing changes. Renaming to the same name answers 200.

#### `POST /api/v1/topics/{id}/merge` and `POST /api/v1/tags/{id}/merge`

Merges a topic or tag into another: `{"into": "<the id of the survivor>"}`.
Every link of the source gets the survivor (a link never carries a tag
twice), the source is deleted, and its name and its aliases become aliases
of the survivor, all at once. `200 {"id", "name", "count"}` of the survivor.
A missing `into`, or the source itself, is
`400 {"error": "invalid_merge", "field": "into", "message"}`; a source or
`into` that is not one of the user's is `404 {"error": "not_found"}`.

#### Aliases

A renamed or merged-away name is an alias of its survivor. When enrichment's
provider proposes a topic or tag that is an alias, ignoring case, the link
gets the survivor and no topic or tag with the old name is created. The
provider is only ever shown current names. A current name wins over an alias
of the same name.

### Imports

#### `POST /api/v1/imports`

Imports the web addresses in a text or Markdown file: the file as a
`text/plain` or `text/markdown` body (or with no type), or as the part `file`
of a `multipart/form-data` form, where a file named `*.txt` or `*.md` is
taken whatever its declared type. An optional workspace id, as the form part `workspace_id` or the query
parameter `workspace_id`, adds the file's links to that workspace. The file must be UTF-8, at most 2 MB (2,097,152 bytes) and at most
5,000 URL lines. A byte-order mark is dropped; lines end at `\n` or `\r\n`;
lines whose first non-blank character is `#` are skipped. A URL line is one
that holds an `http://` or `https://` address anywhere; every other line is
ignored and not reported. Only a line's first address counts. It runs to the
first whitespace, quote, angle or square bracket, backtick or pipe, without
trailing punctuation (`.,;:!?*_~`) or an unbalanced `)`, so Markdown such as
`- [Docs](https://example.com/docs).`, `<https://example.com>` or
`**https://example.com**` gives the bare address.

Each URL line is normalised as `POST /api/v1/links` does. A new URL is added
as a pending link (its host as provisional title), last used at the import
time minus one millisecond per line, so that the stream lists the file in
order, the first line highest, above every link used before the import (when
a link was used within that span, the import's times start that much later). A URL already in the library, or on an earlier
line, is a duplicate: reported, neither added nor boosted. An address the
normaliser rejects (`http://localhost/x`, `https://`) is invalid. When the library (20,000 links) is full, the
import stops at the first new URL with no room: that line and every later
URL line are not imported.

With a workspace, every link of the file that is in the library afterwards
(added, or a duplicate of a link already there) joins the workspace at its
end, in file order; a link already in the workspace keeps its place. Lines
not imported because the library was full join nothing.

```json
{
  "id": "…",
  "created_at": "2026-11-07T10:00:00.000Z",
  "counts": { "url_lines": 400, "added": 397, "duplicates": 0, "invalid": 3, "not_imported": 0 },
  "invalid": [{ "line": 57, "text": "not-a-url" }],
  "duplicates": [{ "line": 12, "url": "https://example.com" }],
  "stopped_at_limit": null,
  "workspace": { "id": "…", "name": "Trip", "added": 397 }
}
```

`201` with the report; `stopped_at_limit` is `{"line": N}` when the limit
stopped the import. `workspace` names the workspace the links were added to,
by its current name, with how many of them joined it (the others were members
already); it is `null` without one, and once that workspace is deleted. Refusals, after which nothing is imported:

- `400 {"error": "unsupported_file", "field": "file", "message": "only text or Markdown files (.txt, .md) are accepted"}`:
  a declared type other than `text/plain`, `text/markdown` or
  `text/x-markdown` (for a form part not named `*.txt` or `*.md`), bytes that
  are not UTF-8, or a NUL byte;
- `409 {"error": "import_too_large", "message": "too large: at most 5,000 URLs / 2 MB per import"}`;
- `400 {"error": "no_urls", "field": "file", "message"}`: no URL line, or a
  form without a `file` part;
- `400 {"error": "unknown_workspace", "field": "workspace_id", "message": "no such workspace"}`:
  the workspace is not one of the user's.

#### `GET /api/v1/imports/{id}`

The import's report, as `POST` answered it, with the progress of its added
links that are still in the library:
`"progress": {"waiting", "in_progress", "done", "enriched"}`: not yet sent to
the fetch worker; sent and still pending; no longer pending; and of those,
enriched. The website polls this every 5 seconds until nothing is waiting or
in progress.

Imported links are fetched, then enriched, in the background: at most 20 of a
user's imported links are sent to the fetch worker in any minute, in file
order, earlier imports first, sharing that budget with "enrich all"
(`POST /api/v1/links/enrich-unenriched`). A link pasted or added through the
API meanwhile is fetched at once.

#### `GET /api/v1/imports/{id}/report`

The report as a downloadable file: `text/plain; charset=utf-8`,
`Content-Disposition: attachment; filename="alexandria-import-<YYYY-MM-DD>.txt"`,
with the import date, the counts (`added: 397`, …), the library-limit stop
(`library full (20,000 links): stopped at line N, M lines not imported`), every
invalid line (`line 57: not-a-url`), the workspace
(`workspace: Trip (397 links added to it)`) and every duplicate
(`line 5: duplicate of https://a.example`).

Both answer `404 {"error": "not_found"}` for an id that is not one of the
user's imports.

### Export

#### `GET /api/v1/export`

The whole library as one JSON document, sent as a download
(`Content-Disposition: attachment; filename="alexandria-export-<YYYY-MM-DD>.json"`):

```json
{
  "format": "alexandria-export",
  "version": 1,
  "exported_at": "2026-11-07T10:00:00.000Z",
  "user": { "email": "owner@example.com", "name": "Ada Owner" },
  "links": [
    {
      "id": "…",
      "…": "every field GET /api/v1/links/{id} returns, the whole note included",
      "snapshot_url": "https://alexandria.example.com/api/v1/export/links/…/snapshot",
      "reader_url": "https://alexandria.example.com/api/v1/export/links/…/reader"
    }
  ],
  "workspaces": [
    { "id": "…", "name": "Research", "description": "", "note": "…", "link_ids": ["…"] }
  ],
  "topics": [{ "id": "…", "name": "databases", "link_count": 2 }],
  "tags": [{ "id": "…", "name": "sql", "link_count": 3 }],
  "complete": true
}
```

Every link is there, in every state (archived included), as
`GET /api/v1/links/{id}` returns it, with `snapshot_url` and `reader_url`
(`null` when nothing of that kind is stored). A workspace's `link_ids` are in
its manual order. The document is sent as it is read: when reading fails
part-way the download breaks off, so a file that does not end with
`"complete": true` (and does not parse) is not a whole export. The export holds
nothing else: no settings, no part of the AI key, no tokens, sessions or import
reports.

#### `GET /api/v1/export/links/{id}/snapshot` and `GET /api/v1/export/links/{id}/reader`

The `snapshot_url` and `reader_url` of an export entry: the link's stored
snapshot and reader view exactly as `GET /api/v1/links/{id}/snapshot` and
`GET /api/v1/links/{id}/reader` serve them (same status, headers and body),
archived links included, with the same credentials, but **recording no use**,
so that fetching a backup does not reset the library's decay. A link of the
user with nothing of that kind stored answers `404 {"error": "no_content"}`;
another user's link and an unknown id answer `404 {"error": "not_found"}`.

### Deleting the account

#### `DELETE /api/v1/me`

Deletes the account and everything of it: `{"confirm_email": "<the account's email>"}`,
compared ignoring case and surrounding whitespace. Only a session (the
website) can do it: with a personal access token the answer is
`403 {"error": "session_required", "message": "delete the account from the settings page"}`.
Any other email, or none, is
`400 {"error": "confirmation_mismatch", "field": "confirm_email", "message": "type your email address to confirm"}`
and nothing changes.

On success, at once: every session and token of the user and the AI key are
deleted, the account is marked for deletion and the session cookie is
cleared; `202 {"status": "deleting"}`. The deletion job then removes every
link, snapshot, workspace and everything else of the account within minutes,
and the user record last. There is no undo. Signing in with the same Google
account while the job runs is refused (`/signin?error=deleting`); afterwards
it starts a new, empty library.

## MCP server

`POST /mcp` is a Model Context Protocol server over the Streamable HTTP
transport, for agents. It is stateless: every request is answered on its
own, as JSON (`Content-Type: application/json`), with no session id; send
`Accept: application/json, text/event-stream` as the transport requires.
`GET /mcp` and `DELETE /mcp` answer `405` with `Allow: POST`. To connect an
agent to it, see [mcp.md](mcp.md).

Only a personal access token authenticates it:
`Authorization: Bearer <secret>`. A missing, unknown or revoked token, or a
session cookie alone, is `401 {"error": "unauthorized"}` with
`WWW-Authenticate: Bearer`, before any message is read. Every `/mcp` request
counts once against the user's 600 requests a minute shared with the API
(`429 {"error": "rate_limited"}` with `Retry-After`), however many API
operations its tool performs.

The server is named `alexandria`, offers tools only, and its instructions
tell an agent that Alexandria is the owner's private library of web links and
to try `search_links` before `add_link` to avoid duplicates, to use
`search_passages` to answer a question from the library, and `get_link_content`
to read a whole link.

### Tools

Each tool performs the equivalent API request(s) as the token's user, so it
answers with the same shapes, errors and limits, and records a use exactly
where the API does. A success carries the API's JSON body as
`structuredContent` and as one text content item; a refusal is a tool result
with `isError: true` and the API's error envelope (`error`, `message`, and
`field` where the API gives one), never a JSON-RPC error. Arguments that do
not fit a tool's input schema are
`{"error": "invalid_arguments", "field": <the argument>, "message"}`; an
unexpected failure is
`{"error": "internal_error", "message": "something went wrong, try again"}`.

| Tool | Arguments | Does |
|---|---|---|
| `add_link` | `url`, `tags?`, `workspace?` | adds or boosts as `POST /api/v1/links` (`{status, link}`); applies `tags` as a manual tag edit; files the link at the bottom of `workspace` unless it is a member |
| `search_links` | `query`, `limit?` (1 to 100, default 10) | `GET /api/v1/search` with the query as given, prefix filters included, and `mode=hybrid`: links found by meaning as well as by words, each with `match`, and `meaning` in the body; no use |
| `search_passages` | `query`, `limit?` (1 to 20, default 8) | `GET /api/v1/passages` with the query as given as `q`: the passages that best match it by meaning, each with its link's id, title and URL; no use. A `search_unavailable` (503) is a tool error with that envelope, not `internal_error` |
| `get_link` | `id` | `GET /api/v1/links/{id}`: metadata and summary; no use |
| `get_link_content` | `id`, `format` (`text` or `html`) | `{id, format, content}`: the reader-view text (a PDF's extracted text) from `GET /api/v1/links/{id}/reader`, or the snapshot HTML from `GET /api/v1/links/{id}/snapshot`; one use, as those endpoints record |
| `list_workspaces` | none | `{items}`: every page of `GET /api/v1/workspaces` |
| `add_to_workspace` | `link_id`, `workspace` | `POST /api/v1/workspaces/{id}/links` with `{link_id}`: at the bottom |
| `pin_link` | `link_id` | `POST /api/v1/links/{id}/pin` without a position (`pin_limit` at 30) |
| `archive_link` | `link_id` | `POST /api/v1/links/{id}/archive` |
| `list_recent` | `limit?` (1 to 100, default 20) | the first page of `GET /api/v1/links`; no use |

A `workspace` argument is a workspace's id or its name, compared ignoring
case; one that names no workspace of the user is
`{"error": "not_found", "message"}`, and no workspace is created. `add_link`
checks its arguments before it stores anything: tags are trimmed and
lower-cased, and each must be a single word or a hyphenated phrase (at most
20), else `{"error": "invalid_arguments", "field": "tags", "message"}`. Its
`url` is refused as `POST /api/v1/links` refuses it (`invalid_url` with the
input as `url`, `library_full`), with nothing stored.

`get_link_content` with `format: "html"` for a PDF link is
`{"error": "not_html", "message": "this link is a PDF; use format text"}`, and
for a link with nothing stored (pending, unreachable, not a web page)
`{"error": "no_content", "message"}`; neither records a use.


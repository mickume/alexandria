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

The Stats page (`/stats`, its tab between Archive and Settings) shows
[`GET /api/v1/stats`](#get-apiv1stats), loaded once when it opens and again
when the owner presses Refresh, and in its Trends section
[`GET /api/v1/stats/history`](#get-apiv1statshistory) for the range picked
(7, 30, 90 or 365 days; 30 at first).

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

Body `{"name": "<1 to 100 characters>"}` (trimmed). With a session only: a
token cannot create tokens, so that one that leaked cannot make others that
would outlive its revocation.

- `201 {"id", "name", "created_at", "last_used_at": null, "secret": "alx_…"}`
- `400 {"error": "invalid_name", "field": "name", "message"}` for a missing,
  empty, whitespace-only or too long name
- `403 {"error": "session_required", "message"}` for a request made with a
  token
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
  "decay_from": "2026-06-01T08:00:00.000Z",
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
  "topic_path": [],
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
(`html`, `pdf` or `other`); the fetched `title` (and the reader view's) has
the site's own name removed, and may be shortened, for the hosts the
[title rules](configuration.md#title-rules) cover, such as GitHub's
"GitHub - " and " · GitHub" (an issue reads "Title · owner/repo#123");
`notes` holds remarks such as "truncated", "page could not be read", "not a
web page (image/png)", "no text in this PDF" or "PDF too large to store (50 MB
limit)"; `has_snapshot` says whether Read and Snapshot are available.

Enrichment adds `summary` (at most 60 words), `tags` (1 to 5, lower-case,
hyphenated) and `topic`. Enrichment files the link under a topic path of up
to three names that the provider returns: from the first, a name that matches
an existing topic (ignoring case, as an alias, or as a near name such as a
plural) uses it where it is, and any other name becomes a new topic under the
one before it, so enrichment grows the topic tree but never moves a topic. A
path of more than three names keeps the first two and the last; one with an
empty name, or a name over 100 characters, is an unusable result. `topic_path` holds the names from the link's
top-level topic down to its own topic, such as
`["Software engineering", "Testing"]` (`[]` without a topic); `topic` is the
last of them. `enrichment_status` says where the link stands:
`no_key` (no AI key), `queued`, `enriched`, `failed` (with
`enrichment_reason`), `skipped` (nothing to read: not a web page, a PDF
without text, a PDF too large), or `waiting_for_key` (the key was rejected);
it is `null` before the first fetch. `edited_fields` lists the fields the
owner set by hand, which enrichment and refresh never overwrite.

Decay adds `decay_from`, `points`, `archived_at`, `expired_at`, `removal_at`,
`dead_since`, `last_checked_at`, `last_check_result` and `decay_note`.
`decay_from` is the time the link's decay counts from, in the same form as
`last_used_at`, which stays the time of its last use or boost. `points` is an
integer (null for an archived link): the owner's `start_points` plus the link's
`use_count`, minus the whole 24-hour periods since its `decay_from`, at the
time of the request; it can be negative. A new link, added or imported, has
`decay_from` equal to its `last_used_at`.

A use adds 1 to `use_count` and sets `last_used_at` to now. The first use of a
link on a UTC day (its `last_used_at` before the use is on an earlier UTC day)
also moves `decay_from` forward by the owner's `use_boost` percent of the time
from `decay_from` to now, rounded down to the millisecond; a later use that day
leaves `decay_from` as it is, so it adds exactly 1 point. Concurrent first uses
of a day move it once. A use of an expired link sets `decay_from` to now,
whatever `use_boost` is. With `start_points` 60 and `use_boost` 50, a link with
5 uses and `decay_from` 62 days ago has 3 points; after a use it has 6 uses and
`decay_from` 31 days ago, so 35 points, and a second use the same day makes 36.
A re-paste, a restore and an unarchive set both `last_used_at` and
`decay_from` to now without a use; archiving leaves `decay_from` as it is.
`expired_at` is when the
link expired, and null while it is not expired; `removal_at` is `expired_at`
plus the owner's `remove_days`, or null. `decay_note` is one sentence saying
where the link stands: "expired on 2027-03-01, removed on 2027-08-28" for an
expired link (whatever else holds); "pinned: never expires" for a
pinned link; "in a workspace: never expires" for a link in a
workspace; otherwise "expires in 42 days" ("expires in 1 day"), or "expires
today" at 0 points or below. A use or a re-paste of an expired link
makes it `active` again in the same request and clears `expired_at`.
`archived_at` is when the link was archived, and null while it is not
archived. An archived link is kept outside decay: `points` and `removal_at`
are null, and `decay_note` is "archived on 2027-03-01: kept until deleted".

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
  normalised URL; its `last_used_at` and `decay_from` are now, its `use_count`
  unchanged.
- `400 {"error": "invalid_url", "field": "url", "url": <the input or null>, "message": "not a valid web address"}`
- `409 {"error": "library_full", "message": "library full (20,000 links)"}`

Concurrent adds of one URL store one link: one is answered `added`, the
others `boosted`.

#### `POST /api/v1/links/batch`

Body `{"urls": ["<url>", …]}` with 1 to 100 entries. Each valid URL is added
or boosted as above; repeats (after normalisation) collapse to their first
occurrence; the first URL gets the latest `last_used_at`, so among links of
equal points the batch appears in the stream in the order given.

- `200 {"added": [<link>], "boosted": [<link>], "invalid": [{"url": <input>, "error": "invalid_url" | "library_full"}]}`
- `400 {"error": "no_urls" | "too_many_urls", "field": "urls", "message"}`;
  nothing is stored.

#### `GET /api/v1/links`

The stream: the links that are neither expired nor archived, the pinned ones first in pin
position order, then the rest by `points`, highest first, then by
`last_used_at`, newest first, with the id (descending) breaking ties. With
`start_points` 60, a link used 10 times whose `decay_from` is 5 days ago (65 points)
is listed above one used once today (61). Query: `limit` (1 to 100, default
50), `cursor`. The pages after the first are ordered by the points as of the
first page, so every link that does not change while you page appears exactly
once, even when a day boundary passes; a cursor this order did not issue (one
of the former order by last use among them) is
`400 {"error": "invalid_cursor", "field": "cursor", "message"}`.

- `200 {"items": [<link>], "next_cursor": <string or null>}`
- `400 {"error": "invalid_limit", "field": "limit", "message"}` or
  `400 {"error": "invalid_cursor", "field": "cursor", "message"}`

While the library is unchanged, following the cursors returns every link
once.

The filters of the search (below) narrow the list as query parameters, in
the same stream order: `tag`, `topic`, `host`, `state`, `in` and `is`, each
with the meaning of its prefix filter; repeated parameters all apply
(`?tag=cloudflare&tag=queues`). Archived links stay out of the list unless a
`state` parameter asks for them (`state=archived` or `state=any`). A `state`
other than pending, active, unreachable, expired, archived or any, or an `is`
other than pinned or dead,
is `400 {"error": "invalid_filter", "field": <the parameter>, "message"}`.

With `changed_since=<ISO 8601 time>` instead, the answer is the change feed:
every link that is neither expired nor archived and changed at or after that time (every
write to a link sets its `updated_at`), oldest change first, at most 500, with
the time to ask from next:
`200 {"items": [<link>], "server_time": "…"}`. `server_time` is the server's
time, or, when the answer is full, the time of its last change, so that asking
again from it brings the rest. A link changed in the very millisecond asked
from may come again. A value that is not an ISO 8601
timestamp is `400 {"error": "invalid_changed_since", "field": "changed_since", "message"}`.
The website polls this every 5 seconds while a card is pending or
refreshing.

#### `GET /api/v1/links/{id}`

One link: `200 <link>`, or `404 {"error": "not_found"}`.

#### `GET /api/v1/links/{id}/open`

Records a use of the link (its `use_count` goes up by one, `last_used_at`
becomes now, `decay_from` moves as a use moves it, and a `use` event is
stored) and redirects to its normalised
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
- `409 {"error": "link_archived", "message": "archived links cannot be pinned"}`
  for an archived link; nothing changes.

#### `DELETE /api/v1/links/{id}/pin`

Unpins the link: `200 <link>` with `pinned: false` and `pin_position: null`.
It returns to its place by points, and the remaining positions close up.

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
enrichment's tags are) and `topic`: one topic name, or a path of up to three
names separated by `>`, such as `"Software engineering > Testing"`, each name
1 to 100 characters (spaces around `>` are trimmed). Tag names reuse the
user's existing ones (case ignored, spaces read as hyphens). A topic path is
resolved name by name, from the first: a name that is one of the user's topics
or an alias of one, matched the same way, is that topic where it already is in
the tree (it is never moved), and the next name belongs under it; any other
name is created as typed under the topic before it, or at the top level for
the first name. A new topic that would be at level 4, under an existing
level-3 topic, is created beside that topic instead. The link is filed under
the topic of the last name. Each given field is recorded in `edited_fields`
for good: later enrichment, re-runs and refreshes never overwrite it.

- `200 <link>`
- `400 {"error": "invalid_title" | "invalid_summary" | "invalid_tags" | "invalid_topic", "field", "message"}`;
  nothing is changed when any field is invalid. A topic of more than three
  names, an empty name or one over 100 characters is `invalid_topic` with the
  message "a topic or a path of up to three topics separated by >, each 1 to
  100 characters".

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

The members in their order, whatever their state (expired ones included),
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

Links the owner does not use decay. A link's `points` are the owner's
`start_points` plus its use count, minus the whole days since its
`decay_from`; a link whose points reach 0 expires, and it is removed
`remove_days` after it expired. `use_boost` is the percent of the time decayed
that the first use of a link on a UTC day wins back.

#### `GET /api/v1/settings/decay`

`200 {"start_points": 60, "remove_days": 180, "use_boost": 50}` (the defaults).

#### `PUT /api/v1/settings/decay`

Body with all three: `start_points` and `remove_days` each a whole number from
7 to 3650, `use_boost` a whole number from 10 to 100. `200` with the stored
values. A change of `start_points` applies to the points of every link of the
owner at once; a change of `use_boost` applies to the uses recorded after it
and moves no link's `decay_from`, so no link's points change when it is saved.
A field missing, not a whole number, or out of bounds is refused, and nothing
is stored:
`400 {"error": "invalid_threshold", "field": "start_points", "message": "start_points must be a whole number from 7 to 3650"}`
(or `remove_days`), or
`400 {"error": "invalid_threshold", "field": "use_boost", "message": "use_boost must be a whole number from 10 to 100"}`.

### Expired links

A link whose points reach 0 expires: it leaves the stream and every list and
search without a `state:` filter, and waits to be removed. There is no way to
expire a link by hand.

#### `GET /api/v1/expired`

The owner's expired links, most recently expired first (id descending on
ties), each with `expired_at` and `removal_at`. Query: `limit` (1 to 100,
default 50), `cursor`: `200 {"items": [...], "next_cursor"}`. A bad `limit` is
`400 {"error": "invalid_limit", "field": "limit", "message"}`, and a cursor
this route did not issue `400 {"error": "invalid_cursor", "field": "cursor", "message"}`.

#### `POST /api/v1/links/{id}/restore`

Brings an expired link back: `active`, `last_used_at` and `decay_from` now (a
boost, not a use: the use count stays, so its points are `start_points` plus
its use count), `expired_at` cleared. `200 <link>`. A link that is
not expired:
`409 {"error": "not_expired", "message": "this link is not expired"}`, and
nothing changes. Another user's link, or one that does not exist: `404`.

### Archive

The owner archives a link to keep it for good: it leaves the stream and decay,
and is refreshed once.

#### `GET /api/v1/archive`

The owner's archived links, most recently archived first (id descending on
ties), each with `archived_at` and `removal_at: null`. Query: `limit` (1 to
100, default 50), `cursor`: `200 {"items": [...], "next_cursor"}`. A bad
`limit` is `400 {"error": "invalid_limit", "field": "limit", "message"}`, and a
cursor this route did not issue (one of the expired list among them)
`400 {"error": "invalid_cursor", "field": "cursor", "message"}`.

#### `POST /api/v1/links/{id}/archive`

Archives a link in any state but `archived`, at once: `state` `archived`,
`archived_at` now, `expired_at` cleared; the link is unpinned and the pin
positions after it close up; its workspaces are kept. A fetch of its page is
then queued as a refresh, outside the 10-minute refresh window (which it
neither waits for nor starts). `200 <link>`, without waiting for the fetch.
That fetch is a refresh like any other: on success it replaces the snapshot
and the reader text and enriches the link again, keeping the fields the owner
edited, and the link stays `archived`; on failure the link keeps what it had
and its history records the failure.
When the fetch cannot be queued the link stays archived and its history gets a
failed fetch event with the reason "refresh before archiving could not be
queued". A link already archived: `200 <link>`, unchanged, and nothing is
queued. Another user's link, or one that does not exist: `404`.

#### `POST /api/v1/links/{id}/unarchive`

Brings an archived link back: `active`, `archived_at` cleared, `last_used_at`
and `decay_from` now (a boost, not a use: the use count stays, so its points are
`start_points` plus its use count). It is not pinned again. `200 <link>`. A
link that is not archived:
`409 {"error": "not_archived", "message": "this link is not archived"}`, and
nothing changes. Another user's link, or one that does not exist: `404`.

### Liveness

Every active or pinned link that is neither expired nor archived is checked weekly:
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
with `Retry-After`. An expired link, without any request to its address:
`409 {"error": "link_expired", "message": "expired links are not checked"}`;
an archived link, likewise:
`409 {"error": "link_archived", "message": "archived links are not checked"}`.

### Search

#### `GET /api/v1/search`

Searches the library: `?q=<query>`, at most 200 characters, with `limit` (1
to 100, default 50) and `cursor` as every list takes them.

A query is free words and prefix filters. Every free word must match, as the
start of a word, case- and accent-insensitively (`cloud` finds "Cloudflare",
`cafe` finds "Café"), in the link's title, summary, tags, topic (any name of
its topic path), host, original URL, note or reader-view text. Quotes and the full-text engine's
operators (`AND`, `OR`, `NOT`, `NEAR`, `*`, `(`, `)`, `:`, `-`, `^`) are
plain text. Expired links are left out.

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
| `topic:<name>` | with that topic or a topic beneath it, ignoring case (an alias matches nothing) |
| `host:<host>` | on that host or a subdomain of it (`host:cloudflare.com` keeps `developers.cloudflare.com`) |
| `in:<workspace>` | in the workspace with that name, ignoring case |
| `is:pinned`, `is:dead` | pinned; dead (`dead_since` set) |
| `state:<state>` | in that state: `pending`, `active`, `unreachable` or `archived`; `expired` keeps only expired links, `any` every state |

Without a `state:` filter expired links are left out and archived links are
kept; `state:dormant` is refused as any unknown value is. Any other `word:` is
a free word. A query of filters only lists the matching links in stream
order (the archived ones last, newest last use first), each snippet `[]`,
with the stream's cursor.

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
as in `GET /api/v1/search`, with expired links left out unless a `state:`
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
summary, topic path (its names joined with ` > `), tags and note together, then its reader-view text up to the
first 50,000 characters (a link with no reader-view text has only the first).
Items are the best-matching passages, best first by `score`, the passage's
similarity to the question; only a score of 0.5 or more is returned, so a
question unrelated to anything in the library answers `{"items": [], "meaning":
"used"}`. At most 3 passages of one link are returned and the rest of the
limit goes to other links. `url` is the link's original URL. The request
records no use of any link.

A link is found by meaning once it is indexed: within about a minute of its
reader text, title, summary, topic, tags or note being stored or changed (a
topic's rename changes the links beneath it too), and
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

#### `GET /api/v1/links/{id}/related`

The owner's other links nearest in meaning to the link, worked out when they
are asked for. The link's first passage (its title, summary, topic, tags and
note) is the question, matched only against the passages cut from the other
links' title, summary, topic, tags and note, never their reader-view text, with
one passage of each link; the link itself is left out, and so are expired
links.

```json
{
  "items": [{ "id": "…", "title": "Cloudflare Queues explained", "…": "…", "score": 0.7071 }]
}
```

Items are links as `GET /api/v1/links` returns them, each with `score`, the
similarity of its best passage, 0.7 or more (stricter than the 0.5 of
passages); best first, at most 5. A link that is not indexed yet, or that
nothing in the library is near, answers `{"items": []}`, and fewer than 5 is
usual. A link indexed before related links matched metadata alone is not
returned as related to another until the backfill has indexed it again. The
request records no use of any link.

Errors: `404 not_found` for a link that is not the owner's; `503
search_unavailable` as for passages.

### Ask

#### `POST /api/v1/ask`

Asks the library a question, which the owner's own AI provider answers from
passages of the owner's own links: `{"question": "<text>", "detailed": false}`.
The question is at most 500 characters, written in the search query language;
`detailed` (optional, default `false`) asks for a longer, thorough answer. Its free words are the
question, and the prefix filters narrow the passages exactly as in
`GET /api/v1/passages`. The provider is the one saved under settings, called
with the owner's key and model; nothing about the question or the answer is
stored. An ask counts once against the 600 requests a minute and records no use
of the links it cites.

Every refusal that can be known before the provider is called is answered as
JSON, in this order, and calls neither the provider nor (from the key check on)
the index:

- `400 {"error": "invalid_json", …}` for a body that is not a JSON object;
- `400 {"error": "invalid_question", "field": "question", "message": "ask with
  at least one word"}` for a question that is missing, not text, empty, blank or
  only filters;
- `400 {"error": "question_too_long", "field": "question", "message": "a
  question of at most 500 characters"}`;
- `400 {"error": "invalid_detailed", "field": "detailed", "message": "detailed
  must be true or false"}`;
- (a `state:` or `is:` with a value the filter does not take is not refused
  here, as it is in search: a question is prose, and "what I mean is: …" reads
  as words;)
- `409 {"error": "no_ai_key", "message": "add an AI key in settings"}`;
- `409 {"error": "ai_key_rejected", "message": "<the provider's message>"}`
  while the saved key is marked rejected;
- `503 {"error": "search_unavailable", "message": "search by meaning is
  unavailable, try again"}` when Workers AI or Vectorize fails or takes over 5
  seconds.

Otherwise the answer is `200` with `Content-Type: text/event-stream`, a stream
of events, each an `event:` line and a JSON `data:` line:

1. one `sources`: `{"sources": [{"n": 1, "link": <the link as the stream lists it>}]}`,
   one entry per link the passages came from, numbered from 1 in the order of
   their best passage;
2. `delta` events `{"text": "<next part of the answer>"}`, the answer citing its
   sources as `[n]`;
3. one `done`: `{}`.

Alexandria retrieves the 8 best passages (at most 3 of one link, at most 1,500
characters each, as `GET /api/v1/passages` would return them under the same
filters) and sends them, each headed by its source's number and title, with the
free words of the question to the provider. The provider is instructed to
answer from the passages only, to cite every statement as `[n]`, to write plain
text in short paragraphs without Markdown or other formatting, and to answer
"Nothing in your library answers this." when they do not. A detailed ask
retrieves the 16 best passages instead (their sources start with the 8 best
passages' sources, numbered alike), adds an instruction to write a detailed,
thorough answer, and lets the answer run to
4,096 tokens instead of 1,024. When no passage
reaches the similarity threshold the provider is not called and the answer is
`sources` with an empty list, that one `delta`, and `done`.

Once the stream has started, a failure ends it with one `error` event
`{"error", "message"}` and no `done`, after whatever `delta` events arrived:

| `error` | When | Also |
|---|---|---|
| `ai_key_rejected` | the provider answered 401, 402 or 403; `message` is the provider's | the key is marked rejected, as a rejected enrichment marks it (`GET /api/v1/settings/ai` shows `status: "rejected"`) |
| `provider_unavailable` | the provider could not be reached, answered 5xx, or had not finished within 60 seconds | |
| `provider_failed` | any other failure: a rate limit (`rate limited: …`), a refused request, a refusal ("the model declined") or an empty answer; `message` is the provider's | |

### Topics and tags

The topics and tags enrichment and the owner's edits give links. Topics form a
tree of at most three levels: a topic has one parent topic or none (a
top-level topic, level 1); its children are level 2 and theirs level 3. A link
is filed under one topic, at any level. A tag whose last link loses it (by an
edit, a merge, decay's removal or a deletion) is deleted: it is neither listed
nor offered to enrichment again. So is a topic left with no link filed under
it and no child topic, and then each of its ancestors left the same way; a
topic with no link of its own but with children stays.

#### `GET /api/v1/topics`

Every topic, newest link first:
`200 {"items": [{"id", "name", "parent_id", "count", "subtree_count", "newest_added_at"}], "next_cursor"}`,
with `limit` (1 to 100, default 50) and `cursor`. `parent_id` is `null` for a
top-level topic; `count` is the number of links filed directly under the topic
and `subtree_count` the number filed under it or any topic beneath it, both in
any state (expired included); `newest_added_at` is the added date of the
newest of those links.

#### `GET /api/v1/tags`

Every tag that has a link, with the number of its links in any state and the
added date of its newest link, newest first:
`200 {"items": [{"id", "name", "count", "newest_added_at"}], "next_cursor"}`,
with `limit` and `cursor` as for topics.

#### `PATCH /api/v1/topics/{id}` and `PATCH /api/v1/tags/{id}`

Renames a topic or tag: `{"name": "<new name>"}`. Every link carrying it shows
the new name, and the old name becomes an alias of it (see below).
`200 {"id", "name", "count"}`.

A tag name is lower-cased and must be 1 to 50 characters of letters and digits
in hyphen-joined words (`web-dev`); a topic name is trimmed, its spaces
collapsed, and must be 1 to 100 characters without `>`. Otherwise
`400 {"error": "invalid_name", "field": "name", "message"}` (for a topic, the
message is "a topic name of 1 to 100 characters, without >"). A renamed topic
keeps its place in the tree and its children; every link filed under it or
beneath it is marked changed, as its `topic_path` changes. A name another
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

Merging a topic also makes its children children of the survivor, with their
own children beneath them, marks every link filed under the source or beneath
it as changed and indexes them again with their new paths. A former parent of
the source left with no link and no child topic is deleted. Nothing changes
when the merge is refused:

- `409 {"error": "invalid_merge", "message": "a topic cannot merge into a topic beneath it"}`;
- `409 {"error": "too_deep", "message": "topics are at most three levels deep"}`:
  a child of the source would end up at level 4 or below.

#### `POST /api/v1/topics/{id}/move`

Moves a topic under another topic, `{"parent": "<topic id>"}`, or to the top
level, `{"parent": null}`. The topics beneath it move with it. Every link
filed under it or beneath it is marked changed, so the stream's change feed
returns it, and is indexed again for word and meaning search with its new
path. A former parent left with no link and no child topic is deleted, and so
is its parent when that leaves it the same way.
`200 {"id", "name", "parent_id", "count", "subtree_count"}` of the moved
topic; moving a topic under the parent it already has answers the same and
changes nothing.

- `400 {"error": "invalid_move", "field": "parent", "message"}`: `parent` is
  missing, or neither `null` nor a non-empty string;
- `404 {"error": "not_found"}`: the topic or the parent is not one of the
  user's;
- `409 {"error": "invalid_move", "message": "a topic cannot move under itself"}`:
  the parent is the topic or a topic beneath it;
- `409 {"error": "too_deep", "message": "topics are at most three levels deep"}`:
  the topic or a topic beneath it would end up at level 4 or below.

Nothing changes when a move is refused.

#### `POST /api/v1/topics/{id}/split`

Divides the links filed directly under a topic into sub-topics, in one request
to the owner's AI provider, which has 60 seconds to answer; the request waits
for the answer and applies it before it answers. No body. The provider is sent
each such link's title and summary, numbered from 1 (never the link's id), and
the names of the topic's existing children, and returns 2 to 10 sub-topics,
each with the numbers of the links that belong under it; a link it leaves out
stays under the topic. Each sub-topic a
link is filed under is reused where it already is when an existing topic has
its name (ignoring case, as an alias, or as a near name such as a plural), and
is otherwise created as a child of the topic; each link is filed under its
sub-topic and marked changed, and indexed again for word and meaning search.
Links whose topic the owner edited are neither sent nor moved. A topic is
split only when the owner asks for it.

`200 {"topic": {"id", "name", "parent_id", "count", "subtree_count"}, "children": [{"id", "name", "count"}], "moved": <n>}`:
`children` is every child of the topic after the split, by name, and `moved`
the number of links whose topic changed. When every link went to a topic that
already existed elsewhere, the emptied topic is removed with them: `topic` is
then `null` and `children` empty. Refused, changing nothing:

- `404 {"error": "not_found"}`: the topic is not one of the user's;
- `409 {"error": "too_deep", "message": "topics are at most three levels deep"}`:
  the topic is at level 3;
- `409 {"error": "too_few_links", "message": "a topic needs at least 20 links to be split"}`
  and `409 {"error": "too_many_links", "message": "a topic with more than 500 links cannot be split at once"}`,
  counting every link filed directly under the topic;
- `409 {"error": "no_ai_key", "message": "add an AI key in settings"}`, and
  `409 {"error": "ai_key_rejected", "message": "<the provider's message>"}` while
  the saved key is marked rejected, as `POST /api/v1/ask` answers;
- the provider's failures, with Ask's codes and the provider's message:
  `409 {"error": "ai_key_rejected", "message"}` when it rejects the key, which
  is then marked rejected; `503 {"error": "provider_unavailable", "message"}`
  when it is unreachable, answers 5xx or gives no answer within 60 seconds;
  `502 {"error": "provider_failed", "message"}` for any other failure;
- `502 {"error": "provider_failed", "message": "the provider's split could not be used"}`
  for an answer that is not usable: fewer than 2 or more than 10 sub-topics, a
  name that is empty, over 100 characters or holds `>`, a link number that was
  not sent, or a link under two sub-topics.

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
order, the first line highest, among the links of equal points (each new link
has the start points; a link used more ranks above them; when a link was used
within that span, the import's times start that much later). A URL already in the library, or on an earlier
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

### Statistics

#### `GET /api/v1/stats`

The owner's library statistics, computed at the time of the request from what
the library stores, as one JSON object; query parameters are ignored and
nothing is changed. Every count covers only the owner's own links, and a link
counts in every group it belongs to. A failure while computing any section
answers `500 {"error": "internal"}`, with no partial result.

```json
{
  "library": {
    "total": 8,
    "by_state": { "pending": 2, "active": 3, "unreachable": 1, "expired": 1, "archived": 1 },
    "pinned": 1,
    "in_workspace": 1,
    "limit": 20000
  },
  "content": {
    "by_kind": { "html": 2, "pdf": 1, "other": 1, "unfetched": 4 },
    "with_snapshot": 1,
    "reader_empty": 1
  },
  "topics": {
    "total": 3,
    "by_level": { "1": 1, "2": 1, "3": 1 },
    "links_without_topic": 4,
    "largest": [
      { "id": "…", "name": "Testing", "path": ["Software engineering", "Testing"], "count": 2 }
    ]
  },
  "tags": {
    "total": 2,
    "used_once": 1,
    "links_without_tags": 5,
    "top": [{ "id": "…", "name": "rust", "count": 2 }]
  },
  "workspaces": { "total": 1, "largest": [{ "id": "…", "name": "Trip", "count": 1 }] },
  "hosts": { "distinct": 3, "top": [{ "host": "example.com", "count": 4 }] },
  "expiry": {
    "expiring": { "today": 2, "within_7_days": 2, "within_30_days": 2 },
    "points_histogram": [
      { "range": "≤0", "count": 2 },
      { "range": "1–7", "count": 2 },
      { "range": "8–30", "count": 2 },
      { "range": "31–60", "count": 2 },
      { "range": "61–90", "count": 2 },
      { "range": ">90", "count": 1 }
    ],
    "protected_at_risk": 2,
    "awaiting_removal": { "total": 4, "within_7_days": 2, "within_30_days": 3 },
    "settings": { "start_points": 60, "remove_days": 180 }
  },
  "health": {
    "unreachable": { "count": 9, "by_reason": [{ "reason": "HTTP 503", "count": 3 }] },
    "dead": { "count": 2, "dead_over_30_days": 1 },
    "enrichment": {
      "no_key": 1,
      "queued": 1,
      "enriched": 1,
      "failed": 3,
      "skipped": 1,
      "waiting_for_key": 1,
      "none": 1,
      "failed_by_reason": [{ "reason": "provider_failed", "count": 2 }]
    },
    "ai_key": "verified"
  },
  "backlog": {
    "fetch_pending": 3,
    "fetch_retrying": 1,
    "enrichment_queued": 2,
    "imports": [
      {
        "id": "…",
        "created_at": "2026-11-10T12:00:00.000Z",
        "added": 50,
        "waiting": 30,
        "in_progress": 20,
        "done": 0
      }
    ],
    "index_stale": 1,
    "vector_deletions": 2,
    "liveness_due": 2,
    "throttle_clear_at": "2026-11-10T12:12:00.000Z"
  },
  "activity": {
    "added_per_day": [{ "day": "2026-10-12", "count": 1 }, "… one per day …"],
    "uses_per_day": [{ "day": "2026-10-12", "count": 0 }, "… one per day …"],
    "added_last_7_days": 4,
    "added_last_30_days": 5,
    "most_used": [{ "id": "…", "title": "Example", "host": "example.com", "uses": 3 }],
    "never_used": 2,
    "fetches": { "ok": 3, "failed": 2, "failed_by_reason": [{ "reason": "HTTP 503", "count": 2 }] },
    "imports": [
      {
        "id": "…",
        "created_at": "2026-11-10T12:00:00.000Z",
        "url_lines": 2,
        "added": 1,
        "duplicates": 0,
        "invalid": 1,
        "not_imported": 0
      }
    ]
  }
}
```

- `library`: every link (`total`), in each state (every state present, adding
  up to `total`), pinned, in at least one workspace, and the 20,000-link limit.
- `content`: links by `content_kind` (`unfetched` for none yet), with a
  snapshot, and with an empty reader view.
- `topics`: every topic, by level, links with no topic, and the 10 topics with
  the most links filed directly under them, each with its path from the top
  level down.
- `tags`: every tag, tags on exactly one link, links with no tag, and the 10
  tags on the most links.
- `workspaces`: every workspace and the 10 with the most links.
- `hosts`: the distinct hosts and the 10 with the most links.
- `expiry`: points are computed at the time of the request, as for a link the
  API returns. An *unprotected* link is `active`, `pending` or `unreachable`
  and neither pinned nor in a workspace: one decay can expire. `expiring`
  counts the unprotected links at 0 points or below (`today`: at the next
  decay run), at 1 to 7 and at 8 to 30 points, matching their `decay_note`;
  `points_histogram` counts them in six ranges, always all six, in order.
  `protected_at_risk` counts the pinned or workspace links, neither expired
  nor archived, at 0 points or below. `awaiting_removal` counts the expired
  links decay will remove (neither pinned nor in a workspace), and of them
  those whose `removal_at` is within 7 and within 30 days (cumulative; a
  past `removal_at` counts in both). `settings` are the owner's
  `start_points` and `remove_days`.
- `health`: the unreachable links with the 5 most common `state_reason`s;
  the links with a failed liveness check (`liveness_failures` above 0), and
  those dead for 30 days or more; the links in each `enrichment_status`
  (`none` for none yet) with the 5 most common reasons of the failed ones;
  and the AI key's status, `none`, `verified` or `rejected`.
- `backlog`: what the database records as waiting for background work. The
  pending links and, of them, those with a failed attempt; the links queued for
  enrichment; the imports with links still waiting or in progress (newest
  first, at most 10), with the numbers `GET /api/v1/imports/{id}` reports; the
  links whose meaning index is out of date and the vectors waiting to be
  deleted; the links the next hourly run would enqueue for a liveness check;
  and `throttle_clear_at`, when the background throttle frees up (the later of
  its next slot and the import window), or `null` once that has passed.
- `activity`: from the history the library keeps, so only links still in it
  count. Days are UTC days: `added_per_day` and `uses_per_day` give one entry
  for each of the last 30 days, today included, oldest first, days with none
  included; `added_last_7_days` and `added_last_30_days` count over the same
  days. `most_used` lists the 10 links with the most uses in those 30 days
  (ties: the latest use first); `never_used` counts the links never used.
  `fetches` counts the fetch attempts of those days by outcome, with the 5
  most common failure reasons; `imports` lists the last 10 imports with their
  counts, newest first.

Every list holds at most 10 entries (5 for reasons), most first; ties are
broken by name (or host, or reason), A to Z ignoring case. An empty library
answers every count 0 (`limit` aside) and every list `[]`.

#### `GET /api/v1/stats/history`

The owner's daily record: for each UTC day, how many events of each kind
happened in the library, the library's size at the end of the day, and the
tokens the owner's AI provider calls used. Query: `days`, a whole number from 1
to 365 (default 30); any other value answers
`400 {"error": "invalid_days", "field": "days", "message": "days is a whole number from 1 to 365"}`.

```json
{
  "recorded_since": "2026-11-07",
  "days": [
    {
      "day": "2026-11-10",
      "added": 3,
      "used": 0,
      "expired": 0,
      "removed": 2,
      "deleted": 0,
      "archived": 0,
      "unarchived": 0,
      "restored": 0,
      "fetch_ok": 0,
      "fetch_failed": 0,
      "enriched": 0,
      "enrichment_failed": 0,
      "asks": 0,
      "size": null,
      "ai": [
        {
          "purpose": "enrich",
          "model": "claude-opus-5-5",
          "calls": 2,
          "input_tokens": 300,
          "output_tokens": 40,
          "calls_without_usage": 0
        }
      ]
    }
  ]
}
```

`days` holds one entry per UTC day from `days − 1` days ago to today, oldest
first, every day present. `recorded_since` is the first day anything was
recorded for the owner, or `null`; every counter of a day before it is `null`
("not recorded"), and a recorded day on which nothing happened has 0.
`size` is the library at the end of the day (`total` and each state), or `null`
when it was not recorded. `ai` lists, by purpose (`enrich`, `split`, `ask`,
`key_test`) and model, the calls made, the input and output tokens the
provider reported, and the calls whose answer reported none. A counter never
goes down: deleting a link leaves the days that counted it as they were.

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
  "topics": [{ "id": "…", "name": "databases", "parent_id": null, "link_count": 2 }],
  "tags": [{ "id": "…", "name": "sql", "link_count": 3 }],
  "complete": true
}
```

Every link is there, in every state (expired included), as
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
expired links included, with the same credentials, but **recording no use**,
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


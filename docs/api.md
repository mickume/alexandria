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
  "updated_at": "2026-06-01T08:00:00.000Z"
}
```

`state` is `pending` until the link's first fetch, then `active`, or
`unreachable` after three failed attempts (`state_reason` says why: "timed
out", "HTTP 503", …). A fetch fills `final_url`, `http_status`, `title`,
`description`, `favicon_url`, `language`, `fetched_at` and `content_kind`
(`html`, `pdf` or `other`); `notes` holds remarks such as "truncated", "not a
web page (image/png)", "no text in this PDF" or "PDF too large to store (50 MB
limit)"; `has_snapshot` says whether Read and Snapshot are available.

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

#### `DELETE /api/v1/settings/ai`

Forgets the provider, model and key: `204`. Later links are not enriched.

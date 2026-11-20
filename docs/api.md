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
  "snapshot_at": null,
  "snapshot_kind": null,
  "snapshot_requested_at": null,
  "snapshot_error": null,
  "updated_at": "2026-06-01T08:00:00.000Z",
  "site": null,
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
Firecrawl instead when the deployment has a [Firecrawl key](configuration.md#the-ai-provider-and-firecrawl),
and then carries the note "fetched through Firecrawl"). Until a fetch
succeeds, `title` is the host,
then, once an attempt fails, words read from the address (unless the owner
edited it). A fetch fills `final_url`, `http_status`, `title`,
`description`, `favicon_url`, `language`, `fetched_at` and `content_kind`
(`html`, `pdf` or `other`); the fetched `title` (and the snapshot's) has
the site's own name removed, and may be shortened, for the hosts the
[title rules](configuration.md#title-rules) cover, such as GitHub's
"GitHub - " and " · GitHub" (an issue reads "Title · owner/repo#123");
`notes` holds remarks such as "truncated", "page could not be read", "not a
web page (image/png)", "no text in this PDF" or "PDF too large to store (50 MB
limit)". `has_snapshot` says whether a [snapshot](#snapshots) is stored, so
that it can be read; `snapshot_at` is when it was taken and `snapshot_kind`
what it is (`html` or `pdf`). `snapshot_requested_at` is set while a snapshot
asked for is being taken (it reads null once it is 15 minutes old, so that a
snapshot lost on the way never keeps a page waiting), and `snapshot_error`
says why the last one asked for failed, until another is asked for.

For a GitHub repository, issue or pull request, and for a YouTube video when
the deployment has a YouTube key, a fetch asks the site's API instead of
fetching the page (see [Retrievers](configuration.md#retrievers)). The link
then stores the site's own title ("repo: description", "Title ·
owner/repo#123", the video's title), a `description` of at most 300
characters, the thing's canonical address as `final_url`, 200 as
`http_status`, the text that search, Ask and enrichment read (the README, the
issue's body, the video's description), the note "retrieved through the
GitHub API" (or "… the YouTube API"), and `site`:

```json
{
  "retriever": "github",
  "kind": "repository",
  "retrieved_at": "2026-06-01T08:00:05.000Z",
  "facts": [
    { "key": "stars", "label": "Stars", "value": "12.3k", "card": true },
    { "key": "language", "label": "Language", "value": "TypeScript", "card": true },
    { "key": "owner", "label": "Owner", "value": "acme", "card": false }
  ]
}
```

`retriever` is `github` or `youtube`; `kind` is `repository`, `issue`,
`pull_request` or `video`; `retrieved_at` is the last successful retrieval;
`facts` lists the site's details in order, each `value` as it is shown, and
`card` marks the (at most 3) the card shows. A repository's facts are Stars,
Language, Archived (only when it is), Owner, Topics, License and Last push; an
issue's or pull request's State ("open issue", "merged pull request", …),
Comments, Author and Opened; a video's Channel, Duration, Published and
Thumbnail (an address). A fact the API does not give is left out. `site` is
null for a link no retriever has retrieved. When the API cannot answer, the
page is fetched as for any other link, `site` keeps what an earlier
retrieval stored, and the fetch's history event says why (see below).

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
other than pinned, dead or in-workspace,
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

The link's uses, fetch attempts and snapshots, newest first:
`200 {"items": [<event>], "next_cursor"}`, where an event is
`{"kind": "use", "at"}` or
`{"kind": "fetch" | "snapshot", "at", "outcome": "ok" | "failed", "http_status": <number or null>, "reason": <string or null>}`.
Query: `limit` (1 to 100, default 100), `cursor`. A successful fetch has a
reason only when its site's API could not answer and the page was fetched
instead ("GitHub API: rate limited; fetched as the page", the failure being
one of "unreachable", "timed out", "rate limited", "key refused", "not found"
and "unusable answer"), or when a repository's README could not be read
("GitHub API: README could not be read").

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

### Snapshots

A link's snapshot is the copy of its page Alexandria keeps, readable whatever
happens to the site, as a reading service keeps one. For a web page it is the
page's article alone (the title, byline, headings, paragraphs, lists, code,
tables, figures and links; no navigation, sidebars, comments, styles or
scripts), sanitised, with the article's images downloaded and stored with
it. For a PDF it is the whole file. A link has at most one.

A snapshot is taken when the owner asks for one (`POST
/api/v1/links/{id}/snapshot`, the MCP tool `take_snapshot`), or when a link
without one is [archived](#archive). The first successful fetch of a PDF stores
it as the link's snapshot. Nothing else takes or changes one: a fetch of a web
page stores its metadata and its article text (for search, Ask, enrichment and
the meaning index) but no copy of the page, and a refresh never changes the
snapshot, a PDF's included.

A snapshot is served from storage alone, never from the origin, and only to
the link's owner. A link without one answers
`404 {"error": "no_snapshot", "message": "no snapshot stored for this link"}`
and records no use.

#### `POST /api/v1/links/{id}/snapshot`

Takes a snapshot in the background: `202 {"status": "queued"}`, and the link's
`snapshot_requested_at` is now. Taking a snapshot is a refresh that also
stores the copy: the page is fetched again as every fetch is (the host gate,
the redirect checks, the limits, Firecrawl behind a bot check), the link's
metadata, text and enrichment are updated as a refresh updates them, and then:

- for a web page, its article is extracted and each of its images is
  downloaded and stored, through the host gate and the same checks, 15
  seconds each, never through Firecrawl. Only JPEG, PNG, GIF, WebP, AVIF and
  SVG are stored, at most 100 images of 10 MB each and 50 MB in all, in the
  order they appear. For an image with a `srcset` (or in a `<picture>`), the
  widest candidate at most 2000 pixels wide is saved (else the highest density
  at most 2x, else its `src`). An image that is not stored becomes a
  placeholder with its alt text and a link to its original address, and the
  snapshot notes "N images could not be saved"; it does not make the snapshot
  fail.
- for a PDF of at most 50 MB, the file is stored.

The new snapshot replaces the previous one, whose objects, images included,
are deleted; `snapshot_requested_at` becomes null and the link's history gains
a `snapshot` event with outcome `ok`. A snapshot that fails leaves the
previous one exactly as it was, is not retried, sets `snapshot_error` to its
reason and adds a failed `snapshot` event: the fetch's own reason ("timed
out", "HTTP 404", …, changing nothing else of the link), "no readable content"
(less than 200 characters of article text; the metadata and text are still
updated), "not a web page (image/png)" or "PDF too large to store (50 MB
limit)".

At most one snapshot per link per 10 minutes, apart from refreshes: another
is `429 {"error": "snapshot_recent", "message": "a snapshot was taken recently"}`
with `Retry-After` in seconds. When the fetch cannot be queued:
`503 {"error": "unavailable", "message": "the snapshot could not be queued"}`,
and the window is not used up.

#### `GET /api/v1/links/{id}/snapshot`

Records a use and returns the snapshot:

```json
{
  "content_kind": "html",
  "title": "An Article",
  "byline": "By Ada Writer",
  "html": "<h1>An Article</h1><p>…</p><img src=\"/api/v1/links/…/snapshot/images/…-1.png\" alt=\"Figure 1\">",
  "taken_at": "2026-10-01T09:00:00.000Z",
  "notes": ["1 images could not be saved"]
}
```

For a PDF, `html` and `byline` are null and `file_url` is
`/api/v1/links/{id}/snapshot/file`. The `title` is cleaned by the
[title rules](configuration.md#title-rules) as the link's own is.

#### `GET /api/v1/links/{id}/snapshot/file`

A PDF snapshot's file, `application/pdf`,
`Content-Disposition: inline; filename="<title>.pdf"`, or `attachment` with
`?download=1`. It records no use (reading the snapshot did). A link whose
snapshot is not a PDF answers `404 no_snapshot`.

#### `GET /api/v1/links/{id}/snapshot/images/{name}`

One stored image of the snapshot, with its stored type,
`X-Content-Type-Options: nosniff` and `Cache-Control: private,
max-age=31536000, immutable` (a new snapshot's images never take an earlier
one's names). An SVG is served with
`Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'`,
so that its scripts never run. It records no use. A name the link's current
snapshot does not hold answers `404 {"error": "not_found"}`.

#### `GET /api/v1/links/{id}/text`

Records a use and returns the link's stored article text (a PDF's extracted
text, at most 500,000 characters): `200 {"id", "text"}`, or
`404 {"error": "no_text", "message": "no text stored for this link"}`.

Deleting a link (`DELETE /api/v1/links/{id}`) also deletes its snapshot, its
images, its text and its fetch events.

#### `POST /api/v1/links/{id}/refresh`

Fetches the link again in the background: `202 {"status": "queued"}`. When
the fetch succeeds it replaces the fetched metadata and the article text (never
the snapshot), sets the link `active` and clears its reason and notes; when it
fails, the link keeps everything it had and its history gains a failed fetch
event (a refresh is not retried). At most one refresh per link per 10
minutes: a second one is
`429 {"error": "refreshed_recently", "message": "already refreshed recently"}`
with `Retry-After` in seconds.

### Enrichment

Enrichment runs with the deployment's AI provider, model and key
(`AI_PROVIDER`, `AI_MODEL` and `AI_API_KEY`; see
[The AI provider and Firecrawl](configuration.md#the-ai-provider-and-firecrawl)),
the same for every owner. The API has no AI settings: no key, nor any part of
one, is ever returned. Without a key, fetched links are `no_key`. When the
provider answers an enrichment, a question or a split with HTTP 401, 402 or
403 (a revoked key, no credit), the key is marked refused with the provider's
message, enrichment pauses, and links reaching it wait as `waiting_for_key`.
A different key, or an hour gone by, lifts the refusal; the every-minute run
then queues the `no_key` and `waiting_for_key` links again, 20 a minute.

#### `POST /api/v1/links/enrich-unenriched`

Schedules every link waiting to be enriched (`no_key`, `waiting_for_key` or
`failed`) through the background throttle, at most 20 a minute, and marks
them `queued`: `202 {"queued": <n>}`. When the deployment has no key, or its
key is refused: `409 {"error": "no_ai_key", "message": "this deployment has no AI key"}`.

#### `POST /api/v1/links/{id}/enrich`

Runs the link's enrichment again, at once and outside the throttle:
`202 {"status": "queued"}`. Without a usable key:
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
with its [snapshot](#snapshots), which is taken when it has none.

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
positions after it close up; its workspaces are kept. `200 <link>`.

A link with a snapshot keeps it, and nothing is fetched. A link without one
gets a [snapshot](#snapshots) taken, as `POST /api/v1/links/{id}/snapshot`
takes one, outside the 10-minute snapshot and refresh windows (which it neither
waits for nor starts); the answer comes without waiting for it, with
`snapshot_requested_at` set. The link stays `archived` whatever the snapshot
does; when it fails the link stays without one and its history records the
failure. When the snapshot cannot be queued the link stays archived,
`snapshot_error` and its history's failed `snapshot` event say "snapshot before
archiving could not be queued". A link already archived: `200 <link>`,
unchanged, and nothing is queued. Another user's link, or one that does not
exist: `404`.

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
snapshot and decays like any other.

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

A query is free words and prefix filters. Every free word must match a whole
word, case- and accent-insensitively and in any of its English forms (`queue`
finds "Queues", `cafe` finds "Café"; `cloud` does not find "Cloudflare"), in the link's title, summary, tags, topic (any name of
its topic path), host, original URL, note or article text. Quotes and the full-text engine's
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
| `is:pinned`, `is:dead`, `is:in-workspace` | pinned; dead (`dead_since` set); in at least one workspace |
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
free words by keyword, the links one of whose passages answers the query, or
both, in one ranking, so that a page saved as "Durable Objects alarms" is
found by "scheduling work in the background". The passages are found as
`GET /api/v1/passages` finds them (by their words and by meaning, then ordered
by the reranker): a link that is no keyword match is listed when one of its
passages reaches the relevance threshold, and passages add at most 50 such
links to a query. The filters apply to those links as to keyword matches.

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
  the matched words marked); a meaning match has the run of at most 32 words of
  its best passage that the reranker scores highest against the query, with the
  query's words marked where they occur, or the passage's first 32 words,
  nothing marked, when the reranker could not be used.
- **The ranking** has two tiers. First the links whose title, tags and topic
  together hold every free word; then every other match. Within a tier links
  are ordered by reciprocal rank fusion of their place in the keyword ranking
  (the first 1,000 keyword matches take part) and the place of their best
  passage, so a strong keyword match is never below a link found by meaning
  alone, and a link found both ways comes before one found a single way. Links
  of equal score are ordered as keyword search orders its ties: pinned (by
  position), then the more recently used, then by id. Every link keyword search
  finds is returned.
- **Paging** is by a signed `next_cursor` of its own kind: for a query with free
  words, a cursor of one mode is `400 invalid_cursor` in the other (a query of
  filters only is answered alike in both modes, with the stream's cursor). The
  ranking is computed for the first page and kept for 15 minutes, and every
  later page continues it: every result appears once across the pages, in one
  order, whatever happens to Workers AI meanwhile, and a link deleted between
  pages is left out. A cursor used more than 15 minutes after its first page
  is `400 {"error": "invalid_cursor", "field": "cursor", "message": "the search
  is too old: search again"}`. The first page lists the matching workspaces,
  as in keyword mode.
- **`meaning`** says whether meaning took part, and is the same on every page
  of a search. The search waits at most 3 seconds for the embedding, the index
  and the reranker together:
  - `used`: the passages were found by meaning and ordered by the reranker;
  - `unranked`: the reranker failed or was late. The links listed for their
    passages are those whose best passage is similar enough to the query (0.5
    or more), in the fused order;
  - `unavailable`: Workers AI (the embedding) or Vectorize failed or was late.
    The answer is the keyword results of the query, each `match: "keyword"`.

  A hybrid search never answers 5xx because of the index or the reranker.

### Passages

#### `GET /api/v1/passages`

The pieces of the owner's links that best answer a question. `?q=<question>`,
at most 200 characters, with `limit` (1 to 20, default 8). The question is
written in the search query language: its free words are the question, and the
prefix filters narrow the links exactly as in `GET /api/v1/search`, with
expired links left out unless a `state:` filter says otherwise.

```json
{
  "items": [
    {
      "link_id": "…",
      "title": "Durable Object alarms",
      "url": "https://example.com/durable-object-alarms",
      "passage": "An alarm lets a Durable Object schedule a task to run later…",
      "score": 0.93,
      "match": "both"
    }
  ],
  "meaning": "used"
}
```

Each link is cut into passages of at most 1,500 characters: its title,
summary, topic path (its names joined with ` > `), tags and note together, then
the first 200,000 characters of its reader-view text (a link with no
reader-view text has only the first). Consecutive passages of the reader text
overlap: each starts with the last sentence of the one before it, when that is
at most 200 characters. Reader text past 200,000 characters is found by
`GET /api/v1/search` only.

Passages are found in three steps, the same for this request, for a search with
`mode=hybrid` and for `POST /api/v1/ask`:

1. **Candidates.** The 100 passages nearest the question by meaning (a reader
   passage is compared as its text after its link's title and topic path), and
   the 100 passages that best match its free words: a passage holding at least
   one of them, whole and in any of its English forms, more of them and rarer
   ones ranking higher.
2. **Fusion.** The two lists become one by reciprocal rank fusion, and the best
   50 go on.
3. **Reranking.** A reranker reads the question with each of the 50 and gives
   each a relevance from 0 to 1, which orders them. Only a passage whose
   relevance reaches the relevance threshold (0.2, provisional) is returned, so
   a question unrelated to anything in the library answers `{"items": [],
   "meaning": "used"}`.

`score` is the passage's relevance, and `match` says how it was found:
`keyword` (by its words), `meaning` or `both`. At most 3 passages of one link
are returned and the rest of the limit goes to other links. `url` is the link's
original URL. The request records no use of any link.

`meaning` says whether meaning took part; the request waits at most 5 seconds
for the embedding, the index and the reranker together:

- `used`: as above;
- `unranked`: the reranker failed or was late. The fused order stands; a
  passage found by meaning is returned when its similarity to the question is
  0.5 or more, with that similarity as its `score`, and a passage found by its
  words alone is returned with `score: null`;
- `unavailable`: Workers AI (the embedding) or Vectorize failed or was late.
  The passages are those found by their words, ordered by the reranker when it
  answers, each with `score: null`.

A link is found once it is indexed: within about a minute of its reader text,
title, summary, topic, tags or note being stored or changed (a topic's rename
changes the links beneath it too), and for links that existed before the
index, or before a change to how links are indexed, once the backfill has
reached them (60 links a minute per user); until then such a link is found by
the passages it had. Nothing shows whether a link is indexed yet. A deleted
link's passages are gone at once.

Errors: `400 {"error": "invalid_question", "field": "q", "message": "ask with
at least one word"}` for a `q` that is absent, blank or only filters;
`query_too_long` and `invalid_filter` (field `q`) as in search;
`400 {"error": "invalid_limit", "field": "limit", "message": "limit must be an
integer from 1 to 20"}`. `503 {"error": "search_unavailable", "message":
"search by meaning is unavailable, try again"}` only when the passages cannot
be read at all; Workers AI or Vectorize failing does not refuse the request.

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

Asks the library a question, which the deployment's AI provider answers from
passages of the owner's own links: `{"question": "<text>", "detailed": false}`.
The question is at most 500 characters, written in the search query language;
`detailed` (optional, default `false`) asks for a longer, thorough answer. Its free words are the
question, and the prefix filters narrow the passages exactly as in
`GET /api/v1/passages`. The provider is the deployment's, called with its key
and model ([configuration](configuration.md#the-ai-provider-and-firecrawl)); nothing about the question or the answer is
stored. An ask counts once against the 600 requests a minute and records no use
of the links it cites.

Every refusal is answered as JSON before any stream starts, in this order;
those down to the refused key call neither the provider nor the index:

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
- `409 {"error": "no_ai_key", "message": "this deployment has no AI key"}`;
- `409 {"error": "ai_key_rejected", "message": "<the provider's message>"}`
  while the deployment's key is marked refused;
- `409 {"error": "ai_key_rejected", "message": "<the provider's message>"}`
  when the provider rejects the key (401, 402, 403) while it is asked for the
  question's phrasings (below); the key is marked refused;
- `503 {"error": "search_unavailable", "message": "search by meaning is
  unavailable, try again"}` when the passages cannot be read at all. Workers AI
  or Vectorize failing does not refuse the question: see `meaning` below.

Otherwise the answer is `200` with `Content-Type: text/event-stream`, a stream
of events, each an `event:` line and a JSON `data:` line:

1. one `sources`: `{"sources": [{"n": 1, "link": <the link as the stream lists it>}],
   "queries": ["<the question>", "<a phrasing>"], "meaning": "used"}`: one
   entry per link the passages came from, numbered from 1 in the order of
   their best passage; `queries`, what the passages were searched with, the
   question as typed first; and `meaning`, as `GET /api/v1/passages` gives it;
2. `delta` events `{"text": "<next part of the answer>"}`, the answer citing its
   sources as `[n]`;
3. one `done`: `{}`.

Before retrieving, Alexandria asks the provider for the question as search
queries: the question restated, then at most two other ways of asking it, each
at most 200 characters. The passages are found with the question as typed and
with every phrasing (at most four queries): each gives its candidates, all are
fused, and the reranker reads them against the question as typed, so a
phrasing can add passages but never changes what counts as an answer. The
question's filters apply to every phrasing. When that call fails otherwise
than by rejecting the key, answers nothing usable or takes over 10 seconds,
the question as typed is used alone; a phrasing over 200 characters, a
repeated one and those past the third are dropped.

Alexandria then takes the 8 best passages (at most 3 of one link, as
`GET /api/v1/passages` would return them under the same filters) and sends the
provider one block per source: its number and title, its topic path, host, the
day it was added and its summary, then its passages in the order of the page,
each with the passage before it and the one after it. Passages that follow one
another are joined and what they share appears once; a gap is marked `[…]`.
The passages sent hold at most 40,000 characters; over that, the neighbouring
passages are left out, from the last source up. The free words of the question
follow. The provider is instructed to answer from the passages only, to cite
every statement as `[n]`, to write plain text in short paragraphs without
Markdown or other formatting, and to answer "Nothing in your library answers
this." when they do not. A detailed ask takes the 16 best passages instead,
sends at most 80,000 characters, adds an instruction to write a detailed,
thorough answer, and lets the answer run to 4,096 tokens instead of 1,024; its
phrasings are asked for again. When no passage is found the answering call is
not made and the answer is `sources` with an empty list, that one `delta`, and
`done`.

Once the stream has started, a failure ends it with one `error` event
`{"error", "message"}` and no `done`, after whatever `delta` events arrived:

| `error` | When | Also |
|---|---|---|
| `ai_key_rejected` | the provider answered 401, 402 or 403; `message` is the provider's | the deployment's key is marked refused, as a rejected enrichment marks it (`GET /api/v1/stats` shows `health.ai_key: "rejected"`) |
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
- `409 {"error": "no_ai_key", "message": "this deployment has no AI key"}`, and
  `409 {"error": "ai_key_rejected", "message": "<the provider's message>"}` while
  the deployment's key is marked refused, as `POST /api/v1/ask` answers;
- the provider's failures, with Ask's codes and the provider's message:
  `409 {"error": "ai_key_rejected", "message"}` when it rejects the key, which
  is then marked refused; `503 {"error": "provider_unavailable", "message"}`
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
  snapshot, and fetched with no article text (`reader_empty`).
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
  and the status of the deployment's AI key, `none` (unset), `verified` or
  `rejected` (refused by its provider within the hour).
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
      "text_url": "https://alexandria.example.com/api/v1/export/links/…/text"
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
`GET /api/v1/links/{id}` returns it, with `snapshot_url` and `text_url`
(`null` when nothing of that kind is stored). A workspace's `link_ids` are in
its manual order. The document is sent as it is read: when reading fails
part-way the download breaks off, so a file that does not end with
`"complete": true` (and does not parse) is not a whole export. The export holds
nothing else: no settings, no part of a key, no tokens, sessions or import
reports.

#### `GET /api/v1/export/links/{id}/snapshot` and `GET /api/v1/export/links/{id}/text`

The `snapshot_url` and `text_url` of an export entry: the link's snapshot and
article text exactly as `GET /api/v1/links/{id}/snapshot` and
`GET /api/v1/links/{id}/text` serve them, expired links included, with the
same credentials, but **recording no use**, so that fetching a backup does not
reset the library's decay. In the exported snapshot, the images' addresses and
a PDF's `file_url` are the export's own:
`GET /api/v1/export/links/{id}/snapshot/images/{name}` and
`GET /api/v1/export/links/{id}/snapshot/file`, which serve exactly what the
link's own routes serve. A link of the user with nothing of that kind stored
answers `404 {"error": "no_content"}`; another user's link and an unknown id
answer `404 {"error": "not_found"}`.

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
| `search_passages` | `query`, `limit?` (1 to 20, default 8) | `GET /api/v1/passages` with the query as given as `q`: the passages that best answer it, by their words and by meaning, each with its link's id, title and URL; no use. A `search_unavailable` (503) is a tool error with that envelope, not `internal_error` |
| `get_link` | `id` | `GET /api/v1/links/{id}`: metadata and summary; no use |
| `get_link_content` | `id`, `format` (`text` or `html`) | `{id, format, content}`: the article text (a PDF's extracted text) from `GET /api/v1/links/{id}/text`, or the snapshot's article HTML from `GET /api/v1/links/{id}/snapshot`; one use, as those endpoints record. `no_content` when the link has no text, or no snapshot for `html`; `not_html` for `html` of a PDF snapshot |
| `take_snapshot` | `link_id` | `POST /api/v1/links/{id}/snapshot`: `{status: "queued"}`; `snapshot_recent` within 10 minutes of the last |
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


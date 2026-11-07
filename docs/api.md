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

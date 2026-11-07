---
spec_id: "01"
spec_name: "accounts_links_and_stream"
title: "Sign in, add links and keep them in a private stream"
status: "active"
created_at: "2026-11-07T14:14:58Z"
intent_hash: "ed825e7f79a90bc8713a9c4e30002aede6aaa85534120b7ab3c260b1bb5c774e"
schema_version: 3
source: "docs/prd/01-build-the-alexandria-link-library.md"
---

# Sign in, add links and keep them in a private stream

## Intent

Alexandria is a personal, private library of web links for one person at a time. This package lays its foundation: an allow-listed owner signs in with Google, pastes links that are normalised, de-duplicated and kept in a reverse-chronological stream ordered by last use with pinned links on top, opens them through Alexandria so every use is recorded, and reaches all of it through a versioned, token-authenticated HTTP API with strict per-user separation. Every later capability of the library (fetching, enrichment, decay, search, workspaces, import, MCP, export) is built on the accounts, links, uses and API this package defines.

## Goals

- Pasting a URL into the site adds it to the top of the stream within 1 second, with its host name as a provisional title and a `pending` indicator.
- A visitor who is not signed in can reach nothing but the sign-in page; only Google accounts on the deployment's allow-list can sign in.
- A pinned link is always at the top of the stream; every other link in the stream is ordered by last use, and opening a link through Alexandria records the use.
- Every capability of the website in this package is available through the HTTP API with a personal access token, with the same per-user isolation.
- Each user's data is strictly separate: no request can read or change another user's links, tokens or sessions.
- The stream's first page is interactive within 1.5 seconds on a 4G connection with 50 links.

## Non-goals

- Fetching, metadata, snapshots, reader view and refresh: package 02 (`fetch_and_snapshot`). In this package every added link stays `pending`.
- Enrichment, the AI provider key and editing title, summary, tags and topic: package 03 (`ai_enrichment`).
- Workspaces and notes: package 04 (`workspaces_and_notes`).
- Decay (dormant, archive, removal), the Archive page, manual archive and restore, liveness: package 05 (`decay_and_liveness`).
- Search, the search box and its `/` and `Escape` shortcuts, Topics and Tags pages, list filters: package 06 (`search_and_browse`).
- Bulk import: package 07 (`bulk_import`). The MCP server: package 08 (`mcp_server`). Export and account deletion: package 09 (`export_and_account_deletion`).
- A native iPad / iOS app; this package only requires that the API be sufficient for it (token auth, cursor pagination).
- Sharing, collaboration, public pages, or any cross-user feature.
- Built-in user management: no passwords, password reset, profile pages, or roles. Identity comes from Google OAuth only; further OAuth providers are a later PRD.
- Browser extension, bookmarklet, share-sheet integrations or email-in capture.
- Offline / PWA operation of the website.

## Background

The repository is a skeleton: `README.md` ("My personal library"), an MIT `LICENSE`, `AGENTS.md` and `.specs/steering.md` (agent policy, with placeholder Repository Layout, Quality Commands and Repository Specifics sections), and the source PRD `docs/prd/01-build-the-alexandria-link-library.md`. There is no code, no `package.json`, no `Makefile`, no CI and no other spec package. Every component this package names is new, and this package creates the project itself: the TypeScript toolchain, the Cloudflare Worker and its D1 database, the React website built with Vite, the test setup, and the `make` targets that `AGENTS.md` lists.

Constraints the owner has set:

- Constraint: TypeScript throughout. Website in React with Vite; API in Hono; deployed to Cloudflare with `wrangler`. Cloudflare services are used where they fit.
- Constraint: external libraries only from very well-maintained projects with large communities; nothing stale.
- Constraint: no built-in user management. Authentication is OAuth 2.0 with Google as the only provider at launch. Only the Google account's email and display name are stored, nothing else from the profile.
- Constraint: strict per-user separation of data and processing.
- Constraint: visual design is minimalistic and modern: one typeface, generous whitespace, no decorative chrome, responsive down to a 375 px wide phone screen, light and dark mode following the system setting.
- Constraint: Linux and macOS for development; Windows is best effort (steering).

## Requirements

### Accounts and access

- A visitor who is not signed in sees only a sign-in page with one action: "Sign in with Google". Every other page and every API route returns 401 (API) or redirects to the sign-in page (website), except the public pages under `/about/` (see Design Decisions).
- Signing in completes the Google OAuth 2.0 authorization-code flow with PKCE. On success the user's email and display name are stored (created on first sign-in, updated on later ones) and a session is established. Nothing else from the Google profile is stored, and the Google access and refresh tokens are not retained after the sign-in completes.
- Only Google accounts whose email address is on an **allow-list** in the deployment configuration may sign in. A Google account not on the list completes the Google flow and is then shown "This library is private"; no user record and no session are created. The allow-list is read on every sign-in; changing it is a configuration change and touches no stored data. Removing an address from the list ends that user's ability to sign in or create tokens at the next request; their existing data is kept until the account is deleted.
- A session lasts 30 days of inactivity and is renewed on use; sign-out ends it immediately. A request with an expired or missing session is treated as not signed in.
- If Google returns an error or the state/PKCE check fails, the user is returned to the sign-in page with the message "Sign-in failed, please try again" and no user or session is created.
- Personal access tokens: a signed-in user can create a token with a name, see the list of their tokens (name, created date, last used date, never the secret again after creation), and revoke one. The secret is shown exactly once at creation. A token authenticates API requests as that user with the same rights as a session. A revoked token is refused with 401 from the next request on. A user can hold at most 20 tokens; creating the 21st fails with 409 and "token limit reached".

### Adding links

- The main page has one input at the top. The user pastes one URL or several (separated by whitespace or newlines) and presses Enter. Each URL is validated, normalised, and either added at the top of the stream as a new link in state `pending` or, if the normalised URL already exists for that user, the existing link is boosted and moved to the top instead and the user sees "already in your library, moved to top".
- URL normalisation, applied identically everywhere a URL enters (paste, API, and later MCP and import): trim whitespace; require scheme `http` or `https` (a bare `example.com` is given `https://`); lower-case the scheme and host; drop the fragment; drop a default port; drop these tracking query parameters and no others: every parameter whose name starts with `utm_`, and `fbclid`, `gclid`, `mc_cid`, `mc_eid`; sort remaining query parameters; drop a trailing slash on an otherwise empty path. Duplicate detection is on the normalised URL. The original pasted URL is kept and shown on the link's detail view.
- Invalid input (not a URL, unsupported scheme such as `javascript:`, `file:`, `data:`, a host that is a private or loopback IP address or `localhost`) is rejected with the message "not a valid web address" (website) or 400 with `{ "error": "invalid_url", "url": "<input>" }` (API). In a multi-URL paste, the valid ones are added and the invalid ones listed back.
- A user's library holds at most 20,000 links (all states). Adding past the limit fails with "library full (20,000 links)" / 409 `library_full`.
- The new link appears immediately with its host name as a provisional title and a `pending` indicator.

### The stream: ordering, use, pin, delete

- The main page is the **stream**: pinned links first, then every link that is not archived, ordered by **last used** descending (a new link's last used = its added time). The stream is paged, 50 links per page, infinite-scroll on the website and cursor-paged on the API. Each entry shows: favicon (where known), title, host, added date, last-used date, state, and actions (open, pin/unpin, delete). Later packages add summary, tags, topic, workspaces and further actions to the same card.
- **Use**: opening a link from the website or the API goes through a per-link "open" endpoint that records a use (increments the use count, sets last used = now) and redirects to the link's URL.
- **Pin**: a link can be pinned; pinned links form the top section of the stream in manual order (drag on the website, an explicit `position` on the API). At most 30 pinned links; pinning the 31st fails with "unpin something first" / 409 `pin_limit`.
- **Delete**: removes the link immediately. On the website a 10-second undo toast follows; on the API deletion is immediate and final.

### HTTP API

- Every website capability is an authenticated JSON HTTP API under one base path, versioned in the path (`/api/v1/`). Authentication is a session cookie (website) or `Authorization: Bearer <personal access token>` (everything else). An unauthenticated request gets 401 `{ "error": "unauthorized" }`; a request for another user's resource gets 404, never 403, so existence is not leaked.
- Resources in this package: links (list with cursor pagination, create, get, delete, open, pin/unpin), tokens, and the current user. Each list endpoint returns at most 100 items per page with an opaque cursor.
- Validation errors return 400 with `{ "error": "<code>", "field": "<name>", "message": "<text>" }`; limits return 409 with their code (`library_full`, `pin_limit`, `token_limit`); rate limits return 429 with `Retry-After`. The rate limit is 600 requests per minute per user.
- The API is described by an OpenAPI 3.1 document served at a documented path and kept in step with the implementation (a test fails when they differ).

### Website

- Pages in this package: sign-in, stream (home), link detail (original URL, normalised URL, added date, use count, history of uses), settings (personal access tokens).
- Responsive from 375 px wide; light/dark follows the system; one typeface; the stream's first page is interactive within 1.5 seconds on a 4G connection with 50 links.
- End-to-end flows the system must support unbroken:
  1. The owner signs in with Google, pastes `https://example.com/article?utm_source=x`, sees it at the top as `example.com` / pending; the owner clicks the title, is redirected to `https://example.com/article`, and the card now shows last used = now.
  2. The owner creates a personal access token on the settings page and copies its secret; a script adds a link and reads the stream with it; the owner revokes the token and the script's next request is refused with 401.

## Design Decisions

1. **Use is recorded through a redirect endpoint**, not client-side tracking, so the website, API, MCP and a later iOS app record uses the same way. (Source PRD decision 2.)
2. **Duplicates on paste boost the existing link** rather than being refused or added, because re-pasting is a signal of use. A boost sets last used to now but does not increment the use count: only an open (and, from package 02, a read or snapshot view) is a use. (Source PRD decision 3; the use-count rule settled in this run so that "sticky" in package 05 counts real opens.)
3. **Sign-in is allow-listed**, not open. Owner's decision: this is a personal site. The allow-list is the `ALLOWED_EMAILS` deployment variable, a comma-separated list compared case-insensitively.
4. **The tracking parameters stripped are exactly `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`.** `ref` and `source` are kept. Owner's decision.
5. **Session length 30 days of inactivity**, renewed on use. Owner's decision.
6. **A split into several spec packages.** This package is the foundation; packages 02 to 09 each add one area of the source PRD and depend on it.
7. **The Google endpoints are configuration.** The authorization and token endpoints are the deployment variables `GOOGLE_AUTH_URL` and `GOOGLE_TOKEN_URL`, defaulting to Google's, so that the end-to-end tests run the real flow against a local fake provider. Decided in this run: there is no other way to test the sign-in flow end to end without a real Google account.
8. **The open endpoint redirects to the link's normalised URL**, not the pasted original, because the tracking parameters are dropped on purpose. Decided in this run.
9. **A multi-URL paste holds at most 100 URLs**; more is refused with 400 `too_many_urls` and nothing added. Duplicates inside one paste collapse to their first occurrence, and the first URL of a paste ends highest in the stream, as an import does. Decided in this run: the source PRD sets no paste limit, and 100 matches the API's page size.
10. **A new pin goes to the bottom of the pinned section** unless a `position` is given; positions are 1-based and a position past the end means the end. Decided in this run.
11. **Mutating requests authenticated by the session cookie must come from the site's own origin.** A `POST`, `PUT`, `PATCH` or `DELETE` with a session cookie and an `Origin` header that is not `PUBLIC_ORIGIN` is refused with 403 `{ "error": "forbidden_origin" }`; token-authenticated requests are not affected. Decided in this run: the cookie is the website's credential, and this stops another site from acting with it.
12. **Personal access token secrets and session identifiers are stored only as SHA-256 hashes.** Decided in this run, so that a copy of the database authenticates nobody.
13. **The project layout and tooling.** One npm package at the repository root: the Worker in `src/worker/`, the website in `src/web/`, D1 migrations in `migrations/`, unit and integration tests beside the code run by Vitest (the Worker's in the Workers runtime through `@cloudflare/vitest-pool-workers` against local D1), end-to-end tests in `e2e/` run by Playwright against `wrangler dev`, and the `make` targets of `AGENTS.md` plus `make e2e`. Decided in this run: the repository had no layout, and the later packages name files in this one.
14. **Token names are 1 to 100 characters**, and a user whose address has left the allow-list is refused token creation with 403 `not_allowed` (existing tokens keep working until revoked, as the source PRD names only sign-in and token creation). Decided in this run: the source PRD sets no name length and no status for that refusal.
15. **The link detail view's history is an API resource**, `GET /api/v1/links/{id}/history`, newest first; this package writes `use` events into it and package 02 adds `fetch` events. Decided in this run, so that the detail view and a later native app read one list.
16. **A delete still pending in the website's undo window is sent at once when the page is hidden or left**, so that leaving the page never loses a deletion the owner made; a failed delete puts the card back with "could not delete, try again". Decided in this run.
17. **Pages under `/about/` are public.** Package 02 serves `/about/fetcher`, the page its User-Agent names to explain the fetcher to site operators, who have no account; the redirect to sign-in leaves `/about/` alone and serves nothing private there. Decided in this run.

## Dependencies

None: this is the first package. External systems: Google OAuth 2.0 (identity) and Cloudflare (Workers, D1, static assets).

## Verified External API

Read from the published packages on 2026-11-07:

- `hono` 4.13.17: `class Hono<E, S, BasePath>`; `createMiddleware(handler)` from `hono/factory`; `getCookie(c, name)` and `setCookie(c, name, value, opt?)` from `hono/cookie`.
- `arctic` 3.7.0: `new OAuth2Client(clientId: string, clientPassword: string | null, redirectURI: string | null)`; `createAuthorizationURLWithPKCE(authorizationEndpoint: string, state: string, codeChallengeMethod: CodeChallengeMethod, codeVerifier: string, scopes: string[]): URL`; `validateAuthorizationCode(tokenEndpoint: string, code: string, codeVerifier: string | null): Promise<OAuth2Tokens>`; `OAuth2Tokens.idToken(): string`; `decodeIdToken(idToken: string): object`; `generateState(): string`; `generateCodeVerifier(): string`.
- `@cloudflare/vitest-pool-workers` 0.23.0: `cloudflareTest(options): Vite.Plugin` and `readD1Migrations(migrationsPath: string): Promise<D1Migration[]>` from the package root; `SELF: Fetcher`, `env` and `applyD1Migrations(db, migrations, migrationsTableName?)` from `cloudflare:test`.
- Published and current, used for the build and tests only: `vitest` 5.1.0, `wrangler` 4.158.0, `@cloudflare/vite-plugin` 1.67.0, `vite` 8.3.6, `react` / `react-dom` 19.3.1, `typescript` 7.0.2, `eslint` 10.14.0, `typescript-eslint` 8.72.1, `prettier` 3.9.10, `@playwright/test` 1.65.0, `@testing-library/react` 16.3.3, `happy-dom` 21.0.4, `typedoc` 0.28.20, `zod` 4.6.7, `@hono/zod-validator` 0.9.1.

## Glossary

- **link**: one URL in a user's library, with its metadata and state.
- **stream**: the home page listing, pinned links first then by last use descending.
- **use**: an open of a link through Alexandria (later also a read or snapshot view), recorded with a timestamp.
- **boost**: resetting a link's last use to now (what a use and a re-paste do).
- **pinned**: a link held in the manually ordered section at the top of the stream.
- **personal access token**: a user-created secret that authenticates API (and later MCP) requests as that user.
- **allow-list**: the deployment's list of email addresses that may sign in.

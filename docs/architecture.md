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
  `pages/Settings` (tokens). `api.ts` is the client of the API, `format.ts`
  formats dates. `styles.css` holds the whole visual design: one system
  typeface, light and dark from `prefers-color-scheme`.

## Data

| Table | Holds |
|---|---|
| `users` | email (lower-case) and display name, nothing else from Google |
| `sessions` | the SHA-256 hash of each session id, its user and expiry |
| `tokens` | the SHA-256 hash of each token secret, its name, dates and revocation |
| `links` | per user: normalised and original URL, host, title, state, dates, use count, pin position |
| `link_uses` | one row per use of a link, the source of its history |
| `rate_limits` | requests per user per minute |

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

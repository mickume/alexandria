# Architecture

Alexandria is one Cloudflare Worker with a D1 database. The decisions behind
the layout are in [ADR 01](adr/01-build-on-a-cloudflare-worker-with-d1.md).

## Components

```
browser ──► Worker (src/worker/index.ts)
              ├── /api/v1/*   the JSON API (Hono)
              ├── /auth/*     sign-in with Google, sign-out
              └── pages       website's static assets (dist/client), after the session check
                     │
                     ▼
                 D1 (DB)      users, sessions, tokens, links, link_uses, rate_limits
```

- **The Worker** (`src/worker/`): `index.ts` is the entry point and hands every
  request to the Hono application built in `app.ts`. `env.ts` declares the
  bindings and variables, `clock.ts` the injectable clock. Feature code lives
  in one directory per area: `links/` (normalisation, the link store, the
  stream), `auth/` (sign-in, sessions) and `api/` as they are added.

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
  `main.tsx` mounts `App.tsx`, which picks the page for the current path.
  `styles.css` holds the whole visual design.
- **The database** (`migrations/`): plain SQL migrations applied in order.

## Test layers

| Layer                       | Where                     | Runs in                                           | What it proves                                                      |
| --------------------------- | ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| Worker unit and integration | `src/worker/**/*.test.ts` | workerd via `@cloudflare/vitest-plugin`, local D1 | Routes, middleware, SQL and pure functions, through the real Worker |
| Website                     | `src/web/**/*.test.tsx`   | happy-dom, fake API                               | Pages and components                                                |
| End to end                  | `e2e/*.spec.ts`           | Playwright (Chromium) against `wrangler dev`      | The whole flows, with only Google faked                             |

Shared helpers: `src/worker/test/helpers.ts` (requests through the Worker,
users, sessions, tokens, seeded links, the clock), `src/worker/test/outbound.ts`
(answers the Worker's outbound requests) and `src/web/test/helpers.tsx`
(`renderPage` with a `FakeApi`).

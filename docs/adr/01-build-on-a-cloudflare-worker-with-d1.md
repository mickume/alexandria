# 01. Build on one Cloudflare Worker with D1

## Status

Accepted (2026-11-07).

## Context

Alexandria starts from an empty repository. Its first spec package fixes the
stack (TypeScript, Hono, React with Vite, Cloudflare) and the layout that every
later package names files in.

## Decision

- **One npm package, one Worker.** The Worker in `src/worker/` serves the API
  (`/api/v1/`), the sign-in routes (`/auth/`) and the website's static assets,
  built from `src/web/` by Vite with `@cloudflare/vite-plugin`. Page routes go
  through the Worker first (`assets.run_worker_first`) so that a visitor without
  a session is redirected to `/signin` before any page is served; built files
  under `/assets/` are served directly.
- **D1 holds every user's data.** The schema lives in `migrations/`, applied in
  order by wrangler in production and by `applyD1Migrations` in tests. Times are
  stored as ISO 8601 strings in UTC with milliseconds, which sort as they
  compare.
- **The clock is injectable.** Everything the Worker stores or compares reads
  `now()` from `src/worker/clock.ts`, which tests fix with `setNow()`.
- **Tests run in the real runtime.** Worker tests run in workerd through
  `@cloudflare/vitest-plugin` against a local D1 with the migrations applied;
  they reach the Worker through `SELF.fetch`, so a test exercises the same
  routing, middleware and SQL production does. Outbound requests (Google's
  token endpoint, later origins and AI providers) are answered by the router in
  `src/worker/test/outbound.ts`, which replaces the test isolate's `fetch` (the
  main Worker shares that isolate); a request no route claims fails the test.
  Website tests run in happy-dom against a fake API. End-to-end tests run
  Playwright against `wrangler dev` with a production build and a local fake of
  Google's OAuth endpoints.
- **The rate limit is counted in D1.** The per-user limit of 600 requests a
  minute is a counter per user and minute in the `rate_limits` table, because
  it must be exact and follow the injectable clock, which the platform's
  rate-limiting binding is not and does not.

## Toolchain versions

The spec named TypeScript 7.0.2, Vitest 5.1.0 and
`@cloudflare/vitest-pool-workers` 0.23.0. The project uses:

- **TypeScript 6.0.x**: TypeScript 7 ships without the compiler API, and
  `typedoc` 0.28 and `typescript-eslint` 8 accept TypeScript below 6.1 only.
- **`@cloudflare/vitest-plugin` 1.6.x**: `@cloudflare/vitest-pool-workers` is
  deprecated under that new name, and only the renamed package accepts
  Vitest 5. Its API is the one the spec names (`cloudflareTest`,
  `readD1Migrations`, `cloudflare:test`).

## Consequences

Every later package adds tables through a new migration, routes through
`src/worker/app.ts`, and tests through the shared helpers in
`src/worker/test/` and `src/web/test/`.

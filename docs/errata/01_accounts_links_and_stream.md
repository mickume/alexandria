# Erratum 01: accounts, links and stream

Where the implementation of spec `01_accounts_links_and_stream` differs from
what the spec says, and why.

1. **Toolchain versions.** The spec names TypeScript 7.0.2, Vitest 5.1.0 and
   `@cloudflare/vitest-pool-workers` 0.23.0. The project uses TypeScript 6.0.x
   (typedoc 0.28 and typescript-eslint 8 accept only TypeScript below 6.1, and
   TypeScript 7 has no compiler API) and `@cloudflare/vitest-plugin` 1.6.x, the
   renamed successor of the deprecated pool package, which is the one that
   accepts Vitest 5. See [ADR 01](../adr/01-build-on-a-cloudflare-worker-with-d1.md).
2. **Bare words are not URLs.** The normaliser also refuses an input whose
   host has no dot (`nope`, `https://intranet/`), as the spec's batch example
   (`'nope'` listed as `invalid_url`) requires; the spec's list of refusals
   did not name the case.
3. **A token's `last_used_at` is its last use.** PATH-2's end state says the
   token's `last_used_at` equals the script's first request; REQ-3.3 has every
   request set it, so after the script's two accepted requests it holds the
   second's time. The code follows REQ-3.3.
4. **The rate limit is counted in D1** (`rate_limits`, created by migration
   0001), because it must be exact and follow the injectable clock.
5. **Cursors are signed with a key derived from `GOOGLE_CLIENT_SECRET`**, so
   that they are tamper-evident without another variable to configure.

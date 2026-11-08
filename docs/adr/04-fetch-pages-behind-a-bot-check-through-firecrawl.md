# 04. Fetch pages behind a bot check through Firecrawl

## Status

Accepted (2026-11-08).

## Context

Some sites, Medium among them, sit behind Cloudflare's bot protection. They
answer any client that is not a browser running JavaScript with a 403
"Just a moment…" challenge marked `cf-mitigated: challenge`. Alexandria's
fetcher is a server-side `fetch` from the Worker. It cannot pass the
challenge and does not try to. Such links end `unreachable` with the reason
"blocked by a bot check", with no title, snapshot, reader view or summary.

The owner wants those pages anyway, and accepts the trade-off of fetching
them through a third-party service that loads pages in a real browser.

## Decision

Pages behind a bot check can be fetched through
[Firecrawl](https://firecrawl.dev), with the owner's own key ("bring your own
key"), the way enrichment uses the owner's own AI key:

- The key is stored encrypted like the AI key (AES-256-GCM under
  `KEY_ENCRYPTION_KEY`, bound to the user's id) and shown only by its last 4
  characters. It is saved only after Firecrawl accepts it on
  `GET /v2/team/credit-usage`, which costs no credits.
- The fetcher always tries the site directly first. Only when that fetch
  fails with a bot check, and the owner holds a verified key, is the same
  address sent to Firecrawl (`POST /v2/scrape` with `formats: ["rawHtml"]`
  and `proxy: "auto"`). No other page goes to Firecrawl.
- The HTML Firecrawl returns is stored exactly as a direct fetch's would be
  (snapshot, metadata, reader view, then enrichment). The link carries the
  note "fetched through Firecrawl", because its snapshot is Firecrawl's copy
  of the page, not the site's own answer to Alexandria.
- Firecrawl refusing the key (HTTP 401, 402 or 403) marks it `rejected` and
  pauses the fallback until a key is saved again. Firecrawl being unreachable,
  slow, rate limited or failing with 5xx leaves the link's first fetch to be
  retried on the usual schedule. Any other failure, such as the page itself
  answering an error, makes the link `unreachable` with Firecrawl's reason
  added to "blocked by a bot check".

## Consequences

- Without a key nothing changes: no address leaves Alexandria for a third
  party, and links behind a bot check stay `unreachable`.
- With a key, the addresses of such links, and only those, are sent to
  Firecrawl, and each one uses credits of the owner's Firecrawl plan
  (`proxy: "auto"` may use Firecrawl's more expensive stealth proxy).
- Fetching through Firecrawl gets past a check the site put up on purpose.
  Whether that is acceptable for a site is the owner's call. Alexandria
  makes it opt-in, per account, and visible on every link it applies to.
- Pages only members can read (for example Medium's member-only articles)
  are still fetched as an anonymous visitor sees them.
- Refresh goes through the same fallback, so a link that became
  `unreachable` before a key was saved can be fetched again from its card.
- The weekly liveness check does not use Firecrawl.

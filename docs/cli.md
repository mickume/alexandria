# Command line

Alexandria has no command-line interface of its own: it is used through its
website and its HTTP API (see [api.md](api.md)). The development commands are
the `make` targets listed in [AGENTS.md](../AGENTS.md); deploying and setting
a deployment's settings are covered in [configuration.md](configuration.md).
One maintenance script runs from a checkout against a deployed site.

## Rebuilding a library: `npm run rebuild`

`scripts/rebuild.ts` rebuilds everything Alexandria derives from the links of
one library: each page is fetched again (its snapshot, reader text and fetched
metadata), enriched again (summary, topic and tags) and indexed again (its
passages and their vectors for search by meaning). The links themselves are
kept as they are: their uses and points, pins, workspaces, notes, archive and
every field the owner edited by hand.

```sh
ALEXANDRIA_TOKEN=alx_… npm run rebuild -- --dry-run   # what it would do
ALEXANDRIA_TOKEN=alx_… npm run rebuild                # asks, then runs
```

It needs Node.js 22.18 or later (it runs the TypeScript file directly).

| Setting | Meaning |
|---|---|
| `ALEXANDRIA_TOKEN` | a personal access token of the library's owner (Settings on the site); required |
| `ALEXANDRIA_URL` | the site's origin; without it, `PUBLIC_ORIGIN` from the environment or `.env` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | for the step on the D1 database, as for `npm run deploy`; read from `.env` when the environment lacks them |

| Flag | Meaning |
|---|---|
| `--dry-run` | count the links and stop |
| `--yes` | do not ask before starting |
| `--per-minute N` | refreshes and re-enrichments a minute, 1 to 300 (default 20, the pace of background enrichment) |

The steps:

1. **Refresh** (`POST /api/v1/links/{id}/refresh`) every active, unreachable
   and archived link, at the chosen pace. A successful refresh replaces the
   snapshot and reader text and enriches the link again, and the new reader
   text makes the link stale for the index, so the Worker does the rest by
   itself; an archived link stays archived. Each refresh enriches at once,
   outside the background throttle, with the owner's AI key, so the pace is
   also the pace of calls to the AI provider. Expired links are not refreshed
   (a successful refresh would make them active again), nor pending ones
   (their first fetch is under way), nor those refreshed in the last 10
   minutes.
2. **Wait** until every refresh has a fetch event in the link's history (at
   most 20 minutes after the last one; a fetch that never reports counts as
   failed).
3. **Enrich again** (`POST /api/v1/links/{id}/enrich`), from the text already
   stored, the expired links and those whose refresh failed, except
   unreachable links and those with nothing to read.
4. **Mark for indexing** those same links, by moving their text version in D1
   (`wrangler d1 execute alexandria --remote`), so that the every-minute
   backfill embeds them again.

The script ends when everything is queued. Enrichment and indexing finish in
the background; the backfill indexes up to 60 of a user's links a minute.
The script's requests count towards the API's 600 a minute; it waits when
it reaches the limit.

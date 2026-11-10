# Configuration

The Worker reads its configuration from the variables and bindings in
`wrangler.jsonc`. Variables can be overridden per environment in
`wrangler.jsonc`, with `wrangler dev --var NAME:value`, or in a `.dev.vars` file
for local development.

## Variables

`wrangler.jsonc` holds the settings every deployment shares. The settings of
one deployment are not in it: set them all at once from a `.env` file with
`npm run configure` (see [Setting a deployment's settings](#setting-a-deployments-settings)),
one by one with `wrangler secret put <NAME>` (or as variables in the
dashboard; `keep_vars` keeps those across deploys), and in `.dev.vars` for
local development. Without `ALLOWED_EMAILS` and `GOOGLE_CLIENT_ID` (and the secrets below) nobody can sign in.

| Name               | Where                       | Meaning |
| ------------------ | --------------------------- | ------- |
| `ALLOWED_EMAILS`   | per deployment              | Comma-separated email addresses that may sign in. Compared case-insensitively; whitespace around each entry is ignored. Read on every request that needs it, so a change takes effect at once. Unset: nobody. |
| `GOOGLE_CLIENT_ID` | per deployment              | The OAuth 2.0 client id of the Google Cloud project. |
| `PUBLIC_ORIGIN`    | per deployment, optional    | The site's own origin, such as `https://alexandria.example.com`. Used for the OAuth redirect URI (`<origin>/auth/google/callback`), to check that changes made with the session cookie come from the site, for the export's content URLs and in the fetcher's User-Agent. Unset, the origin each request reached is used (such as the Worker's workers.dev address), and the User-Agent names no address. Set it when the site has more than one address, so that Google always gets the same callback. |
| `GOOGLE_AUTH_URL`  | `wrangler.jsonc`            | Google's authorization endpoint, `https://accounts.google.com/o/oauth2/v2/auth`. Changed only to run against a local fake provider in tests. |
| `GOOGLE_TOKEN_URL` | `wrangler.jsonc`            | Google's token endpoint, `https://oauth2.googleapis.com/token`. Changed only for tests, as above. |
| `ANTHROPIC_BASE_URL`, `OPENROUTER_BASE_URL` | `wrangler.jsonc` | The AI providers' API base URLs; changed only for tests. |
| `FIRECRAWL_API_URL` | `wrangler.jsonc` | Firecrawl's API base URL, `https://api.firecrawl.dev`, used for pages behind a bot check when the owner stored a Firecrawl key; changed only for tests. |
| `MEANING_FAKE_URL` | end-to-end tests only | When set, embeddings and the vector index are served by the fake at this URL (`e2e/fake-meaning.ts`) instead of the `AI` and `VECTORIZE` bindings. Never set in a deployment. |

## Secrets

| Name                   | Meaning                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_SECRET` | The OAuth 2.0 client secret of the Google Cloud project. Set with `wrangler secret put GOOGLE_CLIENT_SECRET`, or in `.dev.vars` locally. |
| `KEY_ENCRYPTION_KEY` | Any long random string. The owners' AI and Firecrawl keys are encrypted with AES-256-GCM under a key derived from it (its SHA-256), with each user's id bound as additional data. Changing it makes every stored key unreadable: owners then enter their keys again. |

## Bindings

| Binding  | Kind          | Meaning                                                                                                     |
| -------- | ------------- | ----------------------------------------------------------------------------------------------------------- |
| `DB`     | D1 database   | Every user's data. The schema is in `migrations/`; apply it with `wrangler d1 migrations apply alexandria`. |
| `ASSETS` | static assets | The website, built by `make build` into `dist/client/`.                                                     |
| `SNAPSHOTS` | R2 bucket | Snapshots and reader views, under `u/{user_id}/l/{link_id}/`. |
| `HOST_GATE` | Durable Object | One per host: spaces Alexandria's requests to a host a second apart. |
| `FETCH_QUEUE` | Queue `alexandria-fetch` | One message per link to fetch. |
| `ENRICH_QUEUE` | Queue `alexandria-enrich` | One message per link to enrich. |
| `LIVENESS_QUEUE` | Queue `alexandria-liveness` | One message per weekly liveness check. |
| `INDEX_QUEUE` | Queue `alexandria-index` | One message per link to index by meaning (batch size 10, 5 retries). |
| `AI` | Workers AI | Computes the embeddings of a link's passages and of a question, with `@cf/baai/bge-m3`. Paid by the deployment's account. `wrangler dev` reaches the real service for it (and so needs a Cloudflare login); `wrangler dev --local` does not, and the call then fails. |
| `VECTORIZE` | Vectorize index `alexandria-passages` | The embeddings of every user's passages, 1,024 dimensions, cosine, one namespace per user, with a metadata index on `kind`. `scripts/provision.sh` creates both. |
| `ACCOUNT_QUEUE` | Queue `alexandria-account` | One message per run of an account's deletion job; the job queues its next run until nothing of the account remains (batch size 1, 10 retries). |

## Cron Triggers

- `0 * * * *`: the hourly run that evaluates decay and enqueues the weekly
  liveness checks.
- `* * * * *`: the every-minute run that sends imported links waiting for
  their turn to the fetch worker, deletes the vectors of removed passages from
  the Vectorize index (at most 20 calls of 1,000 ids a run), and queues up to 60
  links per user that have no up-to-date passages (the backfill) on
  `alexandria-index`, the most recently used first and none twice within 10
  minutes. The three are independent: one failing does not stop the others.
- `*/5 * * * *`: the sweep that runs the deletion job of every account marked
  for deletion more than 5 minutes ago.

The `scheduled` handler tells them apart by `controller.cron`.

## Deploying

Two ways deploy the same Worker:

- **Workers Builds, or a plain `npx wrangler deploy`.** `wrangler.jsonc` has a
  custom build, `scripts/build.sh`: it builds the website into `dist/client`
  and, inside Workers Builds (`WORKERS_CI=1`), gets the account ready with
  `scripts/provision.sh`. Wrangler then bundles the Worker itself. The default
  Workers Builds settings (no build command, deploy command
  `npx wrangler deploy`, and `npx wrangler preview` for other branches) work
  as they are.
- **`npm run deploy`** (`scripts/deploy.sh`) from a checkout, with
  `CLOUDFLARE_API_TOKEN` set (and `CLOUDFLARE_ACCOUNT_ID` when the token cannot
  list its accounts): builds with Vite, runs `scripts/provision.sh`, and deploys
  the Worker bundle Vite built (`dist/alexandria/`).

`scripts/provision.sh` checks that the token can manage D1, Queues, R2 and
Vectorize (and names the permissions it lacks), creates the D1 database
`alexandria`, the five queues, the R2 bucket and the Vectorize index
`alexandria-passages` (1,024 dimensions, cosine) with its metadata index on
the string property `kind` when they do not exist, and
applies the D1 migrations, before the deploy. Every step is a no-op when there
is nothing to do. The token needs Account > Workers Scripts, D1, Queues, Workers
R2 Storage and Vectorize, each Edit. Workers AI is used through its binding
and is billed to the account; the script does not check it.

Set the per-deployment settings once (above), with the secrets, and add
`<the site's origin>/auth/google/callback` (for example
`https://alexandria.<subdomain>.workers.dev/auth/google/callback`) as an
authorised redirect URI of the Google OAuth client.

### Setting a deployment's settings

`npm run configure` (`scripts/configure.sh`) sets the per-deployment settings
from a `.env` file in the checkout, or from the file named after it
(`npm run configure -- prod.env`). Copy `.env.example` to `.env` (git ignores
`.env` and `.env.*`) and fill it in. The script stores each of
`ALLOWED_EMAILS`, `GOOGLE_CLIENT_ID`, `PUBLIC_ORIGIN`, `GOOGLE_CLIENT_SECRET`
and `KEY_ENCRYPTION_KEY` that the file holds as a secret of the Worker, in one
`wrangler secret bulk` call, so that every deploy keeps them; a setting the
file leaves out is left as it is. `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` may be in the file too: they are used to reach the
account when the environment does not set them, and are never uploaded.

The file is read as wrangler reads a `.env` file: one `NAME=value` a line,
blank lines and lines starting with `#` skipped, the quotes around a value
removed, and an unquoted value ending at its first `#` (so a value holding
`#` or spaces needs quotes). Any other name, an empty value or a line that is
not `NAME=value` stops the script before anything is sent, naming the line.
It prints the names it sets, never the values. When the Worker does not exist
yet, wrangler creates it as a draft to hold the secrets. The token needs
Account > Workers Scripts > Edit.

### Previews

Workers Builds builds every branch other than `main` with
`npx wrangler preview`, which runs only when `wrangler.jsonc` has a `previews`
block. A Preview gets only what that block lists: the public endpoints of
`vars`, and none of the production D1 database, R2 bucket, queues or Durable
Object, so that a branch never touches real data. A Preview therefore serves
the website, but signing in and the API do not work in it.

## Development environment

`make` keeps wrangler's logs in `.wrangler/logs` (`WRANGLER_LOG_PATH`) and turns
its telemetry off (`WRANGLER_SEND_METRICS=false`).

## End-to-end tests

`e2e/fake-google.ts` signs in `FAKE_GOOGLE_EMAIL` (default `owner@example.test`)
named `FAKE_GOOGLE_NAME` (default `Ada Owner`).

`e2e/fake-meaning.ts` stands in for Workers AI and Vectorize (the Worker is
given its address as `MEANING_FAKE_URL`), and `wrangler dev` runs with
`--local`, since an `ai` binding is otherwise always remote and would need a
Cloudflare login. `npx vite dev` and `wrangler dev` without `--local` reach the
real services through the `AI` and `VECTORIZE` bindings.

## Per-user settings

Each user sets on the settings page (or with `PUT /api/v1/settings/decay`)
how fast their unused links decay: `start_points` (default 60), the points a
link starts from, plus one per use, and `remove_days` (default 180), the days
from a link's expiry to its removal, each a whole number from 7 to 3650; and
`use_boost` (default 50), a whole number from 10 to 100, the percent of the
time a link has decayed that its first use on a UTC day wins back (at 100, a
use gives back every lost point). They are stored on the user, not in the
deployment's configuration. A change of `start_points` or `remove_days`
applies to every link of the user at once; a change of `use_boost` applies to
the uses recorded after it.

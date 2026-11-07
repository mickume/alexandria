# Configuration

The Worker reads its configuration from the variables and bindings in
`wrangler.jsonc`. Variables can be overridden per environment in
`wrangler.jsonc`, with `wrangler dev --var NAME:value`, or in a `.dev.vars` file
for local development.

## Variables

| Name               | Default                                        | Meaning                                                                                                                                                                                        |
| ------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ALLOWED_EMAILS`   | empty (nobody)                                 | Comma-separated email addresses that may sign in. Compared case-insensitively; whitespace around each entry is ignored. Read on every request that needs it, so a change takes effect at once. |
| `GOOGLE_CLIENT_ID` | empty                                          | The OAuth 2.0 client id of the Google Cloud project.                                                                                                                                           |
| `GOOGLE_AUTH_URL`  | `https://accounts.google.com/o/oauth2/v2/auth` | Google's authorization endpoint. Changed only to run against a local fake provider in tests.                                                                                                   |
| `GOOGLE_TOKEN_URL` | `https://oauth2.googleapis.com/token`          | Google's token endpoint. Changed only for tests, as above.                                                                                                                                     |
| `PUBLIC_ORIGIN`    | `http://localhost:8787`                        | The site's own origin, such as `https://alexandria.example.com`. Used for the OAuth redirect URI.                                                                                              |

## Secrets

| Name                   | Meaning                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_SECRET` | The OAuth 2.0 client secret of the Google Cloud project. Set with `wrangler secret put GOOGLE_CLIENT_SECRET`, or in `.dev.vars` locally. |
| `KEY_ENCRYPTION_KEY` | Any long random string. The owners' AI keys are encrypted with AES-256-GCM under a key derived from it (its SHA-256), with each user's id bound as additional data. Changing it makes every stored AI key unreadable: owners then enter their keys again. |

## Bindings

| Binding  | Kind          | Meaning                                                                                                     |
| -------- | ------------- | ----------------------------------------------------------------------------------------------------------- |
| `DB`     | D1 database   | Every user's data. The schema is in `migrations/`; apply it with `wrangler d1 migrations apply alexandria`. |
| `ASSETS` | static assets | The website, built by `make build` into `dist/client/`.                                                     |

## Development environment

`make` keeps wrangler's logs in `.wrangler/logs` (`WRANGLER_LOG_PATH`) and turns
its telemetry off (`WRANGLER_SEND_METRICS=false`).

## End-to-end tests

`e2e/fake-google.ts` signs in `FAKE_GOOGLE_EMAIL` (default `owner@example.test`)
named `FAKE_GOOGLE_NAME` (default `Ada Owner`).

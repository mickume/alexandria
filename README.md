# alexandria

My personal library: a private library of web links for one person at a time.
Paste links, keep them in a stream ordered by use, and reach everything through
a token-authenticated HTTP API.

It runs as one Cloudflare Worker (Hono) with a D1 database and a React website
built with Vite.

## Quick start

Requirements: Node.js 22 or later, npm, and `make`.

```sh
npm install
make test        # unit and integration tests
make build       # the website and the Worker bundle, in dist/
npx vite dev     # a local development server
```

For local sign-in, create `.dev.vars` with `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` and `ALLOWED_EMAILS` (see
[docs/configuration.md](docs/configuration.md)), and apply the migrations with
`npx wrangler d1 migrations apply alexandria --local`.

## Documentation

- [docs/api.md](docs/api.md): the HTTP API
- [docs/configuration.md](docs/configuration.md): variables, secrets and bindings
- [docs/architecture.md](docs/architecture.md): how it is put together
- [docs/cli.md](docs/cli.md): there is no CLI
- [docs/adr/](docs/adr/): architecture decisions
- [docs/generated/](docs/generated/): the generated module reference (`make doc`)

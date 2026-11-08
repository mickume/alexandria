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
`GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS`, `PUBLIC_ORIGIN` and
`KEY_ENCRYPTION_KEY` (see [docs/configuration.md](docs/configuration.md)), and
apply the migrations with `npx wrangler d1 migrations apply alexandria --local`.

To deploy to Cloudflare, run `npm run deploy` with `CLOUDFLARE_API_TOKEN`
set; see [Deploying](docs/configuration.md#deploying).

## Search

The search box is in the header of every page. It searches as you type (200
ms after the last keystroke) over each link's title, summary, tags, topic,
host, address, page text and note, every word matching as the start of a
word, and lists the matching workspaces above the links. On the Archive page
it searches the archive.

Filters narrow a search, and can be combined with words or each other:

| Filter | Keeps |
|---|---|
| `tag:cloudflare` | links with that tag |
| `topic:"web development"` | links with that topic (quote a name with spaces) |
| `host:example.com` | links on that host or its subdomains |
| `in:"Reading list"` | links in that workspace |
| `is:pinned`, `is:dead` | pinned links; links whose page is gone |
| `state:archived`, `state:any`, `state:dormant`, … | archived links only; every state; one state |

Archived links are left out unless a `state:` filter asks for them. The Topics
and Tags pages list every topic and tag with its number of links; each opens
its search, and each can be renamed or merged into another.

Two keys, and no others: `/` (outside a text field) puts the cursor in the
search box, and `Escape` in the box clears it and goes back to the page the
search started from.

## Import

The **Import** button at the end of the header's tabs opens the import page.
Drop a plain-text file with one URL per line on it, or pick one (at most 5,000
URLs and 2 MB), and choose a workspace to add the links to, or name a new one.
Blank lines and lines starting with `#` are skipped, and
anything after the first space on a line is ignored. New URLs join the stream
in file order, the first line highest; URLs already in the library are
reported as duplicates and left as they are, and malformed lines are listed
with their line numbers. The links are then fetched and enriched in the
background, 20 a minute, and the report can be downloaded. With a workspace,
every link of the file joins it in file order (links already in it keep their
place). Scripts can do the same with `POST /api/v1/imports` (see
[docs/api.md](docs/api.md)).

## Documentation

- [docs/api.md](docs/api.md): the HTTP API
- [docs/configuration.md](docs/configuration.md): variables, secrets and bindings
- [docs/architecture.md](docs/architecture.md): how it is put together
- [docs/cli.md](docs/cli.md): there is no CLI
- [docs/adr/](docs/adr/): architecture decisions
- [docs/generated/](docs/generated/): the generated module reference (`make doc`)

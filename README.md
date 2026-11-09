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
set (its permissions, Vectorize among them, are listed under
[Deploying](docs/configuration.md#deploying)).

## Search

The search box is in the header of every page. It searches as you type (200
ms after the last keystroke) over each link's title, summary, tags, topic,
host, address, page text and note, every word matching as the start of a
word, and lists the matching workspaces above the links. On the Archive page
it searches the archive.

Press **Enter** to search the same query by meaning as well: it also finds
links that share no word with it, such as a page saved as "Durable Objects
alarms" for "scheduling work in the background on Cloudflare". The address
becomes `/search?q=…&mode=hybrid`, so a reload or a shared address repeats the
search by meaning; typing again goes back to searching as you type.

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
and Tags pages list every topic and tag with its number of links, in
alphabetical order; each opens its search, and each can be renamed or merged
into another, chosen from a list in the same order.

Two keys, and no others: `/` (outside a text field) puts the cursor in the
search box, and `Escape` in the box clears it and goes back to the page the
search started from.

## Import

The **Import** button at the end of the header's tabs opens the import page.
Drop a text or Markdown file (`.txt`, `.md`) on it, or pick one (at most 5,000
URLs and 2 MB), and choose a workspace to add the links to, or name a new one.
Every line that holds an `http://` or `https://` address is imported (its
first address, Markdown link syntax and trailing punctuation removed); all
other lines, and lines starting with `#`, are ignored. New URLs join the stream
in file order, the first line highest; URLs already in the library are
reported as duplicates and left as they are, and addresses that cannot be
imported (such as `http://localhost/x`) are listed with their line numbers. The links are then fetched and enriched in the
background, 20 a minute, and the report can be downloaded. With a workspace,
every link of the file joins it in file order (links already in it keep their
place). Scripts can do the same with `POST /api/v1/imports` (see
[docs/api.md](docs/api.md)).

## Agents (MCP)

Alexandria serves a Model Context Protocol server at `/mcp`, so that an AI
agent can search the library, read what it holds and file new links as you.
Create a personal access token under **Settings**, then add the server to
your client, for example Claude Code:

```sh
claude mcp add --transport http alexandria https://<your-site>/mcp \
  --header "Authorization: Bearer alx_…"
```

[docs/mcp.md](docs/mcp.md) covers the other clients (Claude Desktop, Cursor,
VS Code, Codex), checking the connection, the tools, and an example prompt
that tells an agent what Alexandria is and how to use it.

## Documentation

- [docs/api.md](docs/api.md): the HTTP API
- [docs/mcp.md](docs/mcp.md): connecting an AI agent through the MCP server
- [docs/configuration.md](docs/configuration.md): variables, secrets and bindings
- [docs/architecture.md](docs/architecture.md): how it is put together
- [docs/cli.md](docs/cli.md): there is no CLI
- [docs/adr/](docs/adr/): architecture decisions
- [docs/generated/](docs/generated/): the generated module reference (`make doc`)

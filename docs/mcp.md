# Using Alexandria from an agent (MCP)

Alexandria serves a [Model Context Protocol](https://modelcontextprotocol.io)
server at `/mcp`, so an AI agent (Claude Code, Claude Desktop, Cursor, VS Code,
Codex, …) can search your library, read what you kept and file new links as
you. This page explains how to connect an agent and how to tell it what
Alexandria is. The exact protocol behaviour, every tool's shapes and errors,
is in [api.md](api.md#mcp-server).

## What you need

1. **The server's address**: your site's origin followed by `/mcp`, such as
   `https://alexandria.example.com/mcp` (or the Worker's `workers.dev`
   address). In the examples below, replace `https://alexandria.example.com`
   with yours.
2. **A personal access token.** Sign in, open **Settings → Personal access
   tokens**, give the token a name (for example the agent's: "Claude Code")
   and choose **Create token**. The secret, which starts with `alx_`, is shown
   once: copy it now. Alexandria keeps only its hash, so a lost secret cannot
   be shown again; create another and revoke the old one.

Use one token per agent or machine, so that you can revoke one without
breaking the others; Settings shows when each token was last used. A token
has the same rights as you have on the website (except deleting the account),
so keep it out of repositories and shared files: prefer the environment
variables or secret prompts the clients below offer.

## The transport

The server speaks the **Streamable HTTP** transport and needs nothing else:

- **Address:** `POST https://alexandria.example.com/mcp`
- **Authentication:** the header `Authorization: Bearer alx_…`. Only a token
  works; the website's session cookie does not. There is no OAuth sign-in.
- **Stateless:** every request is answered on its own, as JSON, with no
  session id and no server-to-client stream (`GET` and `DELETE` answer `405`).
  Clients that support Streamable HTTP handle this without configuration.

## Connecting a client

### Claude Code

```sh
claude mcp add --transport http --scope user alexandria \
  https://alexandria.example.com/mcp \
  --header "Authorization: Bearer alx_…"
```

`--scope user` makes the server available in every project; leave it out to
add it to the current project only. Check it with `claude mcp list`, or with
`/mcp` inside a session.

### Claude Desktop

Claude Desktop's custom connectors sign in with OAuth, which Alexandria does
not offer, so connect it through the
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge (it needs
Node.js). Open **Settings → Developer → Edit Config** and add to
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "alexandria": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://alexandria.example.com/mcp",
        "--header",
        "Authorization:${ALEXANDRIA_AUTH}"
      ],
      "env": {
        "ALEXANDRIA_AUTH": "Bearer alx_…"
      }
    }
  }
}
```

Restart Claude Desktop afterwards. The header is passed through an
environment variable because some platforms split arguments that contain
spaces. The same bridge works for any client that can only start local
(stdio) servers.

### Cursor

Add the server to `~/.cursor/mcp.json` (every project) or `.cursor/mcp.json`
(one project):

```json
{
  "mcpServers": {
    "alexandria": {
      "url": "https://alexandria.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${env:ALEXANDRIA_TOKEN}"
      }
    }
  }
}
```

and set `ALEXANDRIA_TOKEN` to the secret in the environment Cursor starts
from.

### VS Code (GitHub Copilot agent mode)

Add `.vscode/mcp.json` to a workspace (or run **MCP: Open User
Configuration** for every workspace). VS Code asks for the token the first
time and stores it securely:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "alexandria-token",
      "description": "Alexandria personal access token",
      "password": true
    }
  ],
  "servers": {
    "alexandria": {
      "type": "http",
      "url": "https://alexandria.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${input:alexandria-token}"
      }
    }
  }
}
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.alexandria]
url = "https://alexandria.example.com/mcp"
bearer_token_env_var = "ALEXANDRIA_TOKEN"
```

and set `ALEXANDRIA_TOKEN` to the secret before starting Codex.

### Other clients

Any client that supports remote servers over Streamable HTTP with a custom
header works: give it the address and the `Authorization: Bearer alx_…`
header. A client that only runs local servers can use `mcp-remote`, as for
Claude Desktop.

## Checking the connection

Without any client, `curl` shows whether the address and the token work. This
asks for the list of tools:

```sh
curl -sS https://alexandria.example.com/mcp \
  -H "Authorization: Bearer $ALEXANDRIA_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}'
```

A working setup answers JSON whose `result.tools` names the ten tools below.
Settings then shows the token as just used.

| Answer | Meaning |
|---|---|
| `401 {"error": "unauthorized"}` | The token is missing, mistyped or revoked, or the header is not `Authorization: Bearer <secret>` |
| `405` | The request was a `GET` or `DELETE`: the client expects a stateful server or an SSE stream. Use a client that supports Streamable HTTP, or `mcp-remote` |
| `406` | The `Accept` header lacks `application/json` and `text/event-stream` (a hand-made request; clients send it) |
| `429 {"error": "rate_limited"}` | More than 600 requests in the clock minute, counted together with the API; wait the `Retry-After` seconds |

## The tools

| Tool | What an agent uses it for |
|---|---|
| `search_links` | Find links by meaning as well as by words, with the search box's filters: `tag:`, `topic:`, `host:`, `in:` (a workspace), `is:pinned`, `is:dead`, `state:`. Each result says how it matched (`match`: `keyword`, `meaning` or `both`) |
| `search_passages` | Answer a question from the library: the passages of your links that best match it by meaning, each with its link's id, title and URL. Takes the same filters |
| `list_recent` | The links you used most recently: the top of the stream, pinned links first |
| `get_link` | A link's metadata: addresses, title, summary, tags, topic, state and dates |
| `get_link_content` | The stored text of a page or PDF (`format: "text"`), or the page's snapshot HTML (`format: "html"`) |
| `add_link` | Keep a new link, optionally with tags and into a workspace; a link already in the library only moves to the top |
| `list_workspaces` | Your workspaces, with their descriptions and link counts |
| `add_to_workspace` | File a link at the bottom of a workspace (named by its id or its name) |
| `pin_link` | Pin a link at the top of the stream |
| `archive_link` | Archive a link: it leaves the stream for the Archive page |

Two behaviours are worth knowing when you direct an agent:

- **Reading content counts as using the link.** `get_link_content` records a
  use, as opening the reader view does, which moves the link to the top of
  the stream and resets its decay. `search_links`, `search_passages`,
  `list_recent` and `get_link` record nothing. Ask the agent to read a link's content only when
  it needs more than the summary.
- **Adding is safe to repeat.** `add_link` with an address already in the
  library stores nothing new: it moves that link to the top (and applies the
  tags and workspace you gave). New links are fetched, summarised, tagged and
  given a topic in the background, so a link just added has no summary yet.

- **`search_passages` finds by meaning, not by words.** A question such as
  "how do I schedule background work on Cloudflare?" finds the passages of
  links about Durable Object alarms even though they share no word with it.
  Each item is a piece of one link's text of at most 1,500 characters, with
  the link's `link_id`, `title` and `url` and a `score`; at most three items
  come from one link, and a question that nothing in the library answers
  returns no items. A link is found once it has been indexed, which takes
  about a minute after it is saved or changed and a few hours for a large
  library that existed before the index. If the index is unavailable the tool
  answers `search_unavailable`: try again later, or fall back on
  `search_links`.

Tools never create workspaces or delete links; a workspace that does not
exist is refused, and deleting stays on the website.

## Telling an agent about Alexandria

On connecting, the server tells the agent in a sentence what Alexandria is and
to search before adding. For an agent that uses the library regularly, give it
more context in its standing instructions: `CLAUDE.md` or `AGENTS.md` for
coding agents, a project's instructions in Claude Desktop, or the system
prompt of your own agent. Adapt this example:

```markdown
## Alexandria, my link library

Alexandria is my private library of web links, available to you through the
`alexandria` MCP server. It holds articles, documentation, tools and papers I
chose to keep, each with a short summary, tags and a topic written when it was
added, and the page's text as it was then. Treat it as my curated memory of
the web: when I ask about something I may have read or saved before, look
there first, before searching the web.

How to use it:

- **Finding things.** Use `search_links` with a few keywords or a description
  of what you are looking for; it matches by meaning as well as by words. Narrow with
  filters when they help: `tag:rust`, `topic:"web development"`,
  `host:github.com`, `in:"Reading list"` (a workspace), `is:pinned`. Archived
  links are left out unless you add `state:archived` or `state:any`.
  `list_recent` shows what I have been using lately. Answer with each link's
  title and URL, and say when nothing in the library matches.
- **Asking.** For a question the library may answer ("what did I save about
  X?", "how did that article say to do Y?"), use `search_passages` with the
  question in plain words, and answer from the passages it returns, naming
  each source by its title and URL. Say so when no passage answers the
  question.
- **Reading.** Search results and `get_link` carry the summary, which is
  usually enough. Call `get_link_content` with `format: "text"` only when you
  need the page itself (to quote it or answer a detailed question): it counts
  as me using the link and moves it to the top of my stream. Prefer the stored
  text to fetching the live page, which may have changed or gone.
- **Saving.** When I ask you to save, keep or bookmark a link, or when we find
  a source clearly worth keeping during a task, search first, then use
  `add_link`. Add tags only if I asked for them or they are obvious: short,
  lower-case, hyphenated (`machine-learning`). Alexandria tags and summarises
  links itself. To file a link into a workspace, use the workspace's name as
  `list_workspaces` shows it; never assume one exists.
- **Changing things.** Do not pin or archive links unless I ask you to.

Never add links I did not ask for in bulk, and never put the content of
private or internal pages into the library.
```

Trim it to what the agent needs: an agent that should only look things up can
be told to use only `search_links`, `search_passages`, `get_link` and `get_link_content`, and
most clients let you turn off the other tools.

## Revoking access

To cut an agent off, revoke its token in **Settings → Personal access
tokens**. From its next request on, the server answers `401`.

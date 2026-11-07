---
spec_id: "08"
spec_name: "mcp_server"
title: "Let agents use the library through an MCP server"
status: "active"
created_at: "2026-11-07T14:23:36Z"
intent_hash: "0a47128b5f124d00301366f529cac0709f2c628503af6d3a0ec97e59e6a72ac5"
schema_version: 3
source: "docs/prd/01-build-the-alexandria-link-library.md"
---

# Let agents use the library through an MCP server

## Intent

Alexandria's library must be as reachable by an agent as by its owner. This package exposes the library's core capabilities — adding, searching, reading, organising, pinning and archiving links — to agents through a Model Context Protocol server over Streamable HTTP, authenticated with the same personal access tokens as the HTTP API, bound to the token's user alone, and answering with the same shapes, errors, limits and use recording as the API, so that an agent working with the library leaves it exactly as the owner would.

## Goals

- An agent with a personal access token calls `search_links("cloudflare queues")` through the MCP server, gets the matching links, calls `get_link_content` on one and receives the reader-view text; the link's last used is updated.
- The core capabilities are available through the MCP server — `add_link`, `search_links`, `get_link`, `get_link_content`, `list_workspaces`, `add_to_workspace`, `pin_link`, `archive_link`, `list_recent` — with the same per-user isolation as the API.
- Each tool returns the same shapes and the same errors as the API, errors as structured tool errors rather than exceptions, and counts a use where the API would.
- No MCP call can read or change another user's links.

## Non-goals

- Every other capability of the website (tokens, settings, topics and tags pages, rename and merge, notes, delete, refresh, import, export, account deletion) stays on the HTTP API only; the MCP server exposes the core capabilities listed above.
- OAuth for MCP clients, or any credential other than a personal access token.
- MCP resources, prompts, sampling and server-initiated notifications; the server exposes tools only.
- Long-lived MCP sessions and server-to-client streams (see Design Decisions).
- The capabilities themselves: accounts, tokens and the stream (package 01), fetch, snapshot and reader view (02), enrichment, tags and topics (03), workspaces (04), archive (05), search (06). This package only exposes them.
- Sharing, collaboration or any cross-user feature.

## Background

After packages 01 to 06 the library has: Google sign-in, personal access tokens that authenticate `/api/v1/` requests through the authentication middleware in `src/worker/auth/middleware.ts`, the per-user rate limit of 600 requests per minute (`src/worker/api/ratelimit.ts`), the error envelope (`src/worker/api/errors.ts`), URL normalisation and the add-or-boost link store (`src/worker/links/normalize.ts`, `src/worker/links/store.ts`), `recordUse` (`src/worker/links/use.ts`), pinning, the stream (`GET /api/v1/links`), fetch, snapshot and reader view with the reader and snapshot endpoints recording a use (package 02), manual tag edits through `PATCH /api/v1/links/{id}` (03), workspaces and their membership (04), manual archive (05) and keyword search with prefix filters (`GET /api/v1/search`, 06). There is no MCP endpoint: `/mcp` answers nothing. Every component this package names under `src/worker/mcp/` is new.

Constraints the owner has set:

- Constraint: TypeScript throughout; the MCP server runs in the same Cloudflare Worker as the API.
- Constraint: external libraries only from very well-maintained projects; the MCP server uses the official `@modelcontextprotocol/sdk`.
- Constraint: strict per-user separation of data and processing.

## Requirements

### MCP server

- An MCP server over the Streamable HTTP transport, authenticated with the same personal access tokens, exposes to agents: `add_link(url, tags?, workspace?)`, `search_links(query, limit?)`, `get_link(id)` (metadata and summary), `get_link_content(id, format: "text" | "html")` (reader-view text or snapshot), `list_workspaces()`, `add_to_workspace(link_id, workspace)`, `pin_link(link_id)`, `archive_link(link_id)`, and `list_recent(limit?)`. Each tool returns the same shapes and the same errors (as structured tool errors, not exceptions) as the API, and each counts a use where the API would.
- Every MCP action is bound to the token's user; there is no tool that can address another user's data. An invalid token fails the connection with 401.
- The server's instructions text tells an agent what the library is and that `search_links` should be tried before `add_link` to avoid duplicates (the server de-duplicates anyway).
- MCP requests count towards the user's API rate limit of 600 requests per minute.
- End-to-end flow the system must support unbroken: an agent with a personal access token calls `search_links("cloudflare queues")` through the MCP server, gets two links, calls `get_link_content` on one and receives the reader-view text; the link's last used is updated.

## Design Decisions

1. **The server is stateless.** `/mcp` accepts `POST` only, with a new `McpServer` and a `WebStandardStreamableHTTPServerTransport` (no session id generator, JSON responses enabled) built per request and bound to the token's user; `GET` and `DELETE` answer 405. Decided in this run: a Worker keeps no state between requests, and the nine tools need no server-to-client stream.
2. **Only a bearer token authenticates `/mcp`.** A session cookie is not accepted there. A missing, unknown or revoked token answers HTTP 401 `{ "error": "unauthorized" }` with `WWW-Authenticate: Bearer` before any MCP message is read. Decided in this run: agents are not browsers, and refusing the cookie removes cross-site use of the endpoint.
3. **Tool results carry the API's JSON.** A successful tool returns the API response body as `structuredContent` and the same JSON as one text content item; a failed one returns `isError: true` with the API's error envelope (`error`, `message`, and `field` where the API gives one) as `structuredContent` and as text. Arguments that fail the tool's input schema answer the same way with `error: "invalid_arguments"`. Decided in this run, so that one parser serves both the API and MCP.
4. **`add_link` tags are a manual edit.** Tags given to `add_link` are applied as `PATCH /api/v1/links/{id}` with `tags` would apply them (package 03), so later enrichment keeps them. A duplicate URL is boosted exactly as `POST /api/v1/links` boosts it, and given tags and workspace are applied to the existing link. Decided in this run: the source PRD says only that the tools match the API.
5. **A workspace argument is an id or an exact name.** `add_link` and `add_to_workspace` take a workspace id or its name compared case-insensitively; a value that names no workspace of the user is the tool error `not_found`, no workspace is created and `add_link` stores nothing. Decided in this run: agents know names, and creating workspaces stays a deliberate owner action.
6. **`list_recent` is the stream.** It returns the first page of `GET /api/v1/links` (pinned first, then by last used), default 20, 1 to 100. `search_links` defaults to 10 results, 1 to 100, and takes the search box's query syntax, prefix filters included. Decided in this run: the source PRD gives no defaults.
7. **`get_link` counts no use; `get_link_content` counts one**, as reading the reader view or the snapshot through the API does. `format: "text"` returns the reader-view text (a PDF's extracted text); `format: "html"` returns the stored snapshot HTML, and for a PDF link is the tool error `not_html` ("this link is a PDF; use format text"); a link with no snapshot is the tool error `no_content`. Decided in this run: an agent cannot use PDF bytes as text.
8. **Package 03 is a dependency** because `add_link`'s tags use its manual tag edit. Decided in this run.
9. **Every tool is performed by the API's own routes.** A tool dispatches the equivalent request (or requests) to the `/api/v1/` routes inside the Worker with the agent's token, so its shapes, errors, limits and use recording are the API's by construction; a `/mcp` request counts once against the rate limit however many operations its tool performs. Decided in this run: two implementations of one contract drift apart.
10. **`add_link` checks its arguments before it stores anything.** The workspace is resolved and every tag, trimmed and lower-cased, must be a single word or a hyphenated phrase (the source PRD's tag form) before the link is added, so that a refused call leaves no partial link. Decided in this run.
11. **An unexpected failure is a tool error**, `internal_error` with the message "something went wrong, try again" and no internal detail, so that an agent is never handed a stack trace or a broken connection. Decided in this run.

## Dependencies

- 01 `accounts_links_and_stream`: personal access tokens, the authentication middleware, the rate limit, the error envelope, normalisation, add-or-boost, `recordUse`, pinning and the stream.
- 02 `fetch_and_snapshot`: the reader view and snapshot that `get_link_content` returns, and the use those reads record.
- 03 `ai_enrichment`: the manual tag edit `add_link` applies, and the summary, tags and topic `get_link` returns.
- 04 `workspaces_and_notes`: the workspaces `list_workspaces`, `add_to_workspace` and `add_link` use.
- 05 `decay_and_liveness`: the manual archive `archive_link` performs.
- 06 `search_and_browse`: the search `search_links` runs.

## Verified External API

Read from the published package on 2026-11-07:

- `@modelcontextprotocol/sdk` 1.32.2: `new McpServer(serverInfo: Implementation, options?: McpServerOptions)` with `options.instructions?: string`, from `@modelcontextprotocol/sdk/server/mcp.js`; `registerTool(name: string, config: { title?, description?, inputSchema?, outputSchema?, annotations?, _meta? }, cb: ToolCallback): RegisteredTool`; `new WebStandardStreamableHTTPServerTransport(options?: WebStandardStreamableHTTPServerTransportOptions)` with `sessionIdGenerator?: () => string` and `enableJsonResponse?: boolean`, and `handleRequest(req: Request, options?: HandleRequestOptions): Promise<Response>`, from `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js`; tool results carry `structuredContent` and `isError`. For the end-to-end test: `new Client(clientInfo: Implementation, options?: ClientOptions)`, `connect(transport: Transport, options?): Promise<void>` and `callTool(params, resultSchema?, options?)` from `@modelcontextprotocol/sdk/client/index.js`; `new StreamableHTTPClientTransport(url: URL, opts?: { requestInit?: RequestInit, ... })` from `@modelcontextprotocol/sdk/client/streamableHttp.js`.
- `zod` 4.6.7: the tools' input schemas.

## Glossary

- **MCP**: the Model Context Protocol, by which an agent discovers and calls a server's tools.
- **agent**: an MCP client acting with the owner's personal access token.
- **tool error**: a tool result with `isError: true` carrying the API's error envelope, as opposed to a protocol error.
- **use**: an open, read or snapshot view of a link, recorded with a timestamp.
- **personal access token**: a user-created secret that authenticates API and MCP requests as that user.
- **reader view**: the cleaned, content-only text extracted from the snapshot.
- **snapshot**: the raw HTML (or the whole PDF) stored at fetch time.

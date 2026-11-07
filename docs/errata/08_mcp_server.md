# Erratum 08: MCP server

Where the implementation of spec `08_mcp_server` differs from what the spec
says, and why.

1. **`tools/call` is handled by the server's own handler.** The tools are
   registered with `McpServer.registerTool` (so `tools/list` shows their
   descriptions and input schemas), and the `tools/call` handler is then set
   on `McpServer.server`. `McpServer`'s own handler turns an input-schema
   failure into a text-only error without the field; this one answers
   `{error: 'invalid_arguments', field, message}` and `internal_error` as tool
   errors, as DD3 and DD11 ask.
2. **Internal API requests carry their user on the Request object.** A tool
   sends its requests to the API sub-application with `Request` objects the
   Worker creates and records in `internalRequests` (a `WeakMap` in
   `auth/middleware.ts`) with the agent's user. `requireAuth` takes the user
   from there instead of re-reading the token, and `rateLimit` does not count
   them. No client can produce such a Request.
3. **`add_link` answers the link as it stands after its tags and workspace,
   without the whole note** (`GET /api/v1/links/{id}` without `note`), so its
   shape stays the stream link of `POST /api/v1/links`. It also refuses more
   than 20 tags up front, the limit `PATCH /api/v1/links/{id}` applies, so
   that no partial link is left.
4. **`get_link_content` reads the link first** (`GET /api/v1/links/{id}`, no
   use) to answer `not_html` for a PDF and `no_content` for a link without a
   snapshot before any use is recorded. The reader text of an HTML link whose
   reader view came out empty is returned as `''`, with the use the reader
   endpoint records.
5. **A workspace that names nothing is `not_found` with a message** ("no
   workspace of yours has this id or name"); a `not_found` the API itself
   answers (an unknown link) carries no message, as the API's has none.
6. **An unknown tool name is a tool error** `{error: 'not_found', message:
   'no such tool'}`, not a protocol error.
7. **In the equivalence table, `list_recent`'s refusal and the wrapped shapes
   are compared on what they carry:** `list_recent` checks its `limit` before
   the API would, answering `invalid_arguments` where the API answers
   `invalid_limit`; `get_link_content` and `list_workspaces` wrap the API's
   body (`{id, format, content}`, `{items}`) and are compared on its content.
8. **`list_recent` and the tools' input schemas came with the endpoint (task
   1)**, so their task-3 and task-4 argument tests could not fail first; task
   6's tables passed on their first run with no tool needing a fix.
9. **The end-to-end test unpins the link it pinned,** since the end-to-end
   specs share one library and later specs read the top of the stream.

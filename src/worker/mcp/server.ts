/**
 * The MCP server at /mcp: stateless, over Streamable HTTP, answering JSON.
 * Each request builds its own server bound to the token's user.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Hono, type Context } from 'hono';
import { internalRequests, requireToken } from '../auth/middleware';
import { rateLimit } from '../api/ratelimit';
import type { AppEnv } from '../env';
import { TOOLS, type ApiAnswer, type Outcome, type ToolContext } from './tools';

/** What the server tells an agent about itself. */
export const INSTRUCTIONS =
  "Alexandria is the owner's private library of web links. Use it to find links the owner kept " +
  'and to file new ones. Try search_links before add_link, to avoid adding a link the library ' +
  'already has (the server de-duplicates anyway: adding a URL already in the library only ' +
  'boosts it). To answer a question from the library, use search_passages: it ' +
  "returns the passages of the owner's links that best match the question by meaning, each with " +
  "its link's id, title and URL. Use get_link_content to read a whole link.";

const INTERNAL_ORIGIN = 'https://alexandria.internal';

/** Sends requests to the API sub-application as the request's user, without counting them. */
function apiCaller(api: Hono<AppEnv>, c: Context<AppEnv>): ToolContext {
  return {
    async call(method, path, body) {
      const request = new Request(`${INTERNAL_ORIGIN}${path}`, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      internalRequests.set(request, c.get('user'));
      const response = await api.fetch(request, c.env, c.executionCtx);
      const text = await response.text();
      const contentType = response.headers.get('Content-Type') ?? '';
      const json: unknown =
        contentType.includes('application/json') && text ? JSON.parse(text) : null;
      return { status: response.status, json, text, contentType } satisfies ApiAnswer;
    },
  };
}

/** A tool's outcome as an MCP result: the JSON as structured content and as one text item. */
function toResult(outcome: Outcome): CallToolResult {
  const text = JSON.stringify(outcome.body);
  return {
    content: [{ type: 'text', text }],
    structuredContent: outcome.body,
    ...(outcome.ok ? {} : { isError: true }),
  };
}

const INTERNAL_ERROR: Outcome = {
  ok: false,
  body: { error: 'internal_error', message: 'something went wrong, try again' },
};

/**
 * The MCP server for one request: the tools registered with their
 * descriptions and input schemas, and a tools/call handler that checks the
 * arguments itself, so that every refusal is a tool error in the API's
 * envelope (invalid_arguments naming the field, or internal_error) and
 * never a protocol error.
 */
function buildServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: 'alexandria', version: '1.0.0' },
    { instructions: INSTRUCTIONS },
  );
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input.shape },
      () => ({ content: [] }),
    );
  }
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS.find((t) => t.name === request.params.name);
    if (!tool) {
      return toResult({ ok: false, body: { error: 'not_found', message: 'no such tool' } });
    }
    const parsed = tool.input.safeParse(request.params.arguments ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = String(issue?.path[0] ?? 'arguments');
      return toResult({
        ok: false,
        body: {
          error: 'invalid_arguments',
          field,
          message: `${field}: ${issue?.message ?? 'invalid'}`,
        },
      });
    }
    try {
      return toResult(await tool.run(ctx, parsed.data));
    } catch (err) {
      console.error('an MCP tool failed', err);
      return toResult(INTERNAL_ERROR);
    }
  });
  return server;
}

/**
 * The /mcp routes: POST answers MCP messages, as the bearer token's user and
 * counted once against the rate limit; GET and DELETE answer 405, since no
 * session or server-to-client stream exists.
 */
export function mcpRoutes(api: Hono<AppEnv>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireToken, rateLimit);
  routes.post('/', async (c) => {
    // One message a request, so that the rate limit counts every tool call.
    const body: unknown = await c.req.raw
      .clone()
      .json()
      .catch(() => null);
    if (Array.isArray(body)) {
      return c.json(
        {
          jsonrpc: '2.0',
          error: { code: -32600, message: 'batches are not accepted: send one message a request' },
          id: null,
        },
        400,
      );
    }
    const server = buildServer(apiCaller(api, c));
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
  routes.on(['GET', 'DELETE'], '/', (c) => c.body(null, 405, { Allow: 'POST' }));
  return routes;
}

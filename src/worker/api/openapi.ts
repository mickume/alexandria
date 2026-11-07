import { z } from 'zod';

/**
 * The OpenAPI 3.1 description of every route under /api/v1/. Each operation
 * names its responses with zod schemas, from which the document's JSON Schemas
 * are generated; the tests compare the document with the routes the
 * application registers and every response they receive with its schema.
 */

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** One documented response of an operation. */
export interface ResponseSpec {
  description: string;
  /** The body's schema; absent for a response without a body. */
  schema?: z.ZodType;
  headers?: Record<string, { description: string; schema: { type: string } }>;
}

/** One documented operation. */
export interface Operation {
  method: Method;
  /** The path under /api/v1, as an OpenAPI template such as /links/{id}. */
  path: string;
  operationId: string;
  summary: string;
  query?: Record<string, { description: string; schema: z.ZodType }>;
  body?: z.ZodType;
  responses: Record<number, ResponseSpec>;
}

/** The body of every error answer. */
export const ErrorBody = z.looseObject({
  error: z.string(),
  field: z.string().nullable().optional(),
  message: z.string().optional(),
});

/** The current user. */
export const Me = z.strictObject({ email: z.string(), name: z.string() });

/** A personal access token, as listed. */
export const Token = z.strictObject({
  id: z.string(),
  name: z.string(),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
});

/** A link in the user's library. */
export const Link = z.strictObject({
  id: z.string(),
  url: z.string().describe('The normalised URL'),
  original_url: z.string().describe('The URL as it was given'),
  host: z.string(),
  title: z.string(),
  state: z.string().describe('pending until the link is fetched'),
  added_at: z.string(),
  last_used_at: z.string(),
  use_count: z.number().int(),
  pinned: z.boolean(),
  pin_position: z.number().int().nullable(),
});

const error = (description: string): ResponseSpec => ({ description, schema: ErrorBody });

/** The answers any authenticated operation may give, added to each. */
function commonResponses(op: Operation): Record<number, ResponseSpec> {
  const common: Record<number, ResponseSpec> = {
    401: error('No valid session or token: {"error": "unauthorized"}'),
    429: {
      ...error('More than 600 requests in a minute: {"error": "rate_limited"}'),
      headers: {
        'Retry-After': {
          description: 'Seconds until the next minute',
          schema: { type: 'integer' },
        },
      },
    },
  };
  if (op.method !== 'get') {
    common[403] = error('A cookie-authenticated change from another origin: forbidden_origin');
  }
  if (op.body) common[400] ??= error('The body is not valid JSON, or a field is not acceptable');
  if (op.path.includes('{')) common[404] ??= error('No such resource for this user: not_found');
  return common;
}

/** Every documented operation. Routes add theirs as they are implemented. */
export const operations: Operation[] = [
  {
    method: 'get',
    path: '/me',
    operationId: 'getMe',
    summary: 'The current user',
    responses: { 200: { description: 'The user’s email and display name', schema: Me } },
  },
  {
    method: 'get',
    path: '/openapi.json',
    operationId: 'getOpenApi',
    summary: 'This document',
    responses: {
      200: {
        description: 'The OpenAPI 3.1 document',
        schema: z.looseObject({ openapi: z.string() }),
      },
    },
  },
  {
    method: 'post',
    path: '/tokens',
    operationId: 'createToken',
    summary: 'Create a personal access token; its secret is returned this once',
    body: z.object({ name: z.string().min(1).max(100) }),
    responses: {
      201: {
        description: 'The token with its secret (alx_…), never shown again',
        schema: Token.extend({ secret: z.string() }),
      },
      400: error('invalid_json, or invalid_name: a name of 1 to 100 characters is required'),
      403: error('not_allowed: the address has left the allow-list; or forbidden_origin'),
      409: error('token_limit: 20 unrevoked tokens already, "token limit reached"'),
    },
  },
  {
    method: 'get',
    path: '/tokens',
    operationId: 'listTokens',
    summary: 'The unrevoked tokens, newest first, without their secrets',
    responses: {
      200: { description: 'The tokens', schema: z.strictObject({ items: z.array(Token) }) },
    },
  },
  {
    method: 'delete',
    path: '/tokens/{id}',
    operationId: 'revokeToken',
    summary: 'Revoke a token; it authenticates nothing from the next request on',
    responses: { 204: { description: 'Revoked' } },
  },
  {
    method: 'post',
    path: '/links',
    operationId: 'addLink',
    summary: 'Add a link, or boost the existing link with the same normalised URL',
    body: z.object({ url: z.string() }),
    responses: {
      200: {
        description: 'Already in the library: its last use is now',
        schema: z.strictObject({ status: z.literal('boosted'), link: Link }),
      },
      201: {
        description: 'Added, pending',
        schema: z.strictObject({ status: z.literal('added'), link: Link }),
      },
      400: error('invalid_json, or invalid_url with the input as url: "not a valid web address"'),
      409: error('library_full: "library full (20,000 links)"'),
    },
  },
  {
    method: 'post',
    path: '/links/batch',
    operationId: 'addLinks',
    summary: 'Add or boost 1 to 100 links; the first ends highest in the stream',
    body: z.object({ urls: z.array(z.string()).min(1).max(100) }),
    responses: {
      200: {
        description: 'What happened to each URL; repeats of the batch are collapsed',
        schema: z.strictObject({
          added: z.array(Link),
          boosted: z.array(Link),
          invalid: z.array(
            z.strictObject({
              url: z.unknown(),
              error: z.enum(['invalid_url', 'library_full']),
            }),
          ),
        }),
      },
      400: error('invalid_json, no_urls or too_many_urls'),
    },
  },
  {
    method: 'get',
    path: '/links',
    operationId: 'listLinks',
    summary: 'The stream: pinned links by position, then the rest by last use, newest first',
    query: {
      limit: { description: 'Links per page, 1 to 100 (default 50)', schema: z.string() },
      cursor: { description: 'The next_cursor of the previous page', schema: z.string() },
    },
    responses: {
      200: {
        description: 'One page of the stream; archived links are left out',
        schema: z.strictObject({ items: z.array(Link), next_cursor: z.string().nullable() }),
      },
      400: error('invalid_limit or invalid_cursor'),
    },
  },
  {
    method: 'get',
    path: '/links/{id}',
    operationId: 'getLink',
    summary: 'One link',
    responses: { 200: { description: 'The link', schema: Link } },
  },
  {
    method: 'get',
    path: '/links/{id}/open',
    operationId: 'openLink',
    summary: 'Record a use of the link and redirect to its normalised URL',
    responses: {
      302: {
        description: 'To the link’s URL; the use count is one higher and last_used_at is now',
        headers: {
          Location: { description: 'The link’s normalised URL', schema: { type: 'string' } },
        },
      },
    },
  },
  {
    method: 'get',
    path: '/links/{id}/history',
    operationId: 'getLinkHistory',
    summary: 'The link’s events, newest first',
    query: {
      limit: { description: 'Events per page, 1 to 100 (default 100)', schema: z.string() },
      cursor: { description: 'The next_cursor of the previous page', schema: z.string() },
    },
    responses: {
      200: {
        description: 'One page of events',
        schema: z.strictObject({
          items: z.array(z.strictObject({ kind: z.string(), at: z.string() })),
          next_cursor: z.string().nullable(),
        }),
      },
      400: error('invalid_limit or invalid_cursor'),
    },
  },
  {
    method: 'post',
    path: '/links/{id}/pin',
    operationId: 'pinLink',
    summary:
      'Pin the link at a position (1-based; past the end means the end), or at the end without one',
    body: z.object({ position: z.number().int().min(1).optional() }),
    responses: {
      200: { description: 'The pinned link', schema: Link },
      400: error('invalid_json, or invalid_position: an integer of at least 1'),
      409: error('pin_limit: 30 links are pinned, "unpin something first"'),
    },
  },
  {
    method: 'delete',
    path: '/links/{id}/pin',
    operationId: 'unpinLink',
    summary: 'Unpin the link; it returns to its place by last use',
    responses: { 200: { description: 'The unpinned link', schema: Link } },
  },
];

function jsonSchema(schema: z.ZodType): object {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, {
    io: 'output',
    unrepresentable: 'any',
  });
  return rest;
}

/** The OpenAPI 3.1 document. */
export function openApiDocument(): object {
  const paths: Record<string, Record<string, object>> = {};
  for (const op of operations) {
    const responses = { ...commonResponses(op), ...op.responses };
    const parameters = [
      ...[...op.path.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => ({
        name: m[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
      })),
      ...Object.entries(op.query ?? {}).map(([name, q]) => ({
        name,
        in: 'query',
        required: false,
        description: q.description,
        schema: jsonSchema(q.schema),
      })),
    ];
    (paths[op.path] ??= {})[op.method] = {
      operationId: op.operationId,
      summary: op.summary,
      ...(parameters.length ? { parameters } : {}),
      ...(op.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: jsonSchema(op.body) } },
            },
          }
        : {}),
      responses: Object.fromEntries(
        Object.entries(responses).map(([status, r]) => [
          status,
          {
            description: r.description,
            ...(r.headers ? { headers: r.headers } : {}),
            ...(r.schema
              ? { content: { 'application/json': { schema: jsonSchema(r.schema) } } }
              : {}),
          },
        ]),
      ),
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Alexandria API',
      version: '1',
      description: 'The personal link library. Authenticate with a personal access token.',
    },
    servers: [{ url: '/api/v1' }],
    security: [{ bearer: [] }, { session: [] }],
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', description: 'A personal access token (alx_…)' },
        session: { type: 'apiKey', in: 'cookie', name: 'alexandria_session' },
      },
    },
    paths,
  };
}

/** The operation a request to `pathname` (under /api/v1/) with `method` reaches, if documented. */
export function findOperation(method: string, pathname: string): Operation | undefined {
  const m = method.toLowerCase();
  return operations.find((op) => {
    if (op.method !== m) return false;
    const pattern = op.path.replace(/[.]/g, '\\.').replace(/\{[a-zA-Z]+\}/g, '[^/]+');
    return new RegExp(`^/api/v1${pattern}$`).test(pathname);
  });
}

/**
 * Why a response does not match the document, or null when it does: its status
 * must be declared for the operation and its body must match that status's schema.
 */
export function responseMismatch(op: Operation, status: number, body: unknown): string | null {
  const spec = op.responses[status] ?? commonResponses(op)[status];
  if (!spec) return `status ${status} is not declared for ${op.operationId}`;
  if (!spec.schema) return body === null ? null : `${op.operationId} ${status} declares no body`;
  const parsed = spec.schema.safeParse(body);
  return parsed.success
    ? null
    : `${op.operationId} ${status} body does not match: ${parsed.error.message}`;
}

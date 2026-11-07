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
  /** The body's schema; absent for a response without a JSON body. */
  schema?: z.ZodType;
  /** The media type of a body that is not JSON, such as text/html. */
  mediaType?: string;
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
  /** Whether the body may be left out. */
  bodyOptional?: boolean;
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
  final_url: z.string().nullable().describe('The URL of the last response of the latest fetch'),
  http_status: z.number().int().nullable(),
  description: z.string().nullable(),
  favicon_url: z.string().nullable(),
  language: z.string().nullable(),
  fetched_at: z.string().nullable(),
  state_reason: z.string().nullable().describe('Why the link is pending or unreachable'),
  notes: z.array(z.string()).describe('Such as "truncated" or "not a web page (image/png)"'),
  content_kind: z.enum(['html', 'pdf', 'other']).nullable(),
  has_snapshot: z.boolean(),
  updated_at: z.string().describe('When the link last changed in any way'),
  summary: z.string().nullable(),
  tags: z.array(z.string()),
  topic: z.string().nullable(),
  enrichment_status: z
    .enum(['no_key', 'queued', 'enriched', 'failed', 'skipped', 'waiting_for_key'])
    .nullable()
    .describe('Why the link has or has not a summary; null before its first fetch'),
  enrichment_reason: z.string().nullable(),
  edited_fields: z.array(z.string()).describe('Fields the owner set by hand'),
  note_preview: z.string().nullable().describe('The note’s first line as plain text'),
  workspaces: z.array(z.strictObject({ id: z.string(), name: z.string() })),
  sticky: z.boolean().describe('At least 5 uses on 5 UTC days: never dormant or archived by decay'),
  archived_at: z.string().nullable(),
  removal_at: z.string().nullable().describe('When an archived link will be removed'),
  dead_since: z.string().nullable(),
  last_checked_at: z.string().nullable(),
  last_check_result: z.string().nullable(),
  decay_note: z.string().describe('The link’s decay state and why, in one sentence'),
});

/** A link read on its own, with its whole note. */
export const LinkWithNote = Link.extend({ note: z.string() });

/** The AI settings, never with the key beyond its last 4 characters. */
const AiSettingsView = z.strictObject({
  configured: z.literal(true),
  provider: z.enum(['anthropic', 'openrouter']),
  model: z.string(),
  key_last4: z.string(),
  status: z.enum(['verified', 'rejected']),
  rejected_message: z.string().nullable(),
});

/** A workspace in a list. */
export const WorkspaceSummary = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  link_count: z.number().int(),
  created_at: z.string(),
});

/** A workspace on its own, with its note. */
export const Workspace = WorkspaceSummary.extend({ note: z.string() });

const error = (description: string): ResponseSpec => ({ description, schema: ErrorBody });

const NO_SNAPSHOT = error('not_found, or no_snapshot: "no snapshot stored for this link"');

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
    method: 'get',
    path: '/settings/ai',
    operationId: 'getAiSettings',
    summary: 'The AI provider, model and key (by its last 4 characters), and how many links wait',
    responses: {
      200: {
        description: 'The settings, or configured: false without a key',
        schema: z.union([
          AiSettingsView.extend({ unenriched_count: z.number().int() }),
          z.strictObject({ configured: z.literal(false), unenriched_count: z.number().int() }),
        ]),
      },
    },
  },
  {
    method: 'put',
    path: '/settings/ai',
    operationId: 'saveAiSettings',
    summary: 'Store the AI provider, model and key after a test request the provider accepts',
    body: z.object({
      provider: z.enum(['anthropic', 'openrouter']),
      api_key: z.string().min(1),
      model: z
        .string()
        .max(200)
        .optional()
        .describe('Required for OpenRouter; default claude-opus-5-5'),
    }),
    responses: {
      200: { description: 'Stored and verified', schema: AiSettingsView },
      400: error(
        'invalid_json, invalid_provider, invalid_key, model_required, invalid_model, or key_rejected with the provider’s message',
      ),
      502: error('provider_unavailable: the provider could not be reached or did not answer'),
    },
  },
  {
    method: 'delete',
    path: '/settings/ai',
    operationId: 'deleteAiSettings',
    summary: 'Forget the AI provider, model and key',
    responses: { 204: { description: 'Removed' } },
  },
  {
    method: 'get',
    path: '/settings/decay',
    operationId: 'getDecaySettings',
    summary: 'The decay thresholds, in days',
    responses: {
      200: {
        description: 'The thresholds',
        schema: z.strictObject({
          dormant_days: z.number().int(),
          archive_days: z.number().int(),
          remove_days: z.number().int(),
        }),
      },
    },
  },
  {
    method: 'put',
    path: '/settings/decay',
    operationId: 'saveDecaySettings',
    summary: 'Set the decay thresholds: whole days from 7 to 3650, dormant below archive',
    body: z.object({
      dormant_days: z.number().int().min(7).max(3650),
      archive_days: z.number().int().min(7).max(3650),
      remove_days: z.number().int().min(7).max(3650),
    }),
    responses: {
      200: {
        description: 'The stored thresholds',
        schema: z.strictObject({
          dormant_days: z.number().int(),
          archive_days: z.number().int(),
          remove_days: z.number().int(),
        }),
      },
      400: error('invalid_json, invalid_threshold (naming the field) or invalid_thresholds'),
    },
  },
  {
    method: 'post',
    path: '/workspaces',
    operationId: 'createWorkspace',
    summary: 'Create a workspace',
    body: z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(1000).optional().describe('One paragraph, no line break'),
    }),
    responses: {
      201: { description: 'The new, empty workspace', schema: Workspace },
      400: error('invalid_json, invalid_name or invalid_description'),
      409: error('name_taken, or workspace_limit: "workspace limit reached (200)"'),
    },
  },
  {
    method: 'get',
    path: '/workspaces',
    operationId: 'listWorkspaces',
    summary: 'The workspaces, by name ignoring case',
    query: {
      limit: { description: 'Workspaces per page, 1 to 100 (default 100)', schema: z.string() },
      cursor: { description: 'The next_cursor of the previous page', schema: z.string() },
    },
    responses: {
      200: {
        description: 'One page of workspaces',
        schema: z.strictObject({
          items: z.array(WorkspaceSummary),
          next_cursor: z.string().nullable(),
        }),
      },
      400: error('invalid_limit or invalid_cursor'),
    },
  },
  {
    method: 'get',
    path: '/workspaces/{id}',
    operationId: 'getWorkspace',
    summary: 'One workspace, with its note',
    responses: { 200: { description: 'The workspace', schema: Workspace } },
  },
  {
    method: 'patch',
    path: '/workspaces/{id}',
    operationId: 'updateWorkspace',
    summary: 'Rename a workspace, change its description or its note',
    body: z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(1000).optional(),
      note: z.string().optional().describe('Markdown, at most 20,000 characters; empty clears it'),
    }),
    responses: {
      200: { description: 'The workspace', schema: Workspace },
      400: error('invalid_json, invalid_name, invalid_description, invalid_note or note_too_long'),
      409: error('name_taken'),
    },
  },
  {
    method: 'get',
    path: '/workspaces/{id}/links',
    operationId: 'listWorkspaceLinks',
    summary: 'The workspace’s links in their order, whatever their state',
    query: {
      limit: { description: 'Links per page, 1 to 100 (default 100)', schema: z.string() },
      cursor: { description: 'The next_cursor of the previous page', schema: z.string() },
    },
    responses: {
      200: {
        description: 'One page of members, each a link with its position',
        schema: z.strictObject({
          items: z.array(Link.extend({ position: z.number().int() })),
          next_cursor: z.string().nullable(),
        }),
      },
      400: error('invalid_limit or invalid_cursor'),
    },
  },
  {
    method: 'post',
    path: '/workspaces/{id}/links',
    operationId: 'addWorkspaceLink',
    summary: 'Add a link to the workspace, or move it: at the bottom, or at a 1-based position',
    body: z.object({ link_id: z.string(), position: z.number().int().min(1).optional() }),
    responses: {
      200: {
        description: 'Moved, or already a member',
        schema: z.strictObject({
          workspace_id: z.string(),
          link_id: z.string(),
          position: z.number().int(),
        }),
      },
      201: {
        description: 'Added',
        schema: z.strictObject({
          workspace_id: z.string(),
          link_id: z.string(),
          position: z.number().int(),
        }),
      },
      400: error('invalid_json, invalid_link_id or invalid_position'),
    },
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/links/{linkId}',
    operationId: 'removeWorkspaceLink',
    summary: 'Take a link out of the workspace; the link stays in the library',
    responses: { 204: { description: 'Removed' } },
  },
  {
    method: 'delete',
    path: '/workspaces/{id}',
    operationId: 'deleteWorkspace',
    summary: 'Delete a workspace and its memberships; its links stay',
    responses: { 204: { description: 'Deleted' } },
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
    path: '/links/enrich-unenriched',
    operationId: 'enrichUnenriched',
    summary: 'Enrich every link waiting for it (no_key, waiting_for_key, failed), 20 a minute',
    responses: {
      202: {
        description: 'How many links were queued',
        schema: z.strictObject({ queued: z.number().int() }),
      },
      409: error('no_ai_key: "add an AI key in settings" (no key, or a rejected one)'),
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
      changed_since: {
        description:
          'Instead of a page: the links changed since this time (a server_time), oldest change first',
        schema: z.string(),
      },
    },
    responses: {
      200: {
        description:
          'One page of the stream (archived links left out); with changed_since, the changed links and the server time to ask from next',
        schema: z.union([
          z.strictObject({ items: z.array(Link), next_cursor: z.string().nullable() }),
          z.strictObject({ items: z.array(Link), server_time: z.string() }),
        ]),
      },
      400: error('invalid_limit, invalid_cursor or invalid_changed_since'),
    },
  },
  {
    method: 'get',
    path: '/links/{id}',
    operationId: 'getLink',
    summary: 'One link',
    responses: { 200: { description: 'The link, with its note', schema: LinkWithNote } },
  },
  {
    method: 'get',
    path: '/links/{id}/reader',
    operationId: 'readLink',
    summary: 'Record a use and return the stored reader view',
    responses: {
      200: {
        description: 'The reader view; for a PDF, its text',
        schema: z.strictObject({
          content_kind: z.enum(['html', 'pdf']),
          title: z.string().nullable(),
          byline: z.string().nullable(),
          html: z.string().nullable(),
          text: z.string(),
          empty: z.boolean(),
        }),
      },
      404: NO_SNAPSHOT,
    },
  },
  {
    method: 'get',
    path: '/links/{id}/snapshot',
    operationId: 'getSnapshot',
    summary: 'Record a use and return the stored snapshot: HTML under a sandbox policy, or the PDF',
    query: {
      download: { description: '1 to download a PDF as an attachment', schema: z.string() },
    },
    responses: {
      200: {
        description:
          'text/html with Content-Security-Policy sandbox, or application/pdf inline (attachment with download=1)',
        mediaType: 'text/html',
      },
      404: NO_SNAPSHOT,
    },
  },
  {
    method: 'post',
    path: '/links/{id}/enrich',
    operationId: 'enrichLink',
    summary: 'Run the enrichment of the link again, at once',
    responses: {
      202: { description: 'Queued', schema: z.strictObject({ status: z.literal('queued') }) },
      409: error('no_ai_key, or nothing_to_enrich for a pending, unreachable or skipped link'),
    },
  },
  {
    method: 'post',
    path: '/links/{id}/refresh',
    operationId: 'refreshLink',
    summary: 'Fetch the link again, replacing its stored copy; at most once per 10 minutes',
    responses: {
      202: { description: 'Queued', schema: z.strictObject({ status: z.literal('queued') }) },
      429: {
        ...error('refreshed_recently: "already refreshed recently", or rate_limited'),
        headers: {
          'Retry-After': {
            description: 'Seconds until a refresh is allowed',
            schema: { type: 'integer' },
          },
        },
      },
    },
  },
  {
    method: 'patch',
    path: '/links/{id}',
    operationId: 'editLink',
    summary:
      'Edit title, summary, tags or topic; edited fields are never overwritten automatically',
    body: z.object({
      title: z.string().min(1).max(500).optional(),
      summary: z.string().max(2000).optional(),
      tags: z.array(z.string()).max(20).optional(),
      topic: z.string().min(1).max(100).optional(),
      note: z.string().optional().describe('Markdown, at most 20,000 characters; empty clears it'),
    }),
    responses: {
      200: { description: 'The link, with edited_fields and its note', schema: LinkWithNote },
      400: error(
        'invalid_json, invalid_title, invalid_summary, invalid_tags, invalid_topic, invalid_note or note_too_long',
      ),
    },
  },
  {
    method: 'delete',
    path: '/links/{id}',
    operationId: 'deleteLink',
    summary: 'Delete the link, its history and its stored copies, at once and for good',
    responses: { 204: { description: 'Deleted' } },
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
    summary: 'The link’s uses and fetch attempts, newest first',
    query: {
      limit: { description: 'Events per page, 1 to 100 (default 100)', schema: z.string() },
      cursor: { description: 'The next_cursor of the previous page', schema: z.string() },
    },
    responses: {
      200: {
        description: 'One page of events',
        schema: z.strictObject({
          items: z.array(
            z.union([
              z.strictObject({ kind: z.literal('use'), at: z.string() }),
              z.strictObject({
                kind: z.literal('fetch'),
                at: z.string(),
                outcome: z.enum(['ok', 'failed']),
                http_status: z.number().int().nullable(),
                reason: z.string().nullable(),
              }),
            ]),
          ),
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
    bodyOptional: true,
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
              required: !op.bodyOptional,
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

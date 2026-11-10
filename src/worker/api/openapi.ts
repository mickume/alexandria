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
  /** A body that is not JSON: its media types, each with its JSON Schema. */
  upload?: Record<string, object>;
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
  topic_path: z
    .array(z.string())
    .describe('The names from the top-level topic down to the link’s own topic; [] without one'),
  enrichment_status: z
    .enum(['no_key', 'queued', 'enriched', 'failed', 'skipped', 'waiting_for_key'])
    .nullable()
    .describe('Why the link has or has not a summary; null before its first fetch'),
  enrichment_reason: z.string().nullable(),
  edited_fields: z.array(z.string()).describe('Fields the owner set by hand'),
  note_preview: z.string().nullable().describe('The note’s first line as plain text'),
  workspaces: z.array(z.strictObject({ id: z.string(), name: z.string() })),
  points: z
    .number()
    .int()
    .nullable()
    .describe(
      'Start points plus the use count, minus whole days since the last use or boost; null for an archived link',
    ),
  archived_at: z.string().nullable().describe('When the link was archived, while it is archived'),
  expired_at: z.string().nullable().describe('When the link expired, while it is expired'),
  removal_at: z.string().nullable().describe('When an expired link will be removed'),
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

const FirecrawlSettingsView = z.strictObject({
  configured: z.literal(true),
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

/** The link list's filters, with the meaning of the search's prefix filters; each may repeat. */
const FILTER_PARAMETERS: Operation['query'] = {
  tag: { description: 'Links with this tag (ignoring case)', schema: z.string() },
  topic: {
    description: 'Links with this topic or a topic beneath it (ignoring case)',
    schema: z.string(),
  },
  host: { description: 'Links on this host or a subdomain of it', schema: z.string() },
  state: {
    description:
      'pending, active, unreachable, expired, archived or any; without it, expired links are left out (and archived ones from the stream)',
    schema: z.string(),
  },
  in: { description: 'Links in the workspace with this name (ignoring case)', schema: z.string() },
  is: { description: 'pinned or dead', schema: z.string() },
};

/** A snippet: the passage of the best-matching text, matched words marked. */
const Snippet = z.array(z.strictObject({ text: z.string(), match: z.boolean() }));

/** A link's stored reader view; for a PDF, its text. */
const ReaderView = z.strictObject({
  content_kind: z.enum(['html', 'pdf']),
  title: z.string().nullable(),
  byline: z.string().nullable(),
  html: z.string().nullable(),
  text: z.string(),
  empty: z.boolean(),
});

/** A tag in the export. */
const ExportedLabel = z.strictObject({
  id: z.string(),
  name: z.string(),
  link_count: z.number().int(),
});

/** A topic in the export. */
const ExportedTopic = z.strictObject({
  id: z.string(),
  name: z.string(),
  parent_id: z.string().nullable().describe('Null for a top-level topic'),
  link_count: z.number().int().describe('The links filed directly under the topic'),
});

/** An import's report. */
const ImportReport = z.strictObject({
  id: z.string(),
  created_at: z.string(),
  counts: z.strictObject({
    url_lines: z.number().int(),
    added: z.number().int(),
    duplicates: z.number().int(),
    invalid: z.number().int(),
    not_imported: z.number().int(),
  }),
  invalid: z.array(z.strictObject({ line: z.number().int(), text: z.string() })),
  duplicates: z.array(z.strictObject({ line: z.number().int(), url: z.string() })),
  stopped_at_limit: z.strictObject({ line: z.number().int() }).nullable(),
  workspace: z
    .strictObject({ id: z.string(), name: z.string(), added: z.number().int() })
    .nullable()
    .describe('The workspace the links were added to, and how many joined it'),
});

/** A topic or tag as listed. */
const VocabularyItem = z.strictObject({
  id: z.string(),
  name: z.string(),
  count: z.number().int(),
  newest_added_at: z.string(),
});

/** A topic as listed: its place in the tree, its own links and those beneath it. */
const TopicItem = z.strictObject({
  id: z.string(),
  name: z.string(),
  parent_id: z.string().nullable().describe('Null for a top-level topic'),
  count: z.number().int().describe('The links filed directly under the topic, in any state'),
  subtree_count: z
    .number()
    .int()
    .describe('The links filed under the topic or any topic beneath it, in any state'),
  newest_added_at: z.string().describe('The added date of the newest of those links'),
});

/** A topic after a move. */
const TopicEntry = z.strictObject({
  id: z.string(),
  name: z.string(),
  parent_id: z.string().nullable(),
  count: z.number().int().describe('The links filed directly under the topic'),
  subtree_count: z.number().int().describe('The links filed under the topic or beneath it'),
});

/** A topic or tag after a rename or merge. */
const VocabularyEntry = z.strictObject({
  id: z.string(),
  name: z.string(),
  count: z.number().int(),
});

/** The answer of a search. */
export const SearchResults = z.strictObject({
  items: z.array(z.strictObject({ link: Link, snippet: Snippet })),
  workspaces: z.array(z.strictObject({ id: z.string(), name: z.string(), snippet: Snippet })),
  next_cursor: z.string().nullable(),
});

/** The answer of a search with mode=hybrid: SearchResults, each item saying how it matched, and whether meaning was added. */
export const HybridResults = z.strictObject({
  items: z.array(
    z.strictObject({
      link: Link,
      snippet: Snippet,
      match: z
        .enum(['keyword', 'meaning', 'both'])
        .optional()
        .describe('How the link matched; absent in an answer that is the stream'),
    }),
  ),
  workspaces: z.array(z.strictObject({ id: z.string(), name: z.string(), snippet: Snippet })),
  next_cursor: z.string().nullable(),
  meaning: z
    .enum(['used', 'unavailable'])
    .describe('unavailable when Workers AI or Vectorize could not be used'),
});

/** The answer of a request for passages. */
export const PassageResults = z.strictObject({
  items: z.array(
    z.strictObject({
      link_id: z.string(),
      title: z.string(),
      url: z.string().describe('The link’s original URL'),
      passage: z.string().describe('At most 1,500 characters of the link’s indexed text'),
      score: z.number().describe('The similarity to the question, from 0.5 up to 1'),
    }),
  ),
  meaning: z.literal('used'),
});

const error = (description: string): ResponseSpec => ({ description, schema: ErrorBody });

const count = z.number().int();

/** One of the 5 most common reasons, most first, ties by reason. */
const Reason = z.strictObject({ reason: z.string(), count });

/** The owner's library statistics, computed at the time of the request. */
export const Stats = z.strictObject({
  library: z.strictObject({
    total: count,
    by_state: z.strictObject({
      pending: count,
      active: count,
      unreachable: count,
      expired: count,
      archived: count,
    }),
    pinned: count,
    in_workspace: count.describe('Links in at least one workspace'),
    limit: count.describe('The most links a library holds'),
  }),
  content: z.strictObject({
    by_kind: z.strictObject({ html: count, pdf: count, other: count, unfetched: count }),
    with_snapshot: count,
    reader_empty: count.describe('Links whose reader view has no text'),
  }),
  topics: z.strictObject({
    total: count,
    by_level: z.strictObject({ '1': count, '2': count, '3': count }),
    links_without_topic: count,
    largest: z
      .array(
        z.strictObject({
          id: z.string(),
          name: z.string(),
          path: z.array(z.string()).describe('The names from the top level down'),
          count: count.describe('Links filed directly under the topic'),
        }),
      )
      .describe('At most 10, most links first, ties by name'),
  }),
  tags: z.strictObject({
    total: count,
    used_once: count,
    links_without_tags: count,
    top: z
      .array(z.strictObject({ id: z.string(), name: z.string(), count }))
      .describe('At most 10, most links first, ties by name'),
  }),
  workspaces: z.strictObject({
    total: count,
    largest: z
      .array(z.strictObject({ id: z.string(), name: z.string(), count }))
      .describe('At most 10, most links first, ties by name'),
  }),
  hosts: z.strictObject({
    distinct: count,
    top: z
      .array(z.strictObject({ host: z.string(), count }))
      .describe('At most 10, most links first, ties by host'),
  }),
  expiry: z.strictObject({
    expiring: z
      .strictObject({ today: count, within_7_days: count, within_30_days: count })
      .describe('Unprotected links at ≤0, 1–7 and 8–30 points; the buckets do not overlap'),
    points_histogram: z
      .array(z.strictObject({ range: z.string(), count }))
      .describe('Unprotected links in the ranges ≤0, 1–7, 8–30, 31–60, 61–90 and >90, in order'),
    protected_at_risk: count.describe('Pinned or workspace links at 0 points or below'),
    awaiting_removal: z
      .strictObject({ total: count, within_7_days: count, within_30_days: count })
      .describe('Expired links decay will remove; the windows are cumulative'),
    settings: z.strictObject({ start_points: count, remove_days: count }),
  }),
  health: z.strictObject({
    unreachable: z.strictObject({ count, by_reason: z.array(Reason) }),
    dead: z.strictObject({ count, dead_over_30_days: count }),
    enrichment: z.strictObject({
      no_key: count,
      queued: count,
      enriched: count,
      failed: count,
      skipped: count,
      waiting_for_key: count,
      none: count,
      failed_by_reason: z.array(Reason),
    }),
    ai_key: z.enum(['none', 'verified', 'rejected']),
  }),
  backlog: z.strictObject({
    fetch_pending: count,
    fetch_retrying: count.describe('Pending links with a failed attempt'),
    enrichment_queued: count,
    imports: z
      .array(
        z.strictObject({
          id: z.string(),
          created_at: z.string(),
          added: count,
          waiting: count,
          in_progress: count,
          done: count,
        }),
      )
      .describe('Imports with links waiting or in progress, newest first, at most 10'),
    index_stale: count.describe('Links whose meaning index is out of date'),
    vector_deletions: count,
    liveness_due: count.describe('Links the next hourly run would enqueue for a liveness check'),
    throttle_clear_at: z
      .string()
      .nullable()
      .describe('When the background throttle frees up; null when it already has'),
  }),
});

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
    method: 'delete',
    path: '/me',
    operationId: 'deleteAccount',
    summary:
      'Delete the account and all its data, confirmed by its email; with a session only. No undo',
    body: z.object({ confirm_email: z.string() }),
    responses: {
      202: {
        description:
          'Signed out everywhere at once; the rest of the account is removed within minutes',
        schema: z.strictObject({ status: z.literal('deleting') }),
      },
      400: error('invalid_json, or confirmation_mismatch: "type your email address to confirm"'),
      403: error(
        'session_required: "delete the account from the settings page" (a token cannot), or forbidden_origin',
      ),
    },
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
    path: '/settings/firecrawl',
    operationId: 'getFirecrawlSettings',
    summary: 'The Firecrawl key (by its last 4 characters) used for pages behind a bot check',
    responses: {
      200: {
        description: 'The settings, or configured: false without a key',
        schema: z.union([FirecrawlSettingsView, z.strictObject({ configured: z.literal(false) })]),
      },
    },
  },
  {
    method: 'put',
    path: '/settings/firecrawl',
    operationId: 'saveFirecrawlSettings',
    summary: 'Store the Firecrawl key after a test request Firecrawl accepts',
    body: z.object({ api_key: z.string().min(1) }),
    responses: {
      200: { description: 'Stored and verified', schema: FirecrawlSettingsView },
      400: error('invalid_json, invalid_key, or key_rejected with Firecrawl’s message'),
      502: error('provider_unavailable: Firecrawl could not be reached or did not answer'),
    },
  },
  {
    method: 'delete',
    path: '/settings/firecrawl',
    operationId: 'deleteFirecrawlSettings',
    summary: 'Forget the Firecrawl key',
    responses: { 204: { description: 'Removed' } },
  },
  {
    method: 'get',
    path: '/settings/decay',
    operationId: 'getDecaySettings',
    summary: 'The decay settings: the start points and the days from expiry to removal',
    responses: {
      200: {
        description: 'The settings',
        schema: z.strictObject({
          start_points: z.number().int(),
          remove_days: z.number().int(),
        }),
      },
    },
  },
  {
    method: 'put',
    path: '/settings/decay',
    operationId: 'saveDecaySettings',
    summary: 'Set the decay settings: each a whole number from 7 to 3650',
    body: z.object({
      start_points: z.number().int().min(7).max(3650),
      remove_days: z.number().int().min(7).max(3650),
    }),
    responses: {
      200: {
        description: 'The stored settings',
        schema: z.strictObject({
          start_points: z.number().int(),
          remove_days: z.number().int(),
        }),
      },
      400: error('invalid_json, or invalid_threshold naming the field'),
    },
  },
  {
    method: 'post',
    path: '/imports',
    operationId: 'importLinks',
    summary:
      'Import a text or Markdown file: the first http(s) address of each line, new ones added in file order, the rest reported',
    upload: {
      'text/plain': { type: 'string', description: 'The file itself, UTF-8, at most 2 MB' },
      'text/markdown': { type: 'string', description: 'The file itself, UTF-8, at most 2 MB' },
      'multipart/form-data': {
        type: 'object',
        properties: {
          file: { type: 'string', format: 'binary' },
          workspace_id: { type: 'string', description: 'A workspace to add the file’s links to' },
        },
        required: ['file'],
      },
    },
    query: {
      workspace_id: {
        description: 'A workspace to add the file’s links to (or the form part workspace_id)',
        schema: z.string(),
      },
    },
    responses: {
      201: { description: 'The import and its report', schema: ImportReport },
      400: error(
        'unsupported_file: "only text or Markdown files (.txt, .md) are accepted", no_urls (field file), or unknown_workspace (field workspace_id)',
      ),
      409: error('import_too_large: "too large: at most 5,000 URLs / 2 MB per import"'),
    },
  },
  {
    method: 'get',
    path: '/imports/{id}',
    operationId: 'getImport',
    summary: 'An import’s report and the progress of its links',
    responses: {
      200: {
        description:
          'The report, and how many added links wait for their turn, are being fetched, are done and are enriched',
        schema: ImportReport.extend({
          progress: z.strictObject({
            waiting: z.number().int(),
            in_progress: z.number().int(),
            done: z.number().int(),
            enriched: z.number().int(),
          }),
        }),
      },
    },
  },
  {
    method: 'get',
    path: '/imports/{id}/report',
    operationId: 'getImportReport',
    summary: 'An import’s report as a downloadable text file',
    responses: {
      200: {
        description:
          'text/plain attachment alexandria-import-<YYYY-MM-DD>.txt: the counts, invalid lines, duplicates and the limit stop',
        mediaType: 'text/plain',
      },
    },
  },
  {
    method: 'get',
    path: '/export',
    operationId: 'exportLibrary',
    summary:
      'The whole library as one JSON document, streamed as a download, ending with "complete": true',
    responses: {
      200: {
        description:
          'attachment alexandria-export-<YYYY-MM-DD>.json: the user, links (each its GET /links/{id} body with snapshot_url and reader_url), workspaces, topics and tags',
        schema: z.strictObject({
          format: z.literal('alexandria-export'),
          version: z.literal(1),
          exported_at: z.string(),
          user: z.strictObject({ email: z.string(), name: z.string() }),
          links: z.array(
            LinkWithNote.extend({
              snapshot_url: z.string().nullable(),
              reader_url: z.string().nullable(),
            }),
          ),
          workspaces: z.array(
            z.strictObject({
              id: z.string(),
              name: z.string(),
              description: z.string(),
              note: z.string(),
              link_ids: z.array(z.string()),
            }),
          ),
          topics: z.array(ExportedTopic),
          tags: z.array(ExportedLabel),
          complete: z.literal(true),
        }),
      },
    },
  },
  {
    method: 'get',
    path: '/export/links/{id}/snapshot',
    operationId: 'exportSnapshot',
    summary: 'A link’s stored snapshot as the snapshot route serves it, recording no use',
    responses: {
      200: { description: 'The stored HTML (sandboxed) or PDF', mediaType: 'text/html' },
      404: error('not_found, or no_content: nothing of this kind is stored for the link'),
    },
  },
  {
    method: 'get',
    path: '/export/links/{id}/reader',
    operationId: 'exportReader',
    summary: 'A link’s reader view as the reader route serves it, recording no use',
    responses: {
      200: { description: 'The reader view', schema: ReaderView },
      404: error('not_found, or no_content: nothing of this kind is stored for the link'),
    },
  },
  {
    method: 'get',
    path: '/search',
    operationId: 'search',
    summary:
      'Search the links (and on the first page the workspaces); without free words, the stream',
    query: {
      q: {
        description:
          'Free words and the filters tag:, topic:, host:, state:, in: and is:, at most 200 characters',
        schema: z.string(),
      },
      limit: { description: 'Links per page, 1 to 100 (default 50)', schema: z.string() },
      cursor: { description: 'The next_cursor of the previous page', schema: z.string() },
      mode: {
        description:
          'keyword (the default) or hybrid, which also finds links by meaning and adds match and meaning to the answer',
        schema: z.string(),
      },
    },
    responses: {
      200: {
        description:
          'One page of results, most relevant first, each with its snippet as text segments; with mode=hybrid also meaning, and for a query with free words each item’s match',
        schema: z.union([SearchResults, HybridResults]),
      },
      400: error(
        'query_too_long, invalid_filter (field q), invalid_mode (field mode), invalid_limit or invalid_cursor',
      ),
    },
  },
  {
    method: 'get',
    path: '/passages',
    operationId: 'passages',
    summary: 'The passages of the links that best match a question by meaning, best first',
    query: {
      q: {
        description:
          'The question: free words, with the filters tag:, topic:, host:, state:, in: and is:, at most 200 characters',
        schema: z.string(),
      },
      limit: { description: 'Passages to return, 1 to 20 (default 8)', schema: z.string() },
    },
    responses: {
      200: {
        description:
          'The passages scoring at least the similarity threshold, at most three of one link; none when nothing matches',
        schema: PassageResults,
      },
      400: error(
        'invalid_question (no free word), query_too_long, invalid_filter (field q) or invalid_limit',
      ),
      503: error('search_unavailable: Workers AI or Vectorize failed or took over 5 seconds'),
    },
  },
  {
    method: 'post',
    path: '/ask',
    operationId: 'ask',
    summary:
      'Ask the library a question; the owner’s AI provider answers from passages of their links, streamed',
    body: z.strictObject({
      question: z
        .string()
        .describe(
          'The question: free words, with the filters tag:, topic:, host:, state:, in: and is:, at most 500 characters',
        ),
      detailed: z
        .boolean()
        .optional()
        .describe(
          'Asks for a longer, thorough answer from the 16 best passages instead of 8 (default false)',
        ),
    }),
    responses: {
      200: {
        description:
          'A stream of server-sent events: one sources {sources: [{n, link}]}, then delta {text} events citing sources as [n], then done {}; or, once started, one error {error, message} (ai_key_rejected, provider_unavailable or provider_failed) and no done',
        mediaType: 'text/event-stream',
      },
      400: error(
        'invalid_json, invalid_question (field question), question_too_long (field question), invalid_filter (field question) or invalid_detailed (field detailed)',
      ),
      409: error('no_ai_key, or ai_key_rejected with the provider’s message'),
      503: error('search_unavailable: Workers AI or Vectorize failed or took over 5 seconds'),
    },
  },
  ...(['topics', 'tags'] as const).map((kind): Operation => ({
    method: 'get',
    path: `/${kind}`,
    operationId: kind === 'topics' ? 'listTopics' : 'listTags',
    summary:
      kind === 'topics'
        ? 'Every topic, with its parent and the links under it and beneath it, newest link first'
        : 'The tags that have a link, with their counts, newest link first',
    query: {
      limit: { description: 'Items per page, 1 to 100 (default 50)', schema: z.string() },
      cursor: { description: 'The next_cursor of the previous page', schema: z.string() },
    },
    responses: {
      200: {
        description:
          kind === 'topics'
            ? 'One page of topics: each with its parent_id, count, subtree_count and the newest link’s added date'
            : 'One page of tags: the number of links in any state and the newest link’s added date',
        schema: z.strictObject({
          items: z.array(kind === 'topics' ? TopicItem : VocabularyItem),
          next_cursor: z.string().nullable(),
        }),
      },
      400: error('invalid_limit or invalid_cursor'),
    },
  })),
  ...(['topics', 'tags'] as const).flatMap((kind): Operation[] => {
    const one = kind === 'topics' ? 'Topic' : 'Tag';
    const mergeRefusals: Record<number, ResponseSpec> =
      kind === 'topics'
        ? {
            409: error(
              'invalid_merge: the survivor is beneath the source; too_deep: a child would end up below the third level',
            ),
          }
        : {};
    return [
      {
        method: 'patch',
        path: `/${kind}/{id}`,
        operationId: `rename${one}`,
        summary: `Rename a ${one.toLowerCase()}; the old name becomes an alias of it`,
        body: z.object({ name: z.string() }),
        responses: {
          200: { description: `The renamed ${one.toLowerCase()}`, schema: VocabularyEntry },
          400: error('invalid_json or invalid_name (field name)'),
          409: error('name_taken: another one has the name; merge instead'),
        },
      },
      {
        method: 'post',
        path: `/${kind}/{id}/merge`,
        operationId: `merge${one}`,
        summary: `Merge a ${one.toLowerCase()} into another, which keeps every link`,
        body: z.object({ into: z.string() }),
        responses: {
          200: { description: 'The survivor', schema: VocabularyEntry },
          400: error('invalid_json, or invalid_merge (field into): into missing or the source'),
          ...mergeRefusals,
        },
      },
    ];
  }),
  {
    method: 'post',
    path: '/topics/{id}/split',
    operationId: 'splitTopic',
    summary:
      'Divide the links filed directly under a topic into 2 to 10 sub-topics the owner’s AI provider proposes, applied at once',
    responses: {
      200: {
        description: 'The topic, every child of it by name, and how many links moved',
        schema: z.strictObject({
          topic: TopicEntry,
          children: z.array(VocabularyEntry),
          moved: z.number().int(),
        }),
      },
      409: error(
        'too_few_links (under 20), too_many_links (over 500), too_deep (a level-3 topic), no_ai_key, or ai_key_rejected (the key is marked rejected)',
      ),
      502: error('provider_failed: the provider failed, or its split could not be used'),
      503: error('provider_unavailable: unreachable, 5xx, or no answer within 60 seconds'),
    },
  },
  {
    method: 'post',
    path: '/topics/{id}/move',
    operationId: 'moveTopic',
    summary: 'Move a topic, with every topic beneath it, under another topic, or to the top level',
    body: z.object({
      parent: z.string().nullable().describe('The id of the new parent, or null for the top level'),
    }),
    responses: {
      200: { description: 'The moved topic', schema: TopicEntry },
      400: error(
        'invalid_json, or invalid_move (field parent): parent missing or not a string or null',
      ),
      409: error(
        'too_deep: topics are at most three levels deep; invalid_move: a topic cannot move under itself',
      ),
    },
  },
  {
    method: 'get',
    path: '/expired',
    operationId: 'listExpired',
    summary: 'The expired links, most recently expired first, each with its removal date',
    query: {
      limit: { description: 'Links per page, 1 to 100 (default 50)', schema: z.string() },
      cursor: { description: 'The next_cursor of the previous page', schema: z.string() },
    },
    responses: {
      200: {
        description: 'One page of expired links',
        schema: z.strictObject({ items: z.array(Link), next_cursor: z.string().nullable() }),
      },
      400: error('invalid_limit or invalid_cursor'),
    },
  },
  {
    method: 'get',
    path: '/archive',
    operationId: 'listArchive',
    summary: 'The archived links, most recently archived first, each with its archiving time',
    query: {
      limit: { description: 'Links per page, 1 to 100 (default 50)', schema: z.string() },
      cursor: { description: 'The next_cursor of the previous page', schema: z.string() },
    },
    responses: {
      200: {
        description: 'One page of archived links (removal_at null)',
        schema: z.strictObject({ items: z.array(Link), next_cursor: z.string().nullable() }),
      },
      400: error('invalid_limit or invalid_cursor'),
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
    summary:
      'The stream: pinned links by position, then the rest by points, then last use, newest first',
    query: {
      limit: { description: 'Links per page, 1 to 100 (default 50)', schema: z.string() },
      cursor: { description: 'The next_cursor of the previous page', schema: z.string() },
      changed_since: {
        description:
          'Instead of a page: the links changed since this time (a server_time), oldest change first',
        schema: z.string(),
      },
      ...FILTER_PARAMETERS,
    },
    responses: {
      200: {
        description:
          'One page of the stream (expired and archived links left out); with changed_since, the changed links and the server time to ask from next',
        schema: z.union([
          z.strictObject({ items: z.array(Link), next_cursor: z.string().nullable() }),
          z.strictObject({ items: z.array(Link), server_time: z.string() }),
        ]),
      },
      400: error(
        'invalid_limit, invalid_cursor, invalid_changed_since, or invalid_filter naming the parameter',
      ),
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
        schema: ReaderView,
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
    path: '/links/{id}/restore',
    operationId: 'restoreLink',
    summary: 'Bring an expired link back: active, last used now, use count unchanged',
    responses: {
      200: { description: 'The restored link', schema: LinkWithNote },
      409: error('not_expired: "this link is not expired"'),
    },
  },
  {
    method: 'post',
    path: '/links/{id}/archive',
    operationId: 'archiveLink',
    summary:
      'Archive a link: kept for good, out of the stream and out of decay, unpinned, in its workspaces still; a refresh of its page is queued',
    responses: {
      200: {
        description:
          'The archived link; a link already archived is returned unchanged and nothing is queued',
        schema: LinkWithNote,
      },
    },
  },
  {
    method: 'post',
    path: '/links/{id}/unarchive',
    operationId: 'unarchiveLink',
    summary: 'Bring an archived link back: active, last used now, use count unchanged, not pinned',
    responses: {
      200: { description: 'The unarchived link', schema: LinkWithNote },
      409: error('not_archived: "this link is not archived"'),
    },
  },
  {
    method: 'post',
    path: '/links/{id}/check',
    operationId: 'checkLink',
    summary: 'Check now that the link’s address answers; a pass clears its dead mark',
    responses: {
      200: {
        description: 'The check’s outcome and the link',
        schema: z.strictObject({
          passed: z.boolean(),
          result: z.string(),
          checked_at: z.string(),
          link: LinkWithNote,
        }),
      },
      409: error(
        'link_expired: "expired links are not checked", or link_archived: "archived links are not checked"',
      ),
      429: {
        ...error('checked_recently: "already checked recently", or rate_limited'),
        headers: {
          'Retry-After': {
            description: 'Seconds until a check is allowed',
            schema: { type: 'integer' },
          },
        },
      },
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
      topic: z
        .string()
        .min(1)
        .max(306)
        .optional()
        .describe(
          'A topic name, or a path of up to three names separated by >, each 1 to 100 characters',
        ),
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
    path: '/links/{id}/related',
    operationId: 'getRelatedLinks',
    summary: 'The other links nearest in meaning to the link, best first, worked out on request',
    responses: {
      200: {
        description:
          'At most five links whose metadata scores at least 0.7 against the link’s, expired links left out; none when the link is not indexed yet or nothing is near it',
        schema: z.strictObject({ items: z.array(Link.extend({ score: z.number() })) }),
      },
      503: error('search_unavailable: Workers AI or Vectorize failed or took over 5 seconds'),
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
      409: error(
        'pin_limit: 30 links are pinned, "unpin something first"; link_archived: "archived links cannot be pinned"',
      ),
    },
  },
  {
    method: 'delete',
    path: '/links/{id}/pin',
    operationId: 'unpinLink',
    summary: 'Unpin the link; it returns to its place by points',
    responses: { 200: { description: 'The unpinned link', schema: Link } },
  },
  {
    method: 'get',
    path: '/stats',
    operationId: 'getStats',
    summary:
      'The owner’s library statistics, computed at the time of the request; query parameters are ignored',
    responses: {
      200: { description: 'Every section of the statistics', schema: Stats },
      500: error('A section could not be computed: {"error": "internal"}; no partial result'),
    },
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
      ...(op.upload
        ? {
            requestBody: {
              required: true,
              content: Object.fromEntries(
                Object.entries(op.upload).map(([type, schema]) => [type, { schema }]),
              ),
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
              : r.mediaType
                ? { content: { [r.mediaType]: { schema: { type: 'string' } } } }
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

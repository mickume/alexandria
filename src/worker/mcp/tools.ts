/**
 * The MCP server's tools. Each performs the equivalent requests to the
 * Worker's own /api/v1/ routes as the agent's user, so that its shapes,
 * errors, limits and use recording are the API's.
 */
import { z } from 'zod';

/** An API response as a tool sees it: its status, and its JSON body or text. */
export interface ApiAnswer {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  text: string;
  contentType: string;
}

/** What a tool can do: send a request to the API as the agent's user. */
export interface ToolContext {
  call(method: string, path: string, body?: unknown): Promise<ApiAnswer>;
}

/** The API's error envelope. */
export interface ErrorEnvelope {
  error: string;
  message?: string;
  field?: string;
  [key: string]: unknown;
}

/** A tool's outcome: the API body on success, its error envelope on refusal. */
export type Outcome =
  { ok: true; body: Record<string, unknown> } | { ok: false; body: ErrorEnvelope };

/** A tool: its name, description, input schema and what it does. */
export interface Tool {
  name: string;
  description: string;
  input: z.ZodObject;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(ctx: ToolContext, args: any): Promise<Outcome>;
}

/** An unexpected failure: the API answered something no tool expects. */
export class UnexpectedAnswer extends Error {}

/** The outcome an API answer stands for: 2xx is success, 4xx a refusal, anything else unexpected. */
export function outcomeOf(answer: ApiAnswer): Outcome {
  if (answer.status >= 200 && answer.status < 300) {
    return { ok: true, body: (answer.json ?? {}) as Record<string, unknown> };
  }
  if (answer.status >= 400 && answer.status < 500 && answer.json?.error) {
    return { ok: false, body: answer.json as ErrorEnvelope };
  }
  throw new UnexpectedAnswer(`the API answered ${answer.status}`);
}

/** A tool refusal of the tool's own, in the API's envelope. */
export function refused(error: string, message: string, field?: string): Outcome {
  return { ok: false, body: field ? { error, field, message } : { error, message } };
}

const limit = (fallback: number) =>
  z.number().int().min(1).max(100).optional().describe(`How many, 1 to 100 (default ${fallback})`);

/** list_recent: the first page of the stream. */
const listRecent: Tool = {
  name: 'list_recent',
  description:
    'The links the owner used most recently: the first page of the stream, pinned links first, then by last use.',
  input: z.object({ limit: limit(20) }),
  async run(ctx, args: { limit?: number }) {
    return outcomeOf(await ctx.call('GET', `/links?limit=${args.limit ?? 20}`));
  },
};

/** Every workspace of the user, reading every page of GET /api/v1/workspaces. */
export async function allWorkspaces(ctx: ToolContext): Promise<Outcome> {
  const items: { id: string; name: string }[] = [];
  let cursor: string | null = null;
  do {
    const after: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const page = outcomeOf(await ctx.call('GET', `/workspaces?limit=100${after}`));
    if (!page.ok) return page;
    items.push(...(page.body.items as { id: string; name: string }[]));
    cursor = page.body.next_cursor as string | null;
  } while (cursor);
  return { ok: true, body: { items } };
}

/** The id of the user's workspace named by `value`: its id, or its name ignoring case; else null. */
export async function resolveWorkspace(ctx: ToolContext, value: string): Promise<string | null> {
  const all = await allWorkspaces(ctx);
  if (!all.ok) return null;
  const items = all.body.items as { id: string; name: string }[];
  const key = value.trim().toLowerCase();
  return (
    items.find((w) => w.id === value)?.id ??
    items.find((w) => w.name.trim().toLowerCase() === key)?.id ??
    null
  );
}

const NO_WORKSPACE = refused('not_found', 'no workspace of yours has this id or name');

/** A tag as add_link takes it: trimmed and lower-cased, a word or a hyphenated phrase. */
const TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The most tags a link carries (PATCH /api/v1/links/{id}). */
const TAGS_MAX = 20;

/** The tags trimmed and lower-cased, or null when one is not a word or a hyphenated phrase. */
function cleanTags(tags: string[]): string[] | null {
  const clean = tags.map((t) => t.trim().toLowerCase());
  return clean.length <= TAGS_MAX && clean.every((t) => TAG.test(t)) ? clean : null;
}

/** A link as the stream shows it: the link read on its own, without its whole note. */
function streamView(link: Record<string, unknown>): Record<string, unknown> {
  const { note: _note, ...view } = link;
  void _note;
  return view;
}

interface AddLinkArgs {
  url: string;
  tags?: string[];
  workspace?: string;
}

/**
 * add_link: checks the workspace and the tags first, so that a refused call
 * stores nothing; then adds or boosts the link (POST /api/v1/links), applies
 * the tags as a manual edit (PATCH /api/v1/links/{id}) and files it at the
 * bottom of the workspace unless it is a member already.
 */
async function addLink(ctx: ToolContext, args: AddLinkArgs): Promise<Outcome> {
  const workspaceId =
    args.workspace === undefined ? undefined : await resolveWorkspace(ctx, args.workspace);
  if (workspaceId === null) return NO_WORKSPACE;
  const tags = args.tags === undefined ? undefined : cleanTags(args.tags);
  if (tags === null) {
    return refused(
      'invalid_arguments',
      `tags: at most ${TAGS_MAX}, each a single word or a hyphenated phrase`,
      'tags',
    );
  }
  const added = outcomeOf(await ctx.call('POST', '/links', { url: args.url }));
  if (!added.ok || (tags === undefined && workspaceId === undefined)) return added;
  const link = added.body.link as { id: string; workspaces: { id: string }[] };
  if (tags !== undefined) {
    const edited = outcomeOf(await ctx.call('PATCH', `/links/${link.id}`, { tags }));
    if (!edited.ok) return edited;
  }
  if (workspaceId !== undefined && !link.workspaces.some((w) => w.id === workspaceId)) {
    const filed = outcomeOf(
      await ctx.call('POST', `/workspaces/${workspaceId}/links`, { link_id: link.id }),
    );
    if (!filed.ok) return filed;
  }
  const now = outcomeOf(await ctx.call('GET', `/links/${link.id}`));
  if (!now.ok) return now;
  return { ok: true, body: { status: added.body.status, link: streamView(now.body) } };
}

const NO_CONTENT = refused(
  'no_content',
  'nothing is stored for this link: it was not fetched as a page or a PDF',
);

/**
 * get_link_content: the reader-view text (GET /api/v1/links/{id}/reader; a
 * PDF's extracted text) or the snapshot HTML (GET /api/v1/links/{id}/snapshot),
 * each recording the use that endpoint records. The link is looked at first
 * (no use): HTML of a PDF is not_html, and a link with nothing stored is
 * no_content, neither recording a use.
 */
async function getLinkContent(
  ctx: ToolContext,
  args: { id: string; format: 'text' | 'html' },
): Promise<Outcome> {
  const path = `/links/${encodeURIComponent(args.id)}`;
  const link = outcomeOf(await ctx.call('GET', path));
  if (!link.ok) return link;
  if (args.format === 'html' && link.body.content_kind === 'pdf') {
    return refused('not_html', 'this link is a PDF; use format text');
  }
  if (!link.body.has_snapshot) return NO_CONTENT;
  if (args.format === 'text') {
    const reader = await ctx.call('GET', `${path}/reader`);
    if (reader.status === 404 && reader.json?.error === 'no_snapshot') return NO_CONTENT;
    const read = outcomeOf(reader);
    if (!read.ok) return read;
    return { ok: true, body: { id: args.id, format: 'text', content: read.body.text } };
  }
  const snapshot = await ctx.call('GET', `${path}/snapshot`);
  if (snapshot.status === 404 && snapshot.json?.error === 'no_snapshot') return NO_CONTENT;
  if (snapshot.status !== 200) return outcomeOf(snapshot);
  return { ok: true, body: { id: args.id, format: 'html', content: snapshot.text } };
}

const linkId = z.string().min(1).describe('The id of one of the owner’s links');
const workspace = z
  .string()
  .min(1)
  .describe('A workspace of the owner: its id, or its name (case is ignored)');

/** Every tool the MCP server offers. */
export const TOOLS: Tool[] = [
  {
    name: 'add_link',
    description:
      'Add a link to the library, or move a link already in it to the top. Optionally tag it (a manual tag edit) and file it into a workspace.',
    input: z.object({
      url: z.string().describe('The web address to keep'),
      tags: z.array(z.string()).optional().describe('Tags: single words or hyphenated phrases'),
      workspace: workspace.optional(),
    }),
    run: addLink,
  },
  {
    name: 'search_links',
    description:
      'Search the library by keywords, with the prefix filters tag:, topic:, host:, state:, in: and is:. Returns the matching links with a snippet each.',
    input: z.object({ query: z.string().min(1).describe('The search query'), limit: limit(10) }),
    async run(ctx, args: { query: string; limit?: number }) {
      const q = encodeURIComponent(args.query);
      return outcomeOf(await ctx.call('GET', `/search?q=${q}&limit=${args.limit ?? 10}`));
    },
  },
  {
    name: 'get_link',
    description: 'A link’s metadata: its addresses, title, state, summary, tags, topic and dates.',
    input: z.object({ id: linkId }),
    async run(ctx, args: { id: string }) {
      return outcomeOf(await ctx.call('GET', `/links/${encodeURIComponent(args.id)}`));
    },
  },
  {
    name: 'get_link_content',
    description:
      'The stored content of a link: its reader-view text (a PDF’s text), or its snapshot HTML. Counts as a use of the link.',
    input: z.object({ id: linkId, format: z.enum(['text', 'html']).describe('text or html') }),
    run: getLinkContent,
  },
  {
    name: 'list_workspaces',
    description: 'Every workspace of the owner, with its description and link count.',
    input: z.object({}),
    run: (ctx) => allWorkspaces(ctx),
  },
  {
    name: 'add_to_workspace',
    description: 'Add a link to the bottom of a workspace.',
    input: z.object({ link_id: linkId, workspace }),
    async run(ctx, args: { link_id: string; workspace: string }) {
      const id = await resolveWorkspace(ctx, args.workspace);
      if (id === null) return NO_WORKSPACE;
      return outcomeOf(
        await ctx.call('POST', `/workspaces/${id}/links`, { link_id: args.link_id }),
      );
    },
  },
  {
    name: 'pin_link',
    description: 'Pin a link at the bottom of the pinned section, at the top of the stream.',
    input: z.object({ link_id: linkId }),
    async run(ctx, args: { link_id: string }) {
      return outcomeOf(await ctx.call('POST', `/links/${encodeURIComponent(args.link_id)}/pin`));
    },
  },
  {
    name: 'archive_link',
    description: 'Archive a link: it leaves the stream and waits on the Archive page.',
    input: z.object({ link_id: linkId }),
    async run(ctx, args: { link_id: string }) {
      return outcomeOf(
        await ctx.call('POST', `/links/${encodeURIComponent(args.link_id)}/archive`),
      );
    },
  },
  listRecent,
];

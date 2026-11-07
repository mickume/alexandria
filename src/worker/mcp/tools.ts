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

const linkId = z.string().min(1).describe('The id of one of the owner’s links');
const workspace = z
  .string()
  .min(1)
  .describe('A workspace of the owner: its id, or its name (case is ignored)');

/** A tool whose behaviour is not built yet: it answers an internal error. */
function pending(name: string, description: string, input: z.ZodObject): Tool {
  return {
    name,
    description,
    input,
    run() {
      throw new Error(`${name} is not built yet`);
    },
  };
}

/** Every tool the MCP server offers. */
export const TOOLS: Tool[] = [
  pending(
    'add_link',
    'Add a link to the library, or move a link already in it to the top. Optionally tag it (a manual tag edit) and file it into a workspace.',
    z.object({
      url: z.string().describe('The web address to keep'),
      tags: z.array(z.string()).optional().describe('Tags: single words or hyphenated phrases'),
      workspace: workspace.optional(),
    }),
  ),
  pending(
    'search_links',
    'Search the library by keywords, with the prefix filters tag:, topic:, host:, state:, in: and is:. Returns the matching links with a snippet each.',
    z.object({ query: z.string().min(1).describe('The search query'), limit: limit(10) }),
  ),
  pending(
    'get_link',
    'A link’s metadata: its addresses, title, state, summary, tags, topic and dates.',
    z.object({ id: linkId }),
  ),
  pending(
    'get_link_content',
    'The stored content of a link: its reader-view text (a PDF’s text), or its snapshot HTML. Counts as a use of the link.',
    z.object({ id: linkId, format: z.enum(['text', 'html']).describe('text or html') }),
  ),
  pending('list_workspaces', 'Every workspace of the owner, with its link count.', z.object({})),
  pending(
    'add_to_workspace',
    'Add a link to the bottom of a workspace.',
    z.object({ link_id: linkId, workspace }),
  ),
  pending(
    'pin_link',
    'Pin a link at the bottom of the pinned section, at the top of the stream.',
    z.object({ link_id: linkId }),
  ),
  pending(
    'archive_link',
    'Archive a link: it leaves the stream and waits on the Archive page.',
    z.object({ link_id: linkId }),
  ),
  listRecent,
];

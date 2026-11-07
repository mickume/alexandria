import { Hono, type Context } from 'hono';
import { limitReached, notFound, readJson, validationError } from '../api/errors';
import { decodeCursor, encodeCursor, MAX_LIMIT, parseLimit } from '../api/pagination';
import type { AppEnv } from '../env';
import {
  createWorkspace,
  deleteWorkspace,
  DESCRIPTION_MAX,
  getWorkspace,
  isWorkspaceCursor,
  listWorkspaces,
  NAME_MAX,
  toSummary,
  toWorkspaceView,
  updateWorkspace,
  type SaveOutcome,
} from './store';

/** The user's workspaces, under /api/v1/workspaces. */
export const workspaceRoutes = new Hono<AppEnv>();

/** The validated name and description of a body, or the 400 answer that refuses it. */
function parseFields(
  c: Context<AppEnv>,
  body: Record<string, unknown>,
  { nameRequired }: { nameRequired: boolean },
): { name?: string; description?: string } | Response {
  const fields: { name?: string; description?: string } = {};
  if (nameRequired || 'name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > NAME_MAX) {
      return validationError(c, 'invalid_name', 'name', `a name of 1 to ${NAME_MAX} characters`);
    }
    fields.name = name;
  }
  if ('description' in body) {
    const d = body.description;
    if (d !== null && (typeof d !== 'string' || d.length > DESCRIPTION_MAX || /[\r\n]/.test(d))) {
      return validationError(
        c,
        'invalid_description',
        'description',
        `one paragraph of at most ${DESCRIPTION_MAX} characters`,
      );
    }
    fields.description = typeof d === 'string' ? d.trim() : '';
  }
  return fields;
}

function answer(c: Context<AppEnv>, outcome: SaveOutcome, status: 200 | 201): Response {
  if (outcome.ok) return c.json(toWorkspaceView(outcome.row), status);
  if (outcome.error === 'not_found') return notFound(c);
  if (outcome.error === 'name_taken') {
    return limitReached(c, 'name_taken', 'a workspace with this name already exists');
  }
  return limitReached(c, 'workspace_limit', 'workspace limit reached (200)');
}

workspaceRoutes.post('/', async (c) => {
  const parsed = await readJson(c);
  if (!parsed.ok) return parsed.response;
  const fields = parseFields(c, parsed.body, { nameRequired: true });
  if (fields instanceof Response) return fields;
  const outcome = await createWorkspace(
    c.env.DB,
    c.get('user').id,
    fields.name!,
    fields.description ?? '',
  );
  return answer(c, outcome, 201);
});

workspaceRoutes.get('/', async (c) => {
  const limit = parseLimit(c.req.query('limit'), MAX_LIMIT);
  if (limit === null) {
    return validationError(
      c,
      'invalid_limit',
      'limit',
      `limit must be an integer from 1 to ${MAX_LIMIT}`,
    );
  }
  const raw = c.req.query('cursor');
  let after = null;
  if (raw !== undefined) {
    after = await decodeCursor(c.env, raw);
    if (!isWorkspaceCursor(after)) {
      return validationError(
        c,
        'invalid_cursor',
        'cursor',
        'the cursor was not issued by this API',
      );
    }
  }
  const page = await listWorkspaces(c.env.DB, c.get('user').id, limit, after);
  return c.json({
    items: page.items.map(toSummary),
    next_cursor: page.next ? await encodeCursor(c.env, page.next) : null,
  });
});

workspaceRoutes.get('/:id', async (c) => {
  const row = await getWorkspace(c.env.DB, c.get('user').id, c.req.param('id'));
  return row ? c.json(toWorkspaceView(row)) : notFound(c);
});

workspaceRoutes.patch('/:id', async (c) => {
  const userId = c.get('user').id;
  if (!(await getWorkspace(c.env.DB, userId, c.req.param('id')))) return notFound(c);
  const parsed = await readJson(c);
  if (!parsed.ok) return parsed.response;
  const fields = parseFields(c, parsed.body, { nameRequired: false });
  if (fields instanceof Response) return fields;
  return answer(c, await updateWorkspace(c.env.DB, userId, c.req.param('id'), fields), 200);
});

workspaceRoutes.delete('/:id', async (c) => {
  const deleted = await deleteWorkspace(c.env.DB, c.get('user').id, c.req.param('id'));
  return deleted ? c.body(null, 204) : notFound(c);
});

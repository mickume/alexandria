import { Hono, type Context } from 'hono';
import { limitReached, notFound, readJson, validationError } from '../api/errors';
import { decodeCursor, encodeCursor, MAX_LIMIT, parseLimit } from '../api/pagination';
import type { AppEnv } from '../env';
import { toView, type LinkRow } from '../links/store';
import {
  addMember,
  createWorkspace,
  deleteWorkspace,
  DESCRIPTION_MAX,
  getWorkspace,
  isMemberCursor,
  isWorkspaceCursor,
  listWorkspaces,
  NAME_MAX,
  removeMember,
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

workspaceRoutes.post('/:id/links', async (c) => {
  const userId = c.get('user').id;
  const workspaceId = c.req.param('id');
  if (!(await getWorkspace(c.env.DB, userId, workspaceId))) return notFound(c);
  const parsed = await readJson(c);
  if (!parsed.ok) return parsed.response;
  const { link_id: linkId, position } = parsed.body;
  if (typeof linkId !== 'string' || !linkId) {
    return validationError(
      c,
      'invalid_link_id',
      'link_id',
      'the id of one of your links is required',
    );
  }
  if (position !== undefined && !(Number.isInteger(position) && (position as number) >= 1)) {
    return validationError(
      c,
      'invalid_position',
      'position',
      'position must be an integer of at least 1',
    );
  }
  const outcome = await addMember(
    c.env.DB,
    userId,
    workspaceId,
    linkId,
    position as number | undefined,
  );
  if (outcome.status === 'no_link') return notFound(c);
  return c.json(
    { workspace_id: workspaceId, link_id: linkId, position: outcome.position },
    outcome.status === 'added' ? 201 : 200,
  );
});

workspaceRoutes.delete('/:id/links/:linkId', async (c) => {
  const workspaceId = c.req.param('id');
  if (!(await getWorkspace(c.env.DB, c.get('user').id, workspaceId))) return notFound(c);
  const removed = await removeMember(c.env.DB, workspaceId, c.req.param('linkId'));
  return removed ? c.body(null, 204) : notFound(c);
});

workspaceRoutes.get('/:id/links', async (c) => {
  const userId = c.get('user').id;
  const workspaceId = c.req.param('id');
  if (!(await getWorkspace(c.env.DB, userId, workspaceId))) return notFound(c);
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
  let after = 0;
  if (raw !== undefined) {
    const cursor = await decodeCursor(c.env, raw);
    if (!isMemberCursor(cursor)) {
      return validationError(
        c,
        'invalid_cursor',
        'cursor',
        'the cursor was not issued by this API',
      );
    }
    after = cursor.p;
  }
  const rows = await c.env.DB.prepare(
    `SELECT v.*, wl.position AS member_position FROM workspace_links wl
     JOIN link_views v ON v.id = wl.link_id
     WHERE wl.workspace_id = ? AND v.user_id = ? AND wl.position > ?
     ORDER BY wl.position LIMIT ?`,
  )
    .bind(workspaceId, userId, after, limit + 1)
    .all<LinkRow & { member_position: number }>();
  const items = rows.results.slice(0, limit);
  const last = items.at(-1);
  return c.json({
    items: items.map((row) => ({ ...toView(row), position: row.member_position })),
    next_cursor:
      rows.results.length > limit && last
        ? await encodeCursor(c.env, { p: last.member_position })
        : null,
  });
});

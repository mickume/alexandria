import { Hono } from 'hono';
import { limitReached, notFound, validationError } from '../api/errors';
import { now } from '../clock';
import { decodeCursor, encodeCursor, MAX_LIMIT, parseLimit } from '../api/pagination';
import type { AppEnv } from '../env';
import { getLink, toFullView, toView, unpinStatements, type LinkRow } from '../links/store';

/** Where a page of the archive list ends. */
interface ArchiveCursor {
  a: string;
  i: string;
}

function isArchiveCursor(value: unknown): value is ArchiveCursor {
  const c = value as Record<string, unknown> | null;
  return typeof c === 'object' && c !== null && typeof c.a === 'string' && typeof c.i === 'string';
}

/** The archive, under /api/v1/archive. */
export const archiveRoutes = new Hono<AppEnv>();

archiveRoutes.get('/', async (c) => {
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
  let after: ArchiveCursor | null = null;
  if (raw !== undefined) {
    const cursor = await decodeCursor(c.env, raw);
    if (!isArchiveCursor(cursor)) {
      return validationError(
        c,
        'invalid_cursor',
        'cursor',
        'the cursor was not issued by this API',
      );
    }
    after = cursor;
  }
  const keyset = after ? 'AND (archived_at < ?3 OR (archived_at = ?3 AND id < ?4))' : '';
  const statement = c.env.DB.prepare(
    `SELECT * FROM link_views WHERE user_id = ?1 AND state = 'archived' ${keyset}
     ORDER BY archived_at DESC, id DESC LIMIT ?2`,
  );
  const userId = c.get('user').id;
  const rows = await (
    after ? statement.bind(userId, limit + 1, after.a, after.i) : statement.bind(userId, limit + 1)
  ).all<LinkRow>();
  const items = rows.results.slice(0, limit);
  const last = items.at(-1);
  return c.json({
    items: items.map(toView),
    next_cursor:
      rows.results.length > limit && last
        ? await encodeCursor(c.env, { a: last.archived_at, i: last.id })
        : null,
  });
});

/** Archiving and restoring one link by hand, under /api/v1/links. */
export const archiveLinkRoutes = new Hono<AppEnv>();

archiveLinkRoutes.post('/:id/archive', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const link = await getLink(c.env.DB, userId, id);
  if (!link) return notFound(c);
  if (link.state !== 'archived') {
    const at = now().toISOString();
    // A pinned link leaves the pinned section with the stream; its workspaces stay.
    await c.env.DB.batch([
      ...unpinStatements(c.env.DB, userId, id),
      c.env.DB.prepare(
        "UPDATE links SET state = 'archived', archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND state <> 'archived'",
      ).bind(at, at, id, userId),
    ]);
  }
  return c.json(toFullView((await getLink(c.env.DB, userId, id))!));
});

archiveLinkRoutes.post('/:id/restore', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const at = now().toISOString();
  // Restoring is a boost, not a use: last used is now, the use count stays.
  const restored = await c.env.DB.prepare(
    `UPDATE links SET state = 'active', archived_at = NULL, last_used_at = ?1, updated_at = ?1
     WHERE id = ?2 AND user_id = ?3 AND state = 'archived' RETURNING id`,
  )
    .bind(at, id, userId)
    .first();
  if (!restored) {
    if (!(await getLink(c.env.DB, userId, id))) return notFound(c);
    return limitReached(c, 'not_archived', 'this link is not archived');
  }
  return c.json(toFullView((await getLink(c.env.DB, userId, id))!));
});

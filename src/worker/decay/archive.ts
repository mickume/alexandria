import { Hono } from 'hono';
import { validationError } from '../api/errors';
import { decodeCursor, encodeCursor, MAX_LIMIT, parseLimit } from '../api/pagination';
import type { AppEnv } from '../env';
import { toView, type LinkRow } from '../links/store';

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

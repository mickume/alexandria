import { Hono } from 'hono';
import { limitReached, notFound, validationError } from '../api/errors';
import { now } from '../clock';
import { decodeCursor, encodeCursor, MAX_LIMIT, parseLimit } from '../api/pagination';
import type { AppEnv } from '../env';
import { getLink, toFullView, toView, unpinStatements, type LinkRow } from '../links/store';

/** Where a page of the expired list ends: the last link's expiry time and id. */
interface ExpiredCursor {
  e: string;
  i: string;
}

function isExpiredCursor(value: unknown): value is ExpiredCursor {
  const c = value as Record<string, unknown> | null;
  return (
    typeof c === 'object' &&
    c !== null &&
    Object.keys(c).length === 2 &&
    typeof c.e === 'string' &&
    typeof c.i === 'string'
  );
}

/** The expired links, under /api/v1/expired. */
export const expiredRoutes = new Hono<AppEnv>();

expiredRoutes.get('/', async (c) => {
  const limit = parseLimit(c.req.query('limit'));
  if (limit === null) {
    return validationError(
      c,
      'invalid_limit',
      'limit',
      `limit must be an integer from 1 to ${MAX_LIMIT}`,
    );
  }
  const raw = c.req.query('cursor');
  let after: ExpiredCursor | null = null;
  if (raw !== undefined) {
    const cursor = await decodeCursor(c.env, raw);
    if (!isExpiredCursor(cursor)) {
      return validationError(
        c,
        'invalid_cursor',
        'cursor',
        'the cursor was not issued by this API',
      );
    }
    after = cursor;
  }
  const keyset = after ? 'AND (expired_at < ?3 OR (expired_at = ?3 AND id < ?4))' : '';
  const statement = c.env.DB.prepare(
    `SELECT * FROM link_views WHERE user_id = ?1 AND state = 'expired' ${keyset}
     ORDER BY expired_at DESC, id DESC LIMIT ?2`,
  );
  const userId = c.get('user').id;
  const rows = await (
    after ? statement.bind(userId, limit + 1, after.e, after.i) : statement.bind(userId, limit + 1)
  ).all<LinkRow>();
  const items = rows.results.slice(0, limit);
  const last = items.at(-1);
  return c.json({
    items: items.map(toView),
    next_cursor:
      rows.results.length > limit && last?.expired_at
        ? await encodeCursor(c.env, { e: last.expired_at, i: last.id })
        : null,
  });
});

/** Restoring one expired link, under /api/v1/links. */
export const restoreRoutes = new Hono<AppEnv>();

restoreRoutes.post('/:id/restore', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const at = now().toISOString();
  // Restoring is a boost, not a use: last used is now, the use count stays.
  const restored = await c.env.DB.prepare(
    `UPDATE links SET state = 'active', expired_at = NULL, last_used_at = ?1, updated_at = ?1
     WHERE id = ?2 AND user_id = ?3 AND state = 'expired' RETURNING id`,
  )
    .bind(at, id, userId)
    .first();
  if (!restored) {
    if (!(await getLink(c.env.DB, userId, id))) return notFound(c);
    return limitReached(c, 'not_expired', 'this link is not expired');
  }
  return c.json(toFullView((await getLink(c.env.DB, userId, id))!));
});

/** Why the history of an archived link holds a failed fetch it never made. */
export const ARCHIVE_REFRESH_NOT_QUEUED = 'refresh before archiving could not be queued';

/** Archiving and unarchiving one link, under /api/v1/links. */
export const archiveLinkRoutes = new Hono<AppEnv>();

/**
 * Archives a link that is not archived: it leaves the stream and decay at
 * once, unpinned, in its workspaces still, and a fetch of its page is queued
 * as a refresh, outside the refresh window. A link already archived is
 * answered as it is.
 */
archiveLinkRoutes.post('/:id/archive', async (c) => {
  const db = c.env.DB;
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const link = await getLink(db, userId, id);
  if (!link) return notFound(c);
  if (link.state === 'archived') return c.json(toFullView(link));
  const at = now().toISOString();
  await db.batch([
    ...unpinStatements(db, userId, id),
    db
      .prepare(
        `UPDATE links SET state = 'archived', archived_at = ?1, expired_at = NULL, updated_at = ?1
         WHERE id = ?2 AND user_id = ?3 AND state <> 'archived'`,
      )
      .bind(at, id, userId),
  ]);
  try {
    await c.env.FETCH_QUEUE.send({ user_id: userId, link_id: id, refresh: true });
  } catch (err) {
    console.error('the refresh of an archived link could not be queued', err);
    await db
      .prepare(
        `INSERT INTO link_events (link_id, user_id, kind, at, outcome, http_status, reason)
         VALUES (?1, ?2, 'fetch', ?3, 'failed', NULL, ?4)`,
      )
      .bind(id, userId, at, ARCHIVE_REFRESH_NOT_QUEUED)
      .run();
  }
  const archived = await getLink(db, userId, id);
  return archived ? c.json(toFullView(archived)) : notFound(c);
});

/**
 * Brings an archived link back to the stream as active. Like a restore, it is
 * a boost, not a use: last used is now, the use count stays, and the link is
 * not pinned again.
 */
archiveLinkRoutes.post('/:id/unarchive', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const at = now().toISOString();
  const unarchived = await c.env.DB.prepare(
    `UPDATE links SET state = 'active', archived_at = NULL, last_used_at = ?1, updated_at = ?1
     WHERE id = ?2 AND user_id = ?3 AND state = 'archived' RETURNING id`,
  )
    .bind(at, id, userId)
    .first();
  if (!unarchived) {
    if (!(await getLink(c.env.DB, userId, id))) return notFound(c);
    return limitReached(c, 'not_archived', 'this link is not archived');
  }
  return c.json(toFullView((await getLink(c.env.DB, userId, id))!));
});

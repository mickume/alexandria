import type { LinkRow } from './store';

/**
 * Where a page of the stream ends: in the pinned section at a pin position, or
 * in the rest of the stream at a (last used, id) pair.
 */
export type StreamCursor = { s: 'p'; p: number } | { s: 'u'; l: string; i: string };

/** Whether a decoded cursor payload has the shape of a stream cursor. */
export function isStreamCursor(value: unknown): value is StreamCursor {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  if (c.s === 'p') return Number.isInteger(c.p);
  return c.s === 'u' && typeof c.l === 'string' && typeof c.i === 'string';
}

function cursorAt(row: LinkRow): StreamCursor {
  return row.pin_position !== null
    ? { s: 'p', p: row.pin_position }
    : { s: 'u', l: row.last_used_at, i: row.id };
}

/**
 * One page of the user's stream: the links that are not archived, the pinned
 * ones first by pin position, then the rest by last use, newest first, with
 * the id breaking ties. Returns the page and the cursor of the next one, if any.
 */
export async function listStream(
  db: D1Database,
  userId: string,
  limit: number,
  after: StreamCursor | null,
): Promise<{ items: LinkRow[]; next: StreamCursor | null }> {
  const rows: LinkRow[] = [];
  if (!after || after.s === 'p') {
    const pinned = await db
      .prepare(
        `SELECT * FROM links
         WHERE user_id = ? AND pin_position IS NOT NULL AND state <> 'archived' AND pin_position > ?
         ORDER BY pin_position LIMIT ?`,
      )
      .bind(userId, after?.p ?? 0, limit + 1)
      .all<LinkRow>();
    rows.push(...pinned.results);
  }
  if (rows.length <= limit) {
    const keyset =
      after?.s === 'u' ? 'AND (last_used_at < ?3 OR (last_used_at = ?3 AND id < ?4))' : '';
    const statement = db.prepare(
      `SELECT * FROM links
       WHERE user_id = ?1 AND pin_position IS NULL AND state <> 'archived' ${keyset}
       ORDER BY last_used_at DESC, id DESC LIMIT ?2`,
    );
    const need = limit + 1 - rows.length;
    const rest = await (
      after?.s === 'u'
        ? statement.bind(userId, need, after.l, after.i)
        : statement.bind(userId, need)
    ).all<LinkRow>();
    rows.push(...rest.results);
  }
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, next: rows.length > limit && last ? cursorAt(last) : null };
}

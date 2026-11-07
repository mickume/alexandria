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

/** The most changed links one change-feed answer carries. */
export const CHANGES_LIMIT = 500;

const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** The instant an ISO 8601 timestamp names, or null when it is not one (or names no real date). */
export function parseTimestamp(value: string): Date | null {
  const m = ISO_TIMESTAMP.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  const daysInMonth = new Date(Date.UTC(y!, mo!, 0)).getUTCDate();
  if (mo! < 1 || mo! > 12 || d! < 1 || d! > daysInMonth || h! > 23 || mi! > 59 || (s ?? 0) > 59) {
    return null;
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t);
}

/**
 * The user's links that are not archived and changed at or after `since`,
 * oldest change first. A link changed in the very millisecond of `since` may
 * come again; the website replaces cards in place, so a repeat is harmless,
 * while a missed change would leave a card pending.
 */
export async function listChanged(db: D1Database, userId: string, since: Date): Promise<LinkRow[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM links WHERE user_id = ? AND state <> 'archived' AND updated_at >= ?
       ORDER BY updated_at, id LIMIT ?`,
    )
    .bind(userId, since.toISOString(), CHANGES_LIMIT)
    .all<LinkRow>();
  return rows.results;
}

import { now } from '../clock';
import { epochMs } from '../decay/decay';
import { DEFAULT_START_POINTS } from '../decay/note';
import type { Conditions } from '../search/query';
import type { LinkRow } from './store';

/**
 * Where a page of the stream ends, with `t`, the time of the first page, so
 * that every later page orders the links by their points at that time: in the
 * pinned section at a pin position, or in the rest of the stream at a
 * (points, last used, id) triple.
 */
export type StreamCursor =
  { s: 'p'; t: number; p: number } | { s: 'r'; t: number; n: number; l: string; i: string };

/** Whether a decoded cursor payload has the shape of a stream cursor. */
export function isStreamCursor(value: unknown): value is StreamCursor {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  if (!Number.isInteger(c.t)) return false;
  if (c.s === 'p') return Number.isInteger(c.p);
  return c.s === 'r' && Number.isInteger(c.n) && typeof c.l === 'string' && typeof c.i === 'string';
}

/** A link of the stream with its points at the stream's reference time. */
type RankedRow = LinkRow & { rank_points: number };

function cursorAt(row: RankedRow, t: number): StreamCursor {
  return row.pin_position !== null
    ? { s: 'p', t, p: row.pin_position }
    : { s: 'r', t, n: row.rank_points, l: row.last_used_at, i: row.id };
}

/** The stream's own restriction: every link but the expired ones. */
export const NOT_EXPIRED: Conditions = { sql: ["l.state <> 'expired'"], params: [] };

/**
 * The SQL expression of a link's points (link_views aliased l) at the time
 * bound in its place, counted as pointsAt counts them.
 */
const POINTS_AT = `(COALESCE(l.user_start_points, ${DEFAULT_START_POINTS}) + l.use_count
  - MAX(0, (CAST(? AS INTEGER) - ${epochMs('l.last_used_at')}) / 86400000))`;

/**
 * One page of the user's stream: the links that satisfy `where` (by default,
 * those not expired), the pinned ones first by pin position, then the rest by
 * points descending, then last use descending, with the id breaking ties.
 * Points are computed at the time of the first page, which the cursor
 * carries, so a link that does not change is listed exactly once however
 * long the paging takes. Returns the page and the cursor of the next one, if
 * any.
 */
export async function listStream(
  db: D1Database,
  userId: string,
  limit: number,
  after: StreamCursor | null,
  where: Conditions = NOT_EXPIRED,
): Promise<{ items: LinkRow[]; next: StreamCursor | null }> {
  const t = after?.t ?? now().getTime();
  const rows: RankedRow[] = [];
  const conditions = where.sql.map((c) => `AND ${c}`).join(' ');
  if (!after || after.s === 'p') {
    const pinned = await db
      .prepare(
        `SELECT l.*, ${POINTS_AT} AS rank_points FROM link_views l
         WHERE l.user_id = ? AND l.pin_position IS NOT NULL AND l.pin_position > ? ${conditions}
         ORDER BY l.pin_position LIMIT ?`,
      )
      .bind(t, userId, after?.s === 'p' ? after.p : 0, ...where.params, limit + 1)
      .all<RankedRow>();
    rows.push(...pinned.results);
  }
  if (rows.length <= limit) {
    const keyset =
      after?.s === 'r'
        ? `WHERE rank_points < ? OR (rank_points = ? AND (last_used_at < ?
             OR (last_used_at = ? AND id < ?)))`
        : '';
    const keys = after?.s === 'r' ? [after.n, after.n, after.l, after.l, after.i] : [];
    const rest = await db
      .prepare(
        `SELECT * FROM (
           SELECT l.*, ${POINTS_AT} AS rank_points FROM link_views l
           WHERE l.user_id = ? AND l.pin_position IS NULL ${conditions}
         ) ${keyset}
         ORDER BY rank_points DESC, last_used_at DESC, id DESC LIMIT ?`,
      )
      .bind(t, userId, ...where.params, ...keys, limit + 1 - rows.length)
      .all<RankedRow>();
    rows.push(...rest.results);
  }
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, next: rows.length > limit && last ? cursorAt(last, t) : null };
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
 * The user's links that are not expired and changed at or after `since`,
 * oldest change first. A link changed in the very millisecond of `since` may
 * come again; the website replaces cards in place, so a repeat is harmless,
 * while a missed change would leave a card pending.
 */
export async function listChanged(db: D1Database, userId: string, since: Date): Promise<LinkRow[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM link_views WHERE user_id = ? AND state <> 'expired' AND updated_at >= ?
       ORDER BY updated_at, id LIMIT ?`,
    )
    .bind(userId, since.toISOString(), CHANGES_LIMIT)
    .all<LinkRow>();
  return rows.results;
}

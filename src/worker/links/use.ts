import { now } from '../clock';
import { epochMs, isoFromMs } from '../decay/decay';

/**
 * The SQL expression of a link's decay start after a use at the time bound as
 * ?1 (?4 in milliseconds), for the user bound as ?3. A use of an expired link
 * starts its decay afresh, as a restore does. Otherwise the first use of a UTC
 * day wins back the user's use_boost percent of the time decayed, and a later
 * use that day wins back nothing, so the uses of one visit do not compound.
 * It reads the row as it was before the use, so of concurrent uses on a new
 * day only the first moves it.
 */
const DECAY_FROM_AFTER_USE = `CASE
    WHEN state = 'expired' THEN ?1
    WHEN substr(last_used_at, 1, 10) < substr(?1, 1, 10) THEN ${isoFromMs(
      `${epochMs('decay_from')} + MAX(0, CAST(?4 AS INTEGER) - ${epochMs('decay_from')})
         * (SELECT use_boost FROM users WHERE id = ?3) / 100`,
    )}
    ELSE decay_from
  END`;

/** One event in a link's history: a use, or a fetch attempt with its outcome. */
export type LinkEvent =
  | { kind: 'use'; at: string }
  | {
      kind: 'fetch';
      at: string;
      outcome: 'ok' | 'failed';
      http_status: number | null;
      reason: string | null;
    };

/**
 * Records one use of a user's link: increments its use count, sets its last
 * use to now, moves its decay start forward, makes an expired link active
 * again and stores a use event, in one transaction. Every way of opening
 * a link (the open endpoint, and later reads, snapshots and MCP) goes through
 * here. Returns the link's normalised URL, or null when the user has no such link.
 */
export async function recordUse(
  db: D1Database,
  userId: string,
  linkId: string,
): Promise<string | null> {
  const t = now();
  const at = t.toISOString();
  const [updated] = await db.batch<{ url: string }>([
    db
      .prepare(
        `UPDATE links SET use_count = use_count + 1, last_used_at = ?1, updated_at = ?1,
           decay_from = ${DECAY_FROM_AFTER_USE},
           state = CASE WHEN state = 'expired' THEN 'active' ELSE state END, expired_at = NULL
         WHERE id = ?2 AND user_id = ?3 RETURNING url`,
      )
      .bind(at, linkId, userId, t.getTime()),
    db
      .prepare(
        `INSERT INTO link_uses (link_id, user_id, at)
         SELECT id, user_id, ?1 FROM links WHERE id = ?2 AND user_id = ?3`,
      )
      .bind(at, linkId, userId),
  ]);
  return updated?.results[0]?.url ?? null;
}

/** Where a page of a link's history ends: the last event's time, source and id. */
export interface HistoryCursor {
  at: string;
  /** 0 for a use, 1 for a fetch event: the two tables number their rows apart. */
  s: number;
  id: number;
}

/** Whether a decoded cursor payload has the shape of a history cursor. */
export function isHistoryCursor(value: unknown): value is HistoryCursor {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return typeof c.at === 'string' && (c.s === 0 || c.s === 1) && Number.isInteger(c.id);
}

interface HistoryRow {
  src: number;
  id: number;
  kind: string;
  at: string;
  outcome: string | null;
  http_status: number | null;
  reason: string | null;
}

function toEvent(row: HistoryRow): LinkEvent {
  if (row.src === 0) return { kind: 'use', at: row.at };
  return {
    kind: 'fetch',
    at: row.at,
    outcome: row.outcome === 'ok' ? 'ok' : 'failed',
    http_status: row.http_status,
    reason: row.reason,
  };
}

/** One page of a link's uses and fetch events, newest first, and the cursor of the next page. */
export async function listHistory(
  db: D1Database,
  linkId: string,
  limit: number,
  after: HistoryCursor | null,
): Promise<{ items: LinkEvent[]; next: HistoryCursor | null }> {
  const keyset = after ? 'WHERE at < ?3 OR (at = ?3 AND (src < ?4 OR (src = ?4 AND id < ?5)))' : '';
  const statement = db.prepare(
    `SELECT * FROM (
       SELECT 0 AS src, id, 'use' AS kind, at, NULL AS outcome, NULL AS http_status, NULL AS reason
         FROM link_uses WHERE link_id = ?1
       UNION ALL
       SELECT 1 AS src, id, kind, at, outcome, http_status, reason
         FROM link_events WHERE link_id = ?1
     ) ${keyset}
     ORDER BY at DESC, src DESC, id DESC LIMIT ?2`,
  );
  const rows = await (
    after
      ? statement.bind(linkId, limit + 1, after.at, after.s, after.id)
      : statement.bind(linkId, limit + 1)
  ).all<HistoryRow>();
  const page = rows.results.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toEvent),
    next: rows.results.length > limit && last ? { at: last.at, s: last.src, id: last.id } : null,
  };
}

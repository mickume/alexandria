import { now } from '../clock';

/** One event in a link's history. */
export interface LinkEvent {
  kind: 'use';
  at: string;
}

/**
 * Records one use of a user's link: increments its use count, sets its last
 * use to now and stores a use event, in one transaction. Every way of opening
 * a link (the open endpoint, and later reads, snapshots and MCP) goes through
 * here. Returns the link's normalised URL, or null when the user has no such link.
 */
export async function recordUse(
  db: D1Database,
  userId: string,
  linkId: string,
): Promise<string | null> {
  const at = now().toISOString();
  const [updated] = await db.batch<{ url: string }>([
    db
      .prepare(
        `UPDATE links SET use_count = use_count + 1, last_used_at = ?1
         WHERE id = ?2 AND user_id = ?3 RETURNING url`,
      )
      .bind(at, linkId, userId),
    db
      .prepare(
        `INSERT INTO link_uses (link_id, user_id, at)
         SELECT id, user_id, ?1 FROM links WHERE id = ?2 AND user_id = ?3`,
      )
      .bind(at, linkId, userId),
  ]);
  return updated?.results[0]?.url ?? null;
}

/** Where a page of a link's history ends. */
export interface HistoryCursor {
  at: string;
  id: number;
}

/** Whether a decoded cursor payload has the shape of a history cursor. */
export function isHistoryCursor(value: unknown): value is HistoryCursor {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return typeof c.at === 'string' && Number.isInteger(c.id);
}

/** One page of a link's events, newest first, and the cursor of the next page, if any. */
export async function listHistory(
  db: D1Database,
  linkId: string,
  limit: number,
  after: HistoryCursor | null,
): Promise<{ items: LinkEvent[]; next: HistoryCursor | null }> {
  const keyset = after ? 'AND (at < ?3 OR (at = ?3 AND id < ?4))' : '';
  const statement = db.prepare(
    `SELECT id, at FROM link_uses WHERE link_id = ?1 ${keyset}
     ORDER BY at DESC, id DESC LIMIT ?2`,
  );
  const rows = await (
    after
      ? statement.bind(linkId, limit + 1, after.at, after.id)
      : statement.bind(linkId, limit + 1)
  ).all<{ id: number; at: string }>();
  const page = rows.results.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ kind: 'use', at: r.at })),
    next: rows.results.length > limit && last ? { at: last.at, id: last.id } : null,
  };
}

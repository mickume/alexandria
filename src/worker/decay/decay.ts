import { now } from '../clock';
import type { Env } from '../env';
import { getThresholds } from './routes';

const DAY_MS = 86_400_000;

/** The SQL condition that a link `l` is sticky: at least 5 uses on at least 5 distinct UTC days. */
export const STICKY = `(
  (SELECT COUNT(*) FROM link_uses u WHERE u.link_id = l.id) >= 5
  AND (SELECT COUNT(DISTINCT substr(u.at, 1, 10)) FROM link_uses u WHERE u.link_id = l.id) >= 5
)`;

/** The SQL condition that a link `l` is in at least one workspace. */
const MEMBER = 'EXISTS (SELECT 1 FROM workspace_links wl WHERE wl.link_id = l.id)';

/** The time `days` before `t`, as stored. */
function daysBefore(t: Date, days: number): string {
  return new Date(t.getTime() - days * DAY_MS).toISOString();
}

/**
 * The statements of one user's decay evaluation at time `t`, each carrying its
 * own conditions so that a link boosted meanwhile is left as the boost left
 * it: sticky dormant links become active again; active links unused for
 * dormant_days that are not sticky become dormant; links unused for
 * archive_days that are neither sticky, pinned nor in a workspace are
 * archived.
 */
export async function decayStatements(
  db: D1Database,
  userId: string,
  t: Date,
): Promise<D1PreparedStatement[]> {
  const { dormant_days, archive_days } = await getThresholds(db, userId);
  const at = t.toISOString();
  return [
    db
      .prepare(
        `UPDATE links AS l SET state = 'active', updated_at = ?2 WHERE l.user_id = ?1 AND l.state = 'dormant' AND ${STICKY}`,
      )
      .bind(userId, at),
    db
      .prepare(
        `UPDATE links AS l SET state = 'dormant', updated_at = ?2
         WHERE l.user_id = ?1 AND l.state = 'active' AND l.last_used_at <= ?3 AND NOT ${STICKY}`,
      )
      .bind(userId, at, daysBefore(t, dormant_days)),
    db
      .prepare(
        `UPDATE links AS l SET state = 'archived', archived_at = ?2, updated_at = ?2
         WHERE l.user_id = ?1 AND l.state <> 'archived' AND l.last_used_at <= ?3
           AND l.pin_position IS NULL AND NOT ${MEMBER} AND NOT ${STICKY}`,
      )
      .bind(userId, at, daysBefore(t, archive_days)),
  ];
}

/** Evaluates decay for one user at the current time, in one transaction. */
export async function evaluateDecay(env: Env, userId: string): Promise<void> {
  const t = now();
  await env.DB.batch(await decayStatements(env.DB, userId, t));
}

import { now } from '../clock';
import type { Env } from '../env';
import { deleteLinkObjects } from '../fetcher/snapshots';
import { getThresholds } from './routes';

const DAY_MS = 86_400_000;

/** Test seams of the evaluation, as the clock is one. */
export const decayHooks: { afterSelect?: (userId: string) => Promise<void> } = {};

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

/**
 * The statements that remove the user's links archived at least remove_days
 * before `t`: everything DELETE /api/v1/links/{id} deletes, workspace
 * positions closed up, the links themselves last (returning their ids, so
 * their stored objects can go too). The condition is in every statement, so a
 * link restored meanwhile is kept.
 */
function removalStatements(db: D1Database, userId: string, cutoff: string): D1PreparedStatement[] {
  const removed = `SELECT id FROM links WHERE user_id = ?1 AND state = 'archived' AND archived_at <= ?2`;
  return [
    db.prepare(`DELETE FROM link_uses WHERE link_id IN (${removed})`).bind(userId, cutoff),
    db.prepare(`DELETE FROM link_texts WHERE link_id IN (${removed})`).bind(userId, cutoff),
    db.prepare(`DELETE FROM link_passages WHERE link_id IN (${removed})`).bind(userId, cutoff),
    db.prepare(`DELETE FROM link_events WHERE link_id IN (${removed})`).bind(userId, cutoff),
    db.prepare(`DELETE FROM link_tags WHERE link_id IN (${removed})`).bind(userId, cutoff),
    db
      .prepare(
        `UPDATE workspace_links SET position = position - (
           SELECT COUNT(*) FROM workspace_links r
           WHERE r.workspace_id = workspace_links.workspace_id AND r.position < workspace_links.position
             AND r.link_id IN (${removed}))
         WHERE workspace_id IN (SELECT workspace_id FROM workspace_links WHERE link_id IN (${removed}))`,
      )
      .bind(userId, cutoff),
    db.prepare(`DELETE FROM workspace_links WHERE link_id IN (${removed})`).bind(userId, cutoff),
    db
      .prepare(
        `DELETE FROM links WHERE user_id = ?1 AND state = 'archived' AND archived_at <= ?2 RETURNING id`,
      )
      .bind(userId, cutoff),
  ];
}

/**
 * Evaluates decay for one user at the current time: dormancy, archiving and
 * removal, and the user's last_decay_at, all in one transaction, so that an
 * evaluation that fails changes nothing. The stored objects of the removed
 * links are deleted after the transaction.
 */
export async function evaluateDecay(env: Env, userId: string): Promise<void> {
  const t = now();
  const { remove_days } = await getThresholds(env.DB, userId);
  const statements = [
    ...(await decayStatements(env.DB, userId, t)),
    ...removalStatements(env.DB, userId, daysBefore(t, remove_days)),
    env.DB.prepare('UPDATE users SET last_decay_at = ? WHERE id = ?').bind(t.toISOString(), userId),
  ];
  await decayHooks.afterSelect?.(userId);
  const results = await env.DB.batch<{ id: string }>(statements);
  const removed = results.at(-2)?.results ?? [];
  for (const { id } of removed) {
    await deleteLinkObjects(env, userId, id).catch((err) =>
      console.error('removing stored objects failed', err),
    );
  }
}

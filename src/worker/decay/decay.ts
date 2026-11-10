import { now } from '../clock';
import type { Env } from '../env';
import { readerKey, snapshotKey } from '../fetcher/snapshots';
import { countStatement } from '../stats/daily';
import { DAY_MS, IN_WORKSPACE, pointsSql } from './points';
import { getThresholds } from './routes';

/** The most keys one R2 delete takes. */
const R2_DELETE_KEYS = 1000;

/** Test seams of the evaluation, as the clock is one. */
export const decayHooks: { afterSelect?: (userId: string) => Promise<void> } = {};

/** The time `days` before `t`, as stored. */
function daysBefore(t: Date, days: number): string {
  return new Date(t.getTime() - days * DAY_MS).toISOString();
}

/**
 * The statement that expires, at time `t`, every link of the user whose
 * points are 0 or below, that is active, pending or unreachable, not pinned
 * and in no workspace. Points reach 0 once the whole days since the decay
 * start reach the start points plus the use count. The statement carries its own
 * conditions, so a link used or re-pasted meanwhile is left as the use left it.
 */
export function expiryStatement(db: D1Database, userId: string, t: Date): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE links AS l SET state = 'expired', expired_at = ?2, updated_at = ?2
       WHERE l.user_id = ?1 AND l.state IN ('active', 'pending', 'unreachable')
         AND l.pin_position IS NULL AND NOT ${IN_WORKSPACE}
         AND ${pointsSql('l', '(SELECT start_points FROM users WHERE id = ?1)', '?3')} <= 0`,
    )
    .bind(userId, t.toISOString(), t.getTime());
}

/**
 * The statements that remove the user's links expired at least remove_days
 * before `t` that are neither pinned nor in a workspace: everything
 * DELETE /api/v1/links/{id} deletes, the links themselves last (returning
 * their ids, so their stored objects can go too). The condition is in every
 * statement, so a link restored, pinned or added to a workspace meanwhile is
 * kept.
 */
function removalStatements(
  db: D1Database,
  userId: string,
  cutoff: string,
  t: Date,
): D1PreparedStatement[] {
  // The cutoff is the parameter `cut`: ?2 in the removal, ?3 in its count.
  const removableAt = (cut: string) => `l.user_id = ?1 AND l.state = 'expired'
    AND l.expired_at <= ${cut} AND l.pin_position IS NULL AND NOT ${IN_WORKSPACE}`;
  const removable = removableAt('?2');
  const removed = `SELECT l.id FROM links l WHERE ${removable}`;
  return [
    // Counted first, on the removal's own condition, while the links are still there.
    countStatement(db, {
      userId,
      at: t,
      counter: 'removed',
      amount: `(SELECT COUNT(*) FROM links l WHERE ${removableAt('?3')})`,
      binds: [cutoff],
    }),
    db.prepare(`DELETE FROM link_uses WHERE link_id IN (${removed})`).bind(userId, cutoff),
    db.prepare(`DELETE FROM link_texts WHERE link_id IN (${removed})`).bind(userId, cutoff),
    db.prepare(`DELETE FROM link_passages WHERE link_id IN (${removed})`).bind(userId, cutoff),
    db.prepare(`DELETE FROM link_events WHERE link_id IN (${removed})`).bind(userId, cutoff),
    db.prepare(`DELETE FROM link_tags WHERE link_id IN (${removed})`).bind(userId, cutoff),
    db.prepare(`DELETE FROM links AS l WHERE ${removable} RETURNING id`).bind(userId, cutoff),
  ];
}

/**
 * Evaluates decay for one user at the current time: expiry, removal and the
 * user's last_decay_at, all in one transaction, so that an evaluation that
 * fails changes nothing. The stored objects of the removed links are deleted
 * after the transaction.
 */
export async function evaluateDecay(env: Env, userId: string): Promise<void> {
  const t = now();
  const { remove_days } = await getThresholds(env.DB, userId);
  const statements = [
    expiryStatement(env.DB, userId, t),
    ...removalStatements(env.DB, userId, daysBefore(t, remove_days), t),
    env.DB.prepare('UPDATE users SET last_decay_at = ? WHERE id = ?').bind(t.toISOString(), userId),
  ];
  await decayHooks.afterSelect?.(userId);
  const results = await env.DB.batch<{ id: string }>(statements);
  const removed = results.at(-2)?.results ?? [];
  // A link stores its objects under two known keys, so the objects of many
  // links go in a few calls: a removal of thousands stays within one run.
  const keys = removed.flatMap(({ id }) => [snapshotKey(userId, id), readerKey(userId, id)]);
  for (let i = 0; i < keys.length; i += R2_DELETE_KEYS) {
    await env.SNAPSHOTS.delete(keys.slice(i, i + R2_DELETE_KEYS)).catch((err) =>
      console.error('removing stored objects failed', err),
    );
  }
}

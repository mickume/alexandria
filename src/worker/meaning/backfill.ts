/**
 * The every-minute work of the index: deleting the vectors of passages that
 * are gone, and queueing the links that have no up-to-date passages (the
 * backfill), a few at a time and each user apart from the others.
 */
import { now } from '../clock';
import type { Env } from '../env';
import { MUTATION_BATCH, meaningBackend } from './backend';
import { IS_STALE, sendIndexMessages } from './indexing';

/** The most links one user has queued for indexing by the backfill in a minute. */
export const BACKFILL_PER_MINUTE = 60;
/** How long a queued link is left alone before the backfill queues it again, in milliseconds. */
const REQUEUE_AFTER_MS = 10 * 60_000;
/** The most calls to the index one run makes to delete vectors, so that a run stays short. */
const DRAIN_CALLS_PER_RUN = 20;

/**
 * Deletes the vectors queued in vector_deletions from the index, a thousand to
 * a call, and removes each id from the queue once its call has succeeded. A
 * failing call throws with the ids still queued.
 */
export async function drainVectorDeletions(env: Env): Promise<void> {
  for (let call = 0; call < DRAIN_CALLS_PER_RUN; call++) {
    const queued = await env.DB.prepare('SELECT vector_id FROM vector_deletions LIMIT ?')
      .bind(MUTATION_BATCH)
      .all<{ vector_id: string }>();
    const ids = queued.results.map((r) => r.vector_id);
    if (ids.length === 0) return;
    await meaningBackend(env).deleteByIds(ids);
    await env.DB.prepare(
      'DELETE FROM vector_deletions WHERE vector_id IN (SELECT value FROM json_each(?))',
    )
      .bind(JSON.stringify(ids))
      .run();
  }
}

/**
 * Queues, for every account not marked for deletion, at most 60 of its stale
 * links that were not queued in the last 10 minutes, the most recently used
 * first. A user whose queueing fails does not hold back the others.
 */
export async function backfillIndex(env: Env): Promise<void> {
  const users = await env.DB.prepare(
    'SELECT id FROM users WHERE deletion_requested_at IS NULL',
  ).all<{ id: string }>();
  const cutoff = new Date(now().getTime() - REQUEUE_AFTER_MS).toISOString();
  for (const { id: userId } of users.results) {
    try {
      const stale = await env.DB.prepare(
        `SELECT l.id FROM links l LEFT JOIN link_index_state s ON s.link_id = l.id
         WHERE l.user_id = ?1 AND (s.queued_at IS NULL OR s.queued_at <= ?2) AND ${IS_STALE}
         ORDER BY l.last_used_at DESC, l.id LIMIT ?3`,
      )
        .bind(userId, cutoff, BACKFILL_PER_MINUTE)
        .all<{ id: string }>();
      await sendIndexMessages(
        env,
        userId,
        stale.results.map((r) => r.id),
      );
    } catch (err) {
      console.error('the index backfill failed for a user', err);
    }
  }
}

/** One minute of the index's upkeep: the deletions first, then the backfill, whatever the first does. */
export async function maintainIndex(env: Env): Promise<void> {
  try {
    await drainVectorDeletions(env);
  } catch (err) {
    console.error('deleting vectors from the index failed', err);
  }
  await backfillIndex(env);
}

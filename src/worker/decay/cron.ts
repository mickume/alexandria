import { now } from '../clock';
import type { Env } from '../env';
import { recordDaySizes } from '../stats/daily';
import { evaluateDecay } from './decay';
import { enqueueDueChecks } from './liveness';

/** A user is evaluated again once this long has passed since their last completed evaluation. */
export const DECAY_INTERVAL_MS = 20 * 3_600_000;

/**
 * The hourly scheduled run: evaluates decay, removal included, for every user
 * whose last completed evaluation started 20 hours or more ago (or never), one
 * user at a time, so that one user's failure leaves their links as they were
 * and does not stop the others; they are evaluated again at the next run.
 * Then it enqueues the liveness checks that are due. A run in the hour after
 * midnight UTC first records every owner's size for the day that ended.
 */
export async function runScheduled(env: Env): Promise<void> {
  const t = now();
  // Before decay changes anything, so the size is the one the day ended with.
  await recordDaySizes(env.DB, t).catch((err) =>
    console.error('recording the end-of-day sizes failed', err),
  );
  const due = await env.DB.prepare(
    `SELECT id FROM users
     WHERE deletion_requested_at IS NULL AND (last_decay_at IS NULL OR last_decay_at <= ?)`,
  )
    .bind(new Date(t.getTime() - DECAY_INTERVAL_MS).toISOString())
    .all<{ id: string }>();
  for (const { id } of due.results) {
    try {
      await evaluateDecay(env, id);
    } catch (err) {
      console.error('decay evaluation failed for a user', err);
    }
  }
  await enqueueDueChecks(env);
}

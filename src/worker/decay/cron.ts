import { now } from '../clock';
import type { Env } from '../env';
import { evaluateDecay } from './decay';
import { enqueueDueChecks } from './liveness';

/** A user is evaluated again once this long has passed since their last completed evaluation. */
export const DECAY_INTERVAL_MS = 20 * 3_600_000;

/**
 * The hourly scheduled run: evaluates decay, removal included, for every user
 * whose last completed evaluation started 20 hours or more ago (or never), one
 * user at a time, so that one user's failure leaves their links as they were
 * and does not stop the others; they are evaluated again at the next run.
 * Then it enqueues the liveness checks that are due.
 */
export async function runScheduled(env: Env): Promise<void> {
  const t = now();
  const due = await env.DB.prepare(
    'SELECT id FROM users WHERE last_decay_at IS NULL OR last_decay_at <= ?',
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

/** The 5-minute sweep: deletions whose queue message was lost still finish. */
import { now } from '../clock';
import type { Env } from '../env';
import { continueDeletion } from './deletion';

/** The cron trigger of the sweep (wrangler.jsonc). */
export const SWEEP_CRON = '*/5 * * * *';

/** How long a marked account is left to its queued job before the sweep runs it. */
const GRACE_MS = 5 * 60_000;

/**
 * Runs the deletion job of every account marked more than 5 minutes ago, one
 * account at a time; each run queues the next until nothing remains.
 */
export async function sweepDeletions(env: Env): Promise<void> {
  const due = await env.DB.prepare(
    'SELECT id FROM users WHERE deletion_requested_at IS NOT NULL AND deletion_requested_at <= ?',
  )
    .bind(new Date(now().getTime() - GRACE_MS).toISOString())
    .all<{ id: string }>();
  for (const { id } of due.results) {
    try {
      await continueDeletion(env, id);
    } catch (err) {
      console.error('the deletion sweep failed for an account', err);
    }
  }
}

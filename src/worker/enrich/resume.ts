import { now } from '../clock';
import type { Env } from '../env';
import { aiState } from './keys';
import { sendThrottled } from './throttle';

/** The enrichment states of links that wait for a usable AI key. */
export const WAITING_STATES = ['no_key', 'waiting_for_key'];

/** The most waiting links queued again a minute, across every owner. */
export const RESUME_PER_MINUTE = 20;

/**
 * The every-minute resumption of enrichment: once the deployment has an AI
 * key its provider has not refused (a new key, or a refusal an hour old), the
 * links that waited for one ('no_key', 'waiting_for_key') are queued again,
 * 20 a minute across the owners whose accounts are not being deleted, the
 * longest waiting first, each through its owner's throttle. Returns how many
 * were queued.
 */
export async function resumeEnrichment(env: Env): Promise<number> {
  if ((await aiState(env)).status !== 'verified') return 0;
  const users = await env.DB.prepare(
    'SELECT id FROM users WHERE deletion_requested_at IS NULL ORDER BY id',
  ).all<{ id: string }>();
  const states = WAITING_STATES.map((state) => `'${state}'`).join(', ');
  let queued = 0;
  for (const { id: userId } of users.results) {
    if (queued >= RESUME_PER_MINUTE) break;
    const rows = await env.DB.prepare(
      `UPDATE links SET enrichment_status = 'queued', enrichment_reason = NULL, updated_at = ?1
       WHERE id IN (
         SELECT id FROM links WHERE user_id = ?2 AND enrichment_status IN (${states})
         ORDER BY updated_at, id LIMIT ?3)
       RETURNING id`,
    )
      .bind(now().toISOString(), userId, RESUME_PER_MINUTE - queued)
      .all<{ id: string }>();
    const ids = rows.results.map((r) => r.id);
    if (ids.length === 0) continue;
    await sendThrottled(env, userId, ids);
    queued += ids.length;
  }
  return queued;
}

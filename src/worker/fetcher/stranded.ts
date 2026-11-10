import { now } from '../clock';
import type { Env, FetchMessage } from '../env';
import { MAX_ATTEMPTS } from './queue';

/**
 * How long a link may wait, untouched, before the work it waits for is taken
 * as lost: longer than the longest wait a first fetch has between attempts
 * (2 hours).
 */
export const STRANDED_AFTER_MS = 3 * 3_600_000;
/** The most links one run sends to the fetch worker again. */
export const RECOVERY_BATCH = 500;

/** Why a link whose fetch never came back is unreachable. */
export const FETCH_LOST_REASON = 'the fetch did not complete';
/** Why a link whose enrichment never came back failed. */
export const ENRICHMENT_LOST_REASON = 'the enrichment did not complete';

/**
 * The SQL condition that the pending link `links` has nothing on its way that
 * will fetch it: untouched since ?2, of an account not being deleted, and not
 * an imported link still waiting for the dispatcher or sent by it since ?2.
 */
const STRANDED = `links.state = 'pending' AND links.updated_at <= ?2
  AND links.user_id IN (SELECT id FROM users WHERE deletion_requested_at IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM import_links il WHERE il.link_id = links.id
      AND ((il.dispatched_at IS NULL AND il.skipped = 0) OR il.dispatched_at > ?2))`;

/**
 * Recovers the links whose queue message was lost: a send that failed after
 * the link was stored, or a message dropped after its last retry. A link left
 * pending and untouched for STRANDED_AFTER_MS counts one more attempt and is
 * sent to the fetch worker again, or, at its last attempt, becomes unreachable
 * with a reason, so that it can be refreshed by hand. A link left queued for
 * enrichment that long, with none of its user's throttled slots still ahead,
 * is marked failed, which 'enrich all' picks up. Returns how many links were
 * sent again.
 */
export async function recoverStranded(env: Env): Promise<number> {
  const t = now().getTime();
  const at = new Date(t).toISOString();
  const before = new Date(t - STRANDED_AFTER_MS).toISOString();
  const [, resent] = await env.DB.batch<{ id: string; user_id: string }>([
    env.DB.prepare(
      `UPDATE links SET state = 'unreachable', state_reason = ?3, fetch_attempts = ${MAX_ATTEMPTS},
         updated_at = ?1
       WHERE ${STRANDED} AND fetch_attempts >= ${MAX_ATTEMPTS - 1}`,
    ).bind(at, before, FETCH_LOST_REASON),
    env.DB.prepare(
      `UPDATE links SET fetch_attempts = fetch_attempts + 1, updated_at = ?1
       WHERE id IN (SELECT id FROM links WHERE ${STRANDED} LIMIT ${RECOVERY_BATCH})
       RETURNING id, user_id`,
    ).bind(at, before),
    env.DB.prepare(
      `UPDATE links SET enrichment_status = 'failed', enrichment_reason = ?3, updated_at = ?1
       WHERE enrichment_status = 'queued' AND updated_at <= ?2
         AND user_id IN (
           SELECT id FROM users
           WHERE deletion_requested_at IS NULL AND COALESCE(throttle_next_at, 0) <= ?4)`,
    ).bind(at, before, ENRICHMENT_LOST_REASON, t - STRANDED_AFTER_MS),
  ]);
  const messages = (resent?.results ?? []).map((r) => ({
    body: { user_id: r.user_id, link_id: r.id } as FetchMessage,
  }));
  for (let i = 0; i < messages.length; i += 100) {
    await env.FETCH_QUEUE.sendBatch(messages.slice(i, i + 100));
  }
  return messages.length;
}

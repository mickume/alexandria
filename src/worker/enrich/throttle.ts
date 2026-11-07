import { now } from '../clock';
import type { EnrichMessage, Env } from '../env';

/** The time between two of a user's background jobs: at most 20 a minute. */
export const THROTTLE_SPACING_MS = 3_000;
/**
 * Background jobs' actual starts are kept this far apart: the spacing and a
 * margin for the moment between a start and the provider call it leads to.
 */
const START_SPACING_MS = THROTTLE_SPACING_MS + 250;

/** The longest delay a queue message can be sent with. */
export const MAX_DELAY_SECONDS = 12 * 60 * 60;

/**
 * Reserves `count` background slots for a user: the first at the user's next
 * free slot, or now when that has passed, and each later one 3 seconds after
 * the one before. One statement moves the user's next free slot, so
 * concurrent calls never share a slot. Returns the slots, in milliseconds
 * since the epoch.
 */
export async function scheduleThrottled(
  db: D1Database,
  userId: string,
  count: number,
): Promise<number[]> {
  if (count <= 0) return [];
  const row = await db
    .prepare(
      `UPDATE users SET throttle_next_at = MAX(COALESCE(throttle_next_at, 0), ?1) + ?2 * ?3
       WHERE id = ?4 RETURNING throttle_next_at`,
    )
    .bind(now().getTime(), count, THROTTLE_SPACING_MS, userId)
    .first<{ throttle_next_at: number }>();
  if (!row) throw new Error('no such user');
  const first = row.throttle_next_at - count * THROTTLE_SPACING_MS;
  return Array.from({ length: count }, (_, i) => first + i * THROTTLE_SPACING_MS);
}

/** The delay to send a message for `slot` with: the time left, at most 12 hours. */
export function delayUntil(slot: number): number {
  return Math.min(MAX_DELAY_SECONDS, Math.max(0, Math.round((slot - now().getTime()) / 1000)));
}

/**
 * Schedules enrichment of `linkIds` through the user's throttle: each message
 * carries its slot and is sent with the delay to it, at most 12 hours; one that
 * arrives early is sent again for the time left (see deferIfEarly).
 */
export async function sendThrottled(env: Env, userId: string, linkIds: string[]): Promise<void> {
  const slots = await scheduleThrottled(env.DB, userId, linkIds.length);
  const messages = linkIds.map((linkId, i) => {
    const slot = slots[i]!;
    const body: EnrichMessage = { user_id: userId, link_id: linkId, attempt: 1, slot };
    return { body, delaySeconds: delayUntil(slot) };
  });
  for (let i = 0; i < messages.length; i += 100) {
    await env.ENRICH_QUEUE.sendBatch(messages.slice(i, i + 100));
  }
}

/**
 * Whether a throttled message must wait: it arrived before its slot, or less
 * than 3 seconds (and a margin) after the user's previous background job
 * started (queue delivery is not exact). Such a message has been sent again for the time
 * left, and the caller must not process it; otherwise this job's start has
 * been recorded.
 */
export async function deferIfEarly(env: Env, body: EnrichMessage): Promise<boolean> {
  if (body.slot === undefined) return false;
  const t = now().getTime();
  if (t < body.slot) {
    await env.ENRICH_QUEUE.send(body, { delaySeconds: Math.max(1, delayUntil(body.slot)) });
    return true;
  }
  const claimed = await env.DB.prepare(
    `UPDATE users SET throttle_last_start = ?1
     WHERE id = ?2 AND (throttle_last_start IS NULL OR throttle_last_start <= ?1 - ?3)
     RETURNING id`,
  )
    .bind(t, body.user_id, START_SPACING_MS)
    .first();
  if (claimed) return false;
  const last = await env.DB.prepare('SELECT throttle_last_start AS at FROM users WHERE id = ?')
    .bind(body.user_id)
    .first<{ at: number | null }>();
  const wait = Math.ceil(((last?.at ?? t) + START_SPACING_MS - t) / 1000);
  await env.ENRICH_QUEUE.send(body, { delaySeconds: Math.max(1, wait) });
  return true;
}

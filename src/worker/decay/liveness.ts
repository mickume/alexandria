import { now } from '../clock';
import type { Env, LivenessMessage } from '../env';
import { requestFollowing } from '../fetcher/fetch';
import { getLink, type LinkRow } from '../links/store';

/** How long one liveness request may take. */
export const CHECK_TIMEOUT_MS = 10_000;
const DAY_MS = 86_400_000;
/** A link is checked every this many days. */
export const CHECK_INTERVAL_MS = 7 * DAY_MS;
/** A link enqueued less than this long ago is not enqueued again. */
export const ENQUEUE_WINDOW_MS = 6 * 3_600_000;
/** Consecutive failed weekly checks that make a link dead. */
export const DEAD_AFTER = 3;

/** What one liveness check found. */
export interface CheckOutcome {
  passed: boolean;
  /** 'HTTP <status>' for an answer, or why there was none. */
  result: string;
}

/** One request of a check: the final status, or why there was none. */
async function probe(
  env: Env,
  url: string,
  method: 'GET' | 'HEAD',
  timeoutMs: number,
): Promise<CheckOutcome> {
  const outcome = await requestFollowing(env, url, { method, timeoutMs }, async (response) => {
    // Only the headers matter: the body is never read.
    await response.body?.cancel();
    return { status: response.status };
  });
  if ('ok' in outcome) return { passed: false, result: outcome.reason };
  return {
    passed: outcome.status >= 200 && outcome.status < 300,
    result: `HTTP ${outcome.status}`,
  };
}

/**
 * Checks that a link's address still answers: HEAD through the fetcher's
 * request path (blocked addresses refused, at most 5 redirects, the host
 * gate), and when the HEAD fails in any way a GET that reads only the
 * headers. It passes on a final 2xx. A failure of Alexandria's own (the host
 * gate unavailable) is thrown, so that it never counts against the link.
 */
export async function checkLink(
  env: Env,
  url: string,
  { timeoutMs = CHECK_TIMEOUT_MS } = {},
): Promise<CheckOutcome> {
  const head = await probe(env, url, 'HEAD', timeoutMs);
  if (head.passed) return head;
  return probe(env, url, 'GET', timeoutMs);
}

/** Whether a link is one the weekly checks cover: kept, and active, dormant or pinned. */
export function isCheckable(link: Pick<LinkRow, 'state' | 'pin_position'>): boolean {
  return (
    link.state !== 'archived' &&
    (link.state === 'active' || link.state === 'dormant' || link.pin_position !== null)
  );
}

/** Whether a link's weekly check is due at `t`. */
function isDue(link: LinkRow, t: number): boolean {
  return (
    isCheckable(link) && Date.parse(link.last_checked_at ?? link.added_at) <= t - CHECK_INTERVAL_MS
  );
}

/**
 * Stores a scheduled check's outcome: a pass resets the failures and clears
 * the dead mark; a failure adds one and, on the third in a row, sets
 * dead_since, keeping an earlier one.
 */
async function recordCheck(
  env: Env,
  link: LinkRow,
  outcome: CheckOutcome,
  at: string,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE links SET last_checked_at = ?1, last_check_result = ?2, updated_at = ?1,
         liveness_failures = CASE WHEN ?3 THEN 0 ELSE liveness_failures + 1 END,
         dead_since = CASE WHEN ?3 THEN NULL
                           WHEN liveness_failures + 1 >= ?4 THEN COALESCE(dead_since, ?1)
                           ELSE dead_since END
       WHERE id = ?5 AND user_id = ?6`,
    ).bind(at, outcome.result, outcome.passed ? 1 : 0, DEAD_AFTER, link.id, link.user_id),
  ]);
}

/**
 * The LIVENESS_QUEUE consumer. A message for a link deleted, archived or no
 * longer due is dropped. Anything that fails for Alexandria's own reasons
 * hands the message back to the queue and changes nothing.
 */
export async function handleLivenessBatch(
  batch: MessageBatch<LivenessMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const t = now();
      const link = await getLink(env.DB, message.body.user_id, message.body.link_id);
      if (!link || !isDue(link, t.getTime())) {
        message.ack();
        continue;
      }
      const outcome = await checkLink(env, link.url);
      await recordCheck(env, link, outcome, now().toISOString());
      message.ack();
    } catch (err) {
      console.error('a liveness check could not complete', err);
      message.retry();
    }
  }
}

/**
 * Enqueues the weekly check of every link that is due: kept, active, dormant
 * or pinned, last checked (or, never checked, added) 7 days ago or more, and
 * not enqueued in the last 6 hours. The enqueue time is recorded in the same
 * statement that selects the links.
 */
export async function enqueueDueChecks(env: Env): Promise<void> {
  const t = now().getTime();
  const due = await env.DB.prepare(
    `UPDATE links SET check_enqueued_at = ?1 WHERE id IN (
       SELECT id FROM links
       WHERE state <> 'archived' AND (state IN ('active', 'dormant') OR pin_position IS NOT NULL)
         AND COALESCE(last_checked_at, added_at) <= ?2
         AND (check_enqueued_at IS NULL OR check_enqueued_at <= ?3)
       LIMIT 1000)
     RETURNING id, user_id`,
  )
    .bind(
      new Date(t).toISOString(),
      new Date(t - CHECK_INTERVAL_MS).toISOString(),
      new Date(t - ENQUEUE_WINDOW_MS).toISOString(),
    )
    .all<{ id: string; user_id: string }>();
  const messages = due.results.map((r) => ({ body: { user_id: r.user_id, link_id: r.id } }));
  for (let i = 0; i < messages.length; i += 100) {
    await env.LIVENESS_QUEUE.sendBatch(messages.slice(i, i + 100));
  }
}

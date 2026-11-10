import { Hono } from 'hono';
import { limitReached, notFound } from '../api/errors';
import { accountActive } from '../account/deletion';
import { now } from '../clock';
import type { AppEnv, Env, LivenessMessage } from '../env';
import { requestFollowing, statusReason } from '../fetcher/fetch';
import { getLink, toFullView, type LinkRow } from '../links/store';
import { DAY_MS } from './points';

/** How long one liveness request may take. */
export const CHECK_TIMEOUT_MS = 10_000;
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
    const passed = response.status >= 200 && response.status < 300;
    // Only the headers matter: the body is read only for a Cloudflare 530's error code.
    if (passed) await response.body?.cancel();
    return { passed, result: passed ? `HTTP ${response.status}` : await statusReason(response) };
  });
  if ('ok' in outcome) return { passed: false, result: outcome.reason };
  return outcome;
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

/** Whether a link is one the weekly checks cover: neither expired nor archived, and active or pinned. */
export function isCheckable(link: Pick<LinkRow, 'state' | 'pin_position'>): boolean {
  return (
    link.state !== 'expired' &&
    link.state !== 'archived' &&
    (link.state === 'active' || link.pin_position !== null)
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
 * The LIVENESS_QUEUE consumer. A message for a link deleted, expired or no
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
      const active = await accountActive(env.DB, message.body.user_id);
      const link = active
        ? await getLink(env.DB, message.body.user_id, message.body.link_id)
        : null;
      if (!link || !isDue(link, t.getTime())) {
        message.ack();
        continue;
      }
      const outcome = await checkLink(env, link.url);
      if (!(await accountActive(env.DB, link.user_id))) {
        message.ack();
        continue;
      }
      await recordCheck(env, link, outcome, now().toISOString());
      message.ack();
    } catch (err) {
      console.error('a liveness check could not complete', err);
      message.retry();
    }
  }
}

/**
 * The SQL condition that the link `l` is due a weekly check: neither expired nor
 * archived, active or pinned, last checked (or, never checked, added) at or
 * before `checkedBefore`, and not enqueued after `enqueuedBefore`; both are SQL
 * expressions of stored times, such as bound parameters.
 */
export function checkDue(l: string, checkedBefore: string, enqueuedBefore: string): string {
  return `${l}.state NOT IN ('expired', 'archived')
    AND (${l}.state = 'active' OR ${l}.pin_position IS NOT NULL)
    AND COALESCE(${l}.last_checked_at, ${l}.added_at) <= ${checkedBefore}
    AND (${l}.check_enqueued_at IS NULL OR ${l}.check_enqueued_at <= ${enqueuedBefore})`;
}

/** The stored times checkDue compares with at `t`: the check interval and the enqueue window before it. */
export function checkDueTimes(t: number): [string, string] {
  return [
    new Date(t - CHECK_INTERVAL_MS).toISOString(),
    new Date(t - ENQUEUE_WINDOW_MS).toISOString(),
  ];
}

/**
 * Enqueues the weekly check of every link that is due (checkDue). The enqueue
 * time is recorded in the same statement that selects the links.
 */
export async function enqueueDueChecks(env: Env): Promise<void> {
  const t = now().getTime();
  const due = await env.DB.prepare(
    `UPDATE links SET check_enqueued_at = ?1 WHERE id IN (
       SELECT id FROM links
       WHERE user_id IN (SELECT id FROM users WHERE deletion_requested_at IS NULL)
         AND ${checkDue('links', '?2', '?3')}
       LIMIT 1000)
     RETURNING id, user_id`,
  )
    .bind(new Date(t).toISOString(), ...checkDueTimes(t))
    .all<{ id: string; user_id: string }>();
  const messages = due.results.map((r) => ({ body: { user_id: r.user_id, link_id: r.id } }));
  for (let i = 0; i < messages.length; i += 100) {
    await env.LIVENESS_QUEUE.sendBatch(messages.slice(i, i + 100));
  }
}

/** The least time between two on-demand checks of one link. */
export const MANUAL_CHECK_INTERVAL_MS = 10 * 60_000;

/** Checking one link on demand, under /api/v1/links. */
export const checkRoutes = new Hono<AppEnv>();

checkRoutes.post('/:id/check', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const link = await getLink(c.env.DB, userId, id);
  if (!link) return notFound(c);
  if (link.state === 'expired')
    return limitReached(c, 'link_expired', 'expired links are not checked');
  if (link.state === 'archived')
    return limitReached(c, 'link_archived', 'archived links are not checked');
  const t = now();
  const claimed = await c.env.DB.prepare(
    `UPDATE links SET last_manual_check_at = ?1 WHERE id = ?2 AND user_id = ?3
       AND (last_manual_check_at IS NULL OR last_manual_check_at <= ?4) RETURNING id`,
  )
    .bind(
      t.toISOString(),
      id,
      userId,
      new Date(t.getTime() - MANUAL_CHECK_INTERVAL_MS).toISOString(),
    )
    .first();
  if (!claimed) {
    const since = t.getTime() - Date.parse(link.last_manual_check_at ?? '');
    c.header(
      'Retry-After',
      String(Math.max(1, Math.ceil((MANUAL_CHECK_INTERVAL_MS - since) / 1000))),
    );
    return c.json({ error: 'checked_recently', message: 'already checked recently' }, 429);
  }
  const outcome = await checkLink(c.env, link.url);
  const at = now().toISOString();
  // An on-demand check counts only when it passes: three quick clicks cannot kill a link.
  await c.env.DB.prepare(
    `UPDATE links SET last_checked_at = ?1, last_check_result = ?2, updated_at = ?1,
       liveness_failures = CASE WHEN ?3 THEN 0 ELSE liveness_failures END,
       dead_since = CASE WHEN ?3 THEN NULL ELSE dead_since END
     WHERE id = ?4 AND user_id = ?5`,
  )
    .bind(at, outcome.result, outcome.passed ? 1 : 0, id, userId)
    .run();
  const updated = await getLink(c.env.DB, userId, id);
  return c.json({
    passed: outcome.passed,
    result: outcome.result,
    checked_at: at,
    link: toFullView(updated!),
  });
});

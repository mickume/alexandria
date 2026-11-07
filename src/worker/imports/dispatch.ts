/**
 * The import dispatcher: sends imported links to the fetch worker in file
 * order, at most 20 a minute per user, sharing that budget with 'enrich all'.
 */
import { now } from '../clock';
import { THROTTLE_SPACING_MS } from '../enrich/throttle';
import type { Env, FetchMessage } from '../env';

/** The cron trigger of the every-minute dispatch run (wrangler.jsonc). */
export const DISPATCH_CRON = '* * * * *';

/** The most links a user's imports send to the fetch worker in any 60 seconds. */
export const DISPATCH_PER_MINUTE = 20;
const WINDOW_MS = 60_000;

/**
 * How many of the user's background (enrich all) slots may fall within a
 * minute of `t`: those reserved up to the user's next free slot, counted from
 * a minute before `t`, since a schedule that ends after it may have started
 * that early.
 */
function enrichSlotsNear(nextFree: number | null, t: number): number {
  if (nextFree === null || nextFree <= t - WINDOW_MS) return 0;
  const end = Math.min(nextFree, t + WINDOW_MS);
  return Math.ceil((end - (t - WINDOW_MS)) / THROTTLE_SPACING_MS);
}

/** How many links the user's imports may send now. */
async function budget(db: D1Database, userId: string, t: number): Promise<number> {
  const [recent, user] = await db.batch<{ n?: number; next?: number | null }>([
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM import_links il JOIN imports i ON i.id = il.import_id
         WHERE i.user_id = ? AND il.skipped = 0 AND il.dispatched_at > ?`,
      )
      .bind(userId, new Date(t - WINDOW_MS).toISOString()),
    db.prepare('SELECT throttle_next_at AS next FROM users WHERE id = ?').bind(userId),
  ]);
  const sent = recent?.results[0]?.n ?? 0;
  const enrich = enrichSlotsNear(user?.results[0]?.next ?? null, t);
  return Math.max(0, DISPATCH_PER_MINUTE - sent - enrich);
}

/** A waiting imported link, with what tells whether something else already sent it. */
interface Waiting {
  import_id: string;
  link_id: string;
  state: string;
  refresh_requested_at: string | null;
  fetched_at: string | null;
  fetch_attempts: number;
}

/** Whether the link was already sent to the fetch worker by another action, such as a refresh. */
function sentElsewhere(w: Waiting): boolean {
  return (
    w.state !== 'pending' ||
    w.refresh_requested_at !== null ||
    w.fetched_at !== null ||
    w.fetch_attempts > 0
  );
}

/** The user's next waiting imported links: earlier imports first, then by line. */
function nextWaiting(db: D1Database, userId: string, limit: number) {
  return db
    .prepare(
      `SELECT il.import_id, il.link_id, l.state, l.refresh_requested_at, l.fetched_at,
         l.fetch_attempts
       FROM import_links il JOIN imports i ON i.id = il.import_id JOIN links l ON l.id = il.link_id
       WHERE i.user_id = ? AND il.dispatched_at IS NULL
       ORDER BY i.created_at, i.id, il.line LIMIT ?`,
    )
    .bind(userId, limit)
    .all<Waiting>();
}

/**
 * Sends the user's waiting imported links to the fetch worker, earlier
 * imports first and each in line order, as many as the budget allows: 20 in
 * any 60 seconds, less the 'enrich all' jobs near now. A link deleted
 * meanwhile is gone from the import; one already sent by another action is
 * marked skipped and uses no budget. Each sent link records its time, and the
 * user's 'enrich all' starts no job within the next minute.
 */
export async function dispatchImports(env: Env, userId: string): Promise<number> {
  const t = now().getTime();
  const at = new Date(t).toISOString();
  let left = await budget(env.DB, userId, t);
  const claimed: string[] = [];
  while (left > 0) {
    const page = await nextWaiting(env.DB, userId, left + 20);
    if (page.results.length === 0) break;
    const statements: D1PreparedStatement[] = [];
    for (const w of page.results) {
      const skip = sentElsewhere(w);
      if (!skip && left === 0) break;
      if (!skip) left -= 1;
      statements.push(
        env.DB.prepare(
          `UPDATE import_links SET dispatched_at = ?, skipped = ?
           WHERE import_id = ? AND link_id = ? AND dispatched_at IS NULL RETURNING link_id, skipped`,
        ).bind(at, skip ? 1 : 0, w.import_id, w.link_id),
      );
    }
    const results = await env.DB.batch<{ link_id: string; skipped: number }>(statements);
    for (const r of results) {
      const row = r.results[0];
      if (row && !row.skipped) claimed.push(row.link_id);
    }
  }
  if (claimed.length === 0) return 0;
  const messages = claimed.map((link_id) => ({
    body: { user_id: userId, link_id } as FetchMessage,
  }));
  for (let i = 0; i < messages.length; i += 100) {
    await env.FETCH_QUEUE.sendBatch(messages.slice(i, i + 100));
  }
  await env.DB.prepare(
    'UPDATE users SET import_window_end = MAX(COALESCE(import_window_end, 0), ?) WHERE id = ?',
  )
    .bind(t + WINDOW_MS, userId)
    .run();
  return claimed.length;
}

/** The users whose imports have links waiting. */
async function usersWaiting(db: D1Database): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT i.user_id FROM import_links il JOIN imports i ON i.id = il.import_id
       WHERE il.dispatched_at IS NULL`,
    )
    .all<{ user_id: string }>();
  return rows.results.map((r) => r.user_id);
}

/**
 * The every-minute scheduled run: dispatches the waiting imported links of
 * every user, one user at a time, so that one user's failure does not stop
 * the others.
 */
export async function dispatchAllImports(env: Env): Promise<void> {
  for (const userId of await usersWaiting(env.DB)) {
    try {
      await dispatchImports(env, userId);
    } catch (err) {
      console.error('import dispatch failed for a user', err);
    }
  }
}

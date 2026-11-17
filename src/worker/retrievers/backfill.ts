/**
 * The one-time retrieval: once a retriever is deployed, the links already in
 * the library whose addresses it claims, and that it has never retrieved, are
 * fetched once more, through it. The every-minute run sends them, at most 20
 * a minute across all users and only while no import has links waiting.
 */
import { now } from '../clock';
import type { Env, FetchMessage } from '../env';
import { findRetriever, RETRIEVERS } from './registry';
import type { Retriever, RetrieverName } from './retriever';

/** The most links the one-time retrieval sends to the fetch worker in a minute. */
export const RETRIEVAL_PER_MINUTE = 20;
/** How long a retriever's one-time retrieval waits after its API's limit or quota was spent. */
export const RETRIEVAL_PAUSE_MS = 60 * 60_000;

/** How many candidate links are read at a time. */
const PAGE_SIZE = 100;

/**
 * Hands `linkId` back to `retriever`'s one-time retrieval and pauses that
 * retrieval for an hour: its API answered that its rate limit or quota is
 * spent, and the link is to be retried, not fetched as a page.
 */
export async function pauseRetrieval(
  env: Env,
  retriever: RetrieverName,
  userId: string,
  linkId: string,
): Promise<void> {
  const until = new Date(now().getTime() + RETRIEVAL_PAUSE_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE links SET retrieval_seen = NULL WHERE id = ? AND user_id = ?').bind(
      linkId,
      userId,
    ),
    env.DB.prepare(
      `INSERT INTO retrieval_state (retriever, paused_until) VALUES (?1, ?2)
       ON CONFLICT (retriever) DO UPDATE SET paused_until = MAX(COALESCE(paused_until, ''), ?2)`,
    ).bind(retriever, until),
  ]);
}

/** Whether `retriever`'s one-time retrieval is paused at `at`. */
async function paused(db: D1Database, retriever: Retriever, at: Date): Promise<boolean> {
  const row = await db
    .prepare('SELECT paused_until FROM retrieval_state WHERE retriever = ?')
    .bind(retriever.name)
    .first<{ paused_until: string | null }>();
  return Boolean(row?.paused_until && Date.parse(row.paused_until) > at.getTime());
}

/** Whether any import still has links to send to the fetch worker: those go first. */
async function importsWaiting(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS waiting FROM import_links WHERE dispatched_at IS NULL LIMIT 1')
    .first<{ waiting: number }>();
  return row !== null;
}

/**
 * Sends `retriever`'s next links to the fetch worker, at most `budget`:
 * links on its hosts, not pending, of an account not being deleted, that it
 * has neither retrieved nor taken already. Each link read is marked as taken
 * by the retriever, whether it claims it (and it is sent) or not, so no link
 * is read twice. Returns how many were sent.
 */
async function sendNext(env: Env, retriever: Retriever, budget: number): Promise<number> {
  let left = budget;
  const hosts = retriever.hosts.map((_, i) => `?${i + 2}`).join(', ');
  while (left > 0) {
    const { results } = await env.DB.prepare(
      `SELECT l.id, l.user_id, l.url FROM links l JOIN users u ON u.id = l.user_id
       WHERE l.host IN (${hosts}) AND l.state <> 'pending'
         AND l.retrieval_seen IS NOT ?1
         AND COALESCE(json_extract(l.site, '$.retriever'), '') <> ?1
         AND u.deletion_requested_at IS NULL
       ORDER BY l.id LIMIT ${PAGE_SIZE}`,
    )
      .bind(retriever.name, ...retriever.hosts)
      .all<{ id: string; user_id: string; url: string }>();
    if (results.length === 0) break;
    const messages: { body: FetchMessage }[] = [];
    const taken: D1PreparedStatement[] = [];
    for (const row of results) {
      const claimed = findRetriever(env, row.url, [retriever]) !== null;
      if (claimed) {
        if (left === 0) break;
        left -= 1;
        messages.push({
          body: { user_id: row.user_id, link_id: row.id, refresh: true, backfill: true },
        });
      }
      taken.push(
        env.DB.prepare('UPDATE links SET retrieval_seen = ? WHERE id = ? AND user_id = ?').bind(
          retriever.name,
          row.id,
          row.user_id,
        ),
      );
    }
    // Sent before they are marked: a failed mark sends a link again, never loses one.
    if (messages.length > 0) await env.FETCH_QUEUE.sendBatch(messages);
    if (taken.length > 0) await env.DB.batch(taken);
  }
  return budget - left;
}

/**
 * The every-minute run of the one-time retrieval: while no import has links
 * waiting, sends up to 20 links, each enabled retriever in turn, skipping a
 * retriever whose API's limit was spent in the last hour. Returns how many
 * links were sent.
 */
export async function retrieveStoredLinks(
  env: Env,
  retrievers: Retriever[] = RETRIEVERS,
): Promise<number> {
  if (await importsWaiting(env.DB)) return 0;
  const at = now();
  let sent = 0;
  for (const retriever of retrievers) {
    if (sent >= RETRIEVAL_PER_MINUTE) break;
    if (!retriever.enabled(env) || (await paused(env.DB, retriever, at))) continue;
    sent += await sendNext(env, retriever, RETRIEVAL_PER_MINUTE - sent);
  }
  return sent;
}

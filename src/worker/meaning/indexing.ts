/** Indexing links by meaning: one job per link, cutting its text into passages and embedding them. */
import { accountActive } from '../account/deletion';
import { now } from '../clock';
import type { Env, IndexMessage } from '../env';
import { getLink, parseStrings } from '../links/store';
import { meaningBackend } from './backend';
import { cutPassages, READER_TEXT_MAX } from './cut';

/** The text version of a link: 0 for a link whose indexed text never changed. */
async function textVersion(db: D1Database, linkId: string): Promise<number> {
  const row = await db
    .prepare(
      'SELECT COALESCE((SELECT text_version FROM link_index_state WHERE link_id = ?), 0) AS version',
    )
    .bind(linkId)
    .first<{ version: number }>();
  return row?.version ?? 0;
}

/** Whether the link has passages made from its text at `version`. */
async function isIndexed(db: D1Database, linkId: string, version: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM link_passages WHERE link_id = ? AND version = ? LIMIT 1')
    .bind(linkId, version)
    .first();
  return row !== null;
}

/**
 * The condition every write of a job depends on: the link still exists, its
 * account is not being deleted and its text is still at the version the job
 * read. Parameters: ?1 the link, ?2 the user, ?3 the version.
 */
const STILL_CURRENT = `EXISTS (
    SELECT 1 FROM links l JOIN users u ON u.id = l.user_id
    WHERE l.id = ?1 AND l.user_id = ?2 AND u.deletion_requested_at IS NULL)
  AND COALESCE((SELECT text_version FROM link_index_state WHERE link_id = ?1), 0) = ?3`;

/** Queues vectors for deletion from the index. */
async function queueDeletions(db: D1Database, userId: string, ids: string[]): Promise<void> {
  await db
    .prepare(
      `INSERT INTO vector_deletions (vector_id, user_id)
       SELECT value, ?2 FROM json_each(?1) WHERE true
       ON CONFLICT (vector_id) DO NOTHING`,
    )
    .bind(JSON.stringify(ids), userId)
    .run();
}

/** The most messages one sendBatch carries. */
const SEND_BATCH = 100;
/** The most links looked up in one query. */
const LOOKUP_BATCH = 500;

/** `items` in slices of at most `size`. */
function slices<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The condition, on a link `l` left-joined with its `link_index_state` row
 * `s`, that the link is stale: no passage of it was made from its current
 * text version.
 */
export const IS_STALE = `NOT EXISTS (
  SELECT 1 FROM link_passages p WHERE p.link_id = l.id AND p.version = COALESCE(s.text_version, 0))`;

/**
 * Sends one index message for each of the user's links and records when they
 * were queued, so that the backfill leaves them alone for a while. The links
 * must exist.
 */
export async function sendIndexMessages(
  env: Env,
  userId: string,
  linkIds: string[],
): Promise<void> {
  for (const batch of slices(linkIds, SEND_BATCH)) {
    await env.INDEX_QUEUE.sendBatch(
      batch.map((link_id) => ({ body: { user_id: userId, link_id } })),
    );
    await env.DB.prepare(
      `INSERT INTO link_index_state (link_id, text_version, queued_at)
       SELECT value, 0, ?1 FROM json_each(?2) WHERE true
       ON CONFLICT (link_id) DO UPDATE SET queued_at = excluded.queued_at`,
    )
      .bind(now().toISOString(), JSON.stringify(batch))
      .run();
  }
}

/**
 * Queues the stale ones among the user's links for indexing, after a write
 * that may have changed their text. A failure is logged and never fails the
 * write: the links stay stale and the backfill picks them up.
 */
export async function queueIndexing(env: Env, userId: string, linkIds: string[]): Promise<void> {
  try {
    for (const lookup of slices(linkIds, LOOKUP_BATCH)) {
      const stale = await env.DB.prepare(
        `SELECT l.id FROM links l LEFT JOIN link_index_state s ON s.link_id = l.id
         WHERE l.user_id = ?1 AND l.id IN (SELECT value FROM json_each(?2)) AND ${IS_STALE}`,
      )
        .bind(userId, JSON.stringify(lookup))
        .all<{ id: string }>();
      await sendIndexMessages(
        env,
        userId,
        stale.results.map((r) => r.id),
      );
    }
  } catch (err) {
    console.error('queueing links for indexing failed', err);
  }
}

/**
 * Indexes one link: cuts its text into passages, embeds them, stores their
 * vectors in its owner's namespace and the passages in D1, replacing those of
 * older text. Nothing is written when the account is being deleted, the link
 * is gone or its passages are current. When the link is deleted or its text
 * changes while the job runs, the vectors it stored are queued for deletion
 * and the passages are left as they were. A failing Workers AI or Vectorize
 * throws, before anything is written to D1.
 */
export async function indexLink(env: Env, message: IndexMessage): Promise<void> {
  const { user_id: userId, link_id: linkId } = message;
  if (!(await accountActive(env.DB, userId))) return;
  // The version is read before the text, so that a change in between leaves
  // the job stale and its write is refused.
  const version = await textVersion(env.DB, linkId);
  const link = await getLink(env.DB, userId, linkId);
  if (!link || (await isIndexed(env.DB, linkId, version))) return;
  const reader = await env.DB.prepare(
    'SELECT substr(text, 1, ?) AS text FROM link_texts WHERE link_id = ? AND user_id = ?',
  )
    .bind(READER_TEXT_MAX, linkId, userId)
    .first<{ text: string }>();
  const passages = cutPassages(
    {
      title: link.title,
      summary: link.summary,
      topic: link.topic ?? null,
      tags: parseStrings(link.tags_json),
      note: link.note,
    },
    reader?.text ?? null,
  );

  const backend = meaningBackend(env);
  const embeddings = await backend.embed(passages.map((p) => p.text));
  const ids = passages.map((_, n) => `${linkId}:${version}:${n}`);
  await backend.upsert(
    userId,
    ids.map((id, n) => ({ id, values: embeddings[n]!, metadata: { kind: passages[n]!.kind } })),
  );

  await env.DB.batch([
    // Older passages go (their triggers queue their vectors); those of this version stay.
    env.DB.prepare(
      `DELETE FROM link_passages WHERE link_id = ?1 AND version <> ?3 AND ${STILL_CURRENT}`,
    ).bind(linkId, userId, version),
    env.DB.prepare(
      `INSERT OR IGNORE INTO link_passages (vector_id, link_id, user_id, version, position, text)
       SELECT ?1 || ':' || CAST(?3 AS INTEGER) || ':' || j.key, ?1, ?2, ?3, j.key, j.value
       FROM json_each(?4) j WHERE ${STILL_CURRENT}`,
    ).bind(linkId, userId, version, JSON.stringify(passages.map((p) => p.text))),
  ]);
  const stored = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM link_passages WHERE link_id = ? AND version = ?',
  )
    .bind(linkId, version)
    .first<{ n: number }>();
  if (stored?.n !== passages.length) await queueDeletions(env.DB, userId, ids);
}

/** The INDEX_QUEUE consumer: one link per message, handed back for retry when it fails. */
export async function handleIndexBatch(batch: MessageBatch<IndexMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await indexLink(env, message.body);
      message.ack();
    } catch (err) {
      console.error('indexing a link failed', err);
      message.retry();
    }
  }
}

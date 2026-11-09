/** Indexing links by meaning: one job per link, cutting its text into passages and embedding them. */
import { accountActive } from '../account/deletion';
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
  const embeddings = await backend.embed(passages);
  const ids = passages.map((_, n) => `${linkId}:${version}:${n}`);
  await backend.upsert(
    userId,
    ids.map((id, n) => ({ id, values: embeddings[n]! })),
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
    ).bind(linkId, userId, version, JSON.stringify(passages)),
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

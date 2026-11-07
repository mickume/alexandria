import { now } from '../clock';
import type { EnrichMessage, Env } from '../env';
import { getLink, type LinkRow } from '../links/store';
import { buildPrompt, normalizeResult, type Enrichment } from './enrich';
import { decryptKey, getAiSettings, type AiSettings } from './keys';
import { enrichWith } from './providers';
import { deferIfEarly } from './throttle';
import { listVocabulary, resolveTags, resolveTopic } from './vocabulary';

/** Notes that mean a link has nothing to enrich. */
const NOTHING_TO_ENRICH = [/^not a web page/, /^no text in this PDF$/, /^PDF too large to store/];

/** Whether a fetched link with these notes has nothing for enrichment to read. */
export function hasNothingToEnrich(notes: string[]): boolean {
  return notes.some((note) => NOTHING_TO_ENRICH.some((re) => re.test(note)));
}

/** Sets a link's enrichment status (and reason), touching its change time. */
export async function setEnrichmentStatus(
  db: D1Database,
  link: Pick<LinkRow, 'id' | 'user_id'>,
  status: string,
  reason: string | null = null,
): Promise<void> {
  await db
    .prepare(
      'UPDATE links SET enrichment_status = ?, enrichment_reason = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    )
    .bind(status, reason, now().toISOString(), link.id, link.user_id)
    .run();
}

/**
 * Hands a freshly fetched link to enrichment: skipped when it has nothing to
 * read, 'no_key' without a key, 'waiting_for_key' while the key is rejected,
 * else 'queued' with an enrichment message sent at once.
 */
export async function afterFetch(
  env: Env,
  link: Pick<LinkRow, 'id' | 'user_id'>,
  notes: string[],
): Promise<void> {
  if (hasNothingToEnrich(notes)) return setEnrichmentStatus(env.DB, link, 'skipped');
  const settings = await getAiSettings(env.DB, link.user_id);
  if (!settings) return setEnrichmentStatus(env.DB, link, 'no_key');
  if (settings.status === 'rejected') return setEnrichmentStatus(env.DB, link, 'waiting_for_key');
  await setEnrichmentStatus(env.DB, link, 'queued');
  await env.ENRICH_QUEUE.send({ user_id: link.user_id, link_id: link.id, attempt: 1 });
}

/** Stores an enrichment on the link: summary, topic, tags, time and status. */
async function storeEnrichment(env: Env, link: LinkRow, result: Enrichment): Promise<void> {
  const topicId = await resolveTopic(env.DB, link.user_id, result.topic);
  const tagIds = await resolveTags(env.DB, link.user_id, result.tags);
  const at = now().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE links SET summary = ?, topic_id = ?, enriched_at = ?, enrichment_status = 'enriched',
         enrichment_reason = NULL, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).bind(result.summary, topicId, at, at, link.id, link.user_id),
    env.DB.prepare('DELETE FROM link_tags WHERE link_id = ?').bind(link.id),
    ...tagIds.map((tagId, i) =>
      env.DB.prepare(
        'INSERT INTO link_tags (link_id, tag_id, position) SELECT id, ?, ? FROM links WHERE id = ? AND user_id = ?',
      ).bind(tagId, i, link.id, link.user_id),
    ),
  ]);
}

/** The request about `link`: its text, or its title and description, and the user's vocabulary. */
async function promptFor(env: Env, link: LinkRow): Promise<string> {
  const text = await env.DB.prepare('SELECT text FROM link_texts WHERE link_id = ? AND user_id = ?')
    .bind(link.id, link.user_id)
    .first<{ text: string }>();
  const vocabulary = await listVocabulary(env.DB, link.user_id);
  return buildPrompt({
    title: link.title,
    host: link.host,
    text: text?.text ?? '',
    description: link.description,
    ...vocabulary,
  });
}

/** Enriches one link with its user's own key and model. */
async function processEnrichment(env: Env, message: Message<EnrichMessage>): Promise<void> {
  if (await deferIfEarly(env, message.body)) return message.ack();
  const { user_id, link_id } = message.body;
  const link = await getLink(env.DB, user_id, link_id);
  if (!link) return message.ack();
  const settings: AiSettings | null = await getAiSettings(env.DB, user_id);
  if (!settings) {
    await setEnrichmentStatus(env.DB, link, 'no_key');
    return message.ack();
  }
  const apiKey = await decryptKey(env, settings.ciphertext, settings.iv, user_id);
  const outcome = await enrichWith(
    env,
    { provider: settings.provider, apiKey, model: settings.model },
    await promptFor(env, link),
  );
  const result = outcome.ok ? normalizeResult(outcome.value) : null;
  if (result) await storeEnrichment(env, link, result);
  message.ack();
}

/** The ENRICH_QUEUE consumer. */
export async function handleEnrichBatch(
  batch: MessageBatch<EnrichMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processEnrichment(env, message);
    } catch (err) {
      console.error('enriching a link failed', err);
      message.retry();
    }
  }
}

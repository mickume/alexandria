import { now } from '../clock';
import type { EnrichMessage, Env } from '../env';
import { getLink, parseStrings, type LinkRow } from '../links/store';
import { applyAliases, buildPrompt, normalizeResult, type Enrichment } from './enrich';
import { decryptKey, getAiSettings, markKeyRejected, type AiSettings } from './keys';
import { enrichWith } from './providers';
import { deferIfEarly } from './throttle';
import {
  listAliases,
  listVocabulary,
  resolveTags,
  resolveTopic,
  setTagsStatements,
} from './vocabulary';

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
async function storeEnrichment(env: Env, link: LinkRow, proposed: Enrichment): Promise<void> {
  // A former name the provider proposes lands on its survivor.
  const result = applyAliases(proposed, await listAliases(env.DB, link.user_id));
  // The owner's edits win: an edited field keeps the owner's value.
  const edited = new Set(parseStrings(link.edited_fields));
  const topicId = edited.has('topic')
    ? link.topic_id
    : await resolveTopic(env.DB, link.user_id, result.topic);
  const tagIds = edited.has('tags') ? null : await resolveTags(env.DB, link.user_id, result.tags);
  const at = now().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE links SET summary = ?, topic_id = ?, enriched_at = ?, enrichment_status = 'enriched',
         enrichment_reason = NULL, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).bind(
      edited.has('summary') ? link.summary : result.summary,
      topicId,
      at,
      at,
      link.id,
      link.user_id,
    ),
    ...(tagIds ? setTagsStatements(env.DB, link.user_id, link.id, tagIds) : []),
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
  if (settings.status === 'rejected') {
    // Enrichment is paused until the owner replaces the key.
    await setEnrichmentStatus(env.DB, link, 'waiting_for_key');
    return message.ack();
  }
  const apiKey = await decryptKey(env, settings.ciphertext, settings.iv, user_id);
  const outcome = await enrichWith(
    env,
    { provider: settings.provider, apiKey, model: settings.model },
    await promptFor(env, link),
  );
  if (!outcome.ok && outcome.kind === 'rejected') {
    await markKeyRejected(env.DB, user_id, outcome.message);
    await setEnrichmentStatus(env.DB, link, 'waiting_for_key');
    return message.ack();
  }
  const result = outcome.ok ? normalizeResult(outcome.value) : null;
  if (result) {
    await storeEnrichment(env, link, result);
  } else {
    const reason = outcome.ok ? 'the result was not usable' : outcome.message;
    await recordFailedEnrichment(env, link, message.body, reason);
  }
  message.ack();
}

/** The delay before the one automatic retry of a failed enrichment. */
const RETRY_DELAY_SECONDS = 600;

/**
 * Marks a link's enrichment failed with its reason, keeping what the fetch
 * stored, and sends the first automatic attempt again in 10 minutes; a retry
 * or a re-run the owner asked for is not retried.
 */
async function recordFailedEnrichment(
  env: Env,
  link: LinkRow,
  body: EnrichMessage,
  reason: string,
): Promise<void> {
  await setEnrichmentStatus(env.DB, link, 'failed', reason);
  const firstAutomatic = !body.manual && (body.attempt ?? 1) === 1;
  if (firstAutomatic) {
    await env.ENRICH_QUEUE.send({ ...body, attempt: 2 }, { delaySeconds: RETRY_DELAY_SECONDS });
  }
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

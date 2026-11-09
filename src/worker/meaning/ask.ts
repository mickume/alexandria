/**
 * Asking the library: POST /api/v1/ask answers a question from the passages of
 * the owner's links, written by the owner's own AI provider with the owner's
 * own key, and streams the answer.
 */
import { Hono } from 'hono';
import { limitReached, readJson, refusal, validationError } from '../api/errors';
import type { AppEnv } from '../env';
import { getAiSettings } from '../enrich/keys';
import { parseQuery } from '../search/query';
import { findPassages, MeaningUnavailable } from './passages';

/** The longest question, in characters. */
export const QUESTION_MAX = 500;
/** How many passages an answer is written from. */
export const ASK_PASSAGES = 8;

export const askRoutes = new Hono<AppEnv>();

askRoutes.post('/', async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.response;
  const question = body.body.question;
  const noWord = () =>
    validationError(c, 'invalid_question', 'question', 'ask with at least one word');
  if (typeof question !== 'string') return noWord();
  if (question.length > QUESTION_MAX) {
    return validationError(
      c,
      'question_too_long',
      'question',
      `a question of at most ${QUESTION_MAX} characters`,
    );
  }
  const parsed = parseQuery(question, QUESTION_MAX);
  if (!parsed.ok) return validationError(c, parsed.error, 'question', parsed.message);
  if (parsed.words.length === 0) return noWord();

  const userId = c.get('user').id;
  const settings = await getAiSettings(c.env.DB, userId);
  if (!settings) return limitReached(c, 'no_ai_key', 'add an AI key in settings');
  if (settings.status === 'rejected') {
    return limitReached(
      c,
      'ai_key_rejected',
      settings.rejectedMessage ?? 'the provider rejected the key',
    );
  }

  try {
    await findPassages(c.env, userId, parsed.words, parsed.filters, ASK_PASSAGES);
  } catch (err) {
    if (!(err instanceof MeaningUnavailable)) throw err;
    console.error('search by meaning is unavailable', err);
    return refusal(c, 503, 'search_unavailable', 'search by meaning is unavailable, try again');
  }
  return c.body(null, 204);
});

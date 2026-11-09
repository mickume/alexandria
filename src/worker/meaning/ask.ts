/**
 * Asking the library: POST /api/v1/ask answers a question from the passages of
 * the owner's links, written by the owner's own AI provider with the owner's
 * own key, and streams the answer.
 */
import { Hono } from 'hono';
import { limitReached, readJson, refusal, validationError } from '../api/errors';
import type { AppEnv } from '../env';
import { decryptKey, getAiSettings } from '../enrich/keys';
import { streamAnswer, type AnswerRequest } from '../enrich/providers';
import { getLink, toView } from '../links/store';
import { parseQuery } from '../search/query';
import { findPassages, MeaningUnavailable, type Passage } from './passages';

/** The longest question, in characters. */
export const QUESTION_MAX = 500;
/** How many passages an answer is written from. */
export const ASK_PASSAGES = 8;

/** The whole answer when the passages answer nothing. */
export const NOTHING_ANSWERS = 'Nothing in your library answers this.';

/** What the provider is told: to answer from the passages only, and how to cite and to give up. */
const SYSTEM = `You answer a question from numbered passages of the user's own saved web pages, and only from them. Use no knowledge from outside the passages. Cite every statement with the number of its source as [n], for example [1]. If the passages do not answer the question, answer exactly: ${NOTHING_ANSWERS}`;

/** One source of an answer: a link its passages came from, numbered from 1. */
interface Source {
  n: number;
  link: ReturnType<typeof toView>;
}

/** The request to the provider: each passage headed by its source's number and title, then the question. */
function answerRequest(
  passages: Passage[],
  numbers: Map<string, number>,
  words: string[],
): AnswerRequest {
  const cited = passages.map((p) => `[${numbers.get(p.link_id)}] ${p.title}\n${p.passage}`);
  return { system: SYSTEM, prompt: `${cited.join('\n\n')}\n\nQuestion: ${words.join(' ')}` };
}

const encoder = new TextEncoder();

/** One server-sent event. */
const event = (name: string, data: unknown) =>
  encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);

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

  let passages: Passage[];
  try {
    passages = await findPassages(c.env, userId, parsed.words, parsed.filters, ASK_PASSAGES);
  } catch (err) {
    if (!(err instanceof MeaningUnavailable)) throw err;
    console.error('search by meaning is unavailable', err);
    return refusal(c, 503, 'search_unavailable', 'search by meaning is unavailable, try again');
  }

  // The sources are numbered in the order of their best passage, which comes first.
  const numbers = new Map<string, number>();
  for (const p of passages) if (!numbers.has(p.link_id)) numbers.set(p.link_id, numbers.size + 1);
  const sources: Source[] = [];
  for (const [id, n] of numbers) {
    const row = await getLink(c.env.DB, userId, id);
    if (row) sources.push({ n, link: toView(row) });
  }
  const apiKey = await decryptKey(c.env, settings.ciphertext, settings.iv, userId);
  const call = { provider: settings.provider, apiKey, model: settings.model };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(event('sources', { sources }));
        if (passages.length === 0) {
          controller.enqueue(event('delta', { text: NOTHING_ANSWERS }));
          controller.enqueue(event('done', {}));
          return;
        }
        const outcome = await streamAnswer(
          c.env,
          call,
          answerRequest(passages, numbers, parsed.words),
          (text) => void controller.enqueue(event('delta', { text })),
        );
        if (outcome.ok) controller.enqueue(event('done', {}));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
});

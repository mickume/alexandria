/**
 * Asking the library: POST /api/v1/ask answers a question from the passages of
 * the owner's links, written by the owner's own AI provider with the owner's
 * own key, and streams the answer; a detailed ask reads more passages and asks
 * for a longer, thorough answer.
 */
import { Hono } from 'hono';
import { limitReached, readJson, refusal, validationError } from '../api/errors';
import { now } from '../clock';
import type { AppEnv } from '../env';
import { decryptKey, getAiSettings, markKeyRejected } from '../enrich/keys';
import { phrasingsWith, streamAnswer, type AnswerRequest } from '../enrich/providers';
import { getLink, parseStrings, toView, type LinkRow } from '../links/store';
import { parseQuery } from '../search/query';
import { countStatement } from '../stats/daily';
import { withoutOverlap } from './cut';
import { findPassages, type FoundPassage } from './passages';

/** The longest question, in characters. */
export const QUESTION_MAX = 500;
/** How many passages an answer is written from. */
export const ASK_PASSAGES = 8;
/** How many passages a detailed answer is written from. */
export const DETAILED_PASSAGES = 16;
/** The most characters of passages an answer is written from. */
export const ASK_CONTEXT_MAX = 40_000;
/** The most characters of passages a detailed answer is written from. */
export const DETAILED_CONTEXT_MAX = 80_000;
/** The longest phrasing of a question, in characters. */
export const PHRASING_MAX = 200;
/** The most phrasings the owner's provider adds to a question. */
export const PHRASINGS_MAX = 3;
/** The most tokens a detailed answer may hold. */
export const DETAILED_MAX_TOKENS = 4_096;

/** The whole answer when the passages answer nothing. */
export const NOTHING_ANSWERS = 'Nothing in your library answers this.';

/** How an answer is written: it is often passed on to another agent, where formatting gets in the way. */
const PLAIN =
  'Write plain text in short paragraphs. Do not use Markdown or other formatting: no headings, bold, italics, tables or code blocks.';

/** What the provider is told: to answer from the passages only, and how to cite and to give up. */
const SYSTEM = `You answer a question from numbered passages of the user's own saved web pages, and only from them. Use no knowledge from outside the passages. Cite every statement with the number of its source as [n], for example [1]. If the passages do not answer the question, answer exactly: ${NOTHING_ANSWERS} ${PLAIN}`;

/** What the provider is told for a detailed answer: the same rules, and to be thorough. */
const DETAILED_SYSTEM = `${SYSTEM}

Otherwise write a detailed, thorough answer: explain the topic fully, bring in every relevant point the passages make, compare what different sources say, and include specifics such as steps, examples, figures and caveats. Keep it plain text, as above.`;

/** One source of an answer: a link its passages came from, numbered from 1. */
interface Source {
  n: number;
  link: ReturnType<typeof toView>;
}

/** What the provider is asked for before retrieval: the question as search queries. */
const phrasingsPrompt = (question: string) =>
  `A user asks a question of their own library of saved web pages. The pages are found by search, by their words and by their meaning. Write search queries for the question: first the question restated as one search query, then at most two other ways of asking for the same thing, in words the pages that answer it are likely to use. Each query is at most ${PHRASING_MAX} characters, in the language of the question. Do not answer the question.\n\nQuestion: ${question}`;

/**
 * The phrasings of a provider's answer that can be used: strings of 1 to
 * PHRASING_MAX characters once their spaces are collapsed, the first
 * PHRASINGS_MAX of them, none twice and none the question itself.
 */
export function usablePhrasings(value: unknown, question: string): string[] {
  const list = (value as { phrasings?: unknown } | null)?.phrasings;
  if (!Array.isArray(list)) return [];
  const seen = new Set([question.toLowerCase()]);
  const out: string[] = [];
  for (const item of list as unknown[]) {
    const text = typeof item === 'string' ? item.replace(/\s+/g, ' ').trim() : '';
    if (!text || text.length > PHRASING_MAX || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
    if (out.length === PHRASINGS_MAX) break;
  }
  return out;
}

/** A passage an answer is written from, with the passages before and after it in its link. */
interface Excerpt {
  found: FoundPassage;
  before: string | null;
  after: string | null;
}

/** The passages before and after each found passage in its link, where the link has them. */
async function withNeighbours(
  db: D1Database,
  userId: string,
  passages: FoundPassage[],
): Promise<Excerpt[]> {
  if (passages.length === 0) return [];
  const wanted = passages.flatMap((p) =>
    [p.position - 1, p.position + 1].map((n) => `${p.link_id}:${p.version}:${n}`),
  );
  const rows = await db
    .prepare(
      `SELECT vector_id, text FROM link_passages
       WHERE user_id = ? AND vector_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(userId, JSON.stringify(wanted))
    .all<{ vector_id: string; text: string }>();
  const texts = new Map(rows.results.map((r) => [r.vector_id, r.text]));
  return passages.map((found) => ({
    found,
    before: texts.get(`${found.link_id}:${found.version}:${found.position - 1}`) ?? null,
    after: texts.get(`${found.link_id}:${found.version}:${found.position + 1}`) ?? null,
  }));
}

/**
 * The text of each source for the provider: its passages in the order of the
 * page, each with its neighbours, passages that touch or overlap joined so
 * that shared text appears once, and gaps marked. At most `max` characters in
 * all: over that, neighbours are dropped from the lowest-ranked source up.
 */
export function sourceTexts(
  excerpts: Excerpt[],
  numbers: Map<string, number>,
  max: number,
): Map<number, string> {
  const build = (keepNeighbours: (n: number) => boolean) => {
    const pieces = new Map<number, Map<number, string>>();
    for (const e of excerpts) {
      const n = numbers.get(e.found.link_id)!;
      const ofSource = pieces.get(n) ?? new Map<number, string>();
      ofSource.set(e.found.position, e.found.passage);
      if (keepNeighbours(n)) {
        if (e.before !== null && !ofSource.has(e.found.position - 1)) {
          ofSource.set(e.found.position - 1, e.before);
        }
        if (e.after !== null && !ofSource.has(e.found.position + 1)) {
          ofSource.set(e.found.position + 1, e.after);
        }
      }
      pieces.set(n, ofSource);
    }
    const texts = new Map<number, string>();
    for (const [n, ofSource] of pieces) {
      const positions = [...ofSource.keys()].sort((a, b) => a - b);
      let text = '';
      positions.forEach((position, i) => {
        const piece = ofSource.get(position)!;
        const previous = positions[i - 1];
        if (previous === undefined) text = piece;
        else if (previous === position - 1) {
          text += `\n${withoutOverlap(ofSource.get(previous)!, piece)}`;
        } else text += `\n[…]\n${piece}`;
      });
      texts.set(n, text);
    }
    return texts;
  };
  const size = (texts: Map<number, string>) =>
    [...texts.values()].reduce((sum, t) => sum + t.length, 0);
  const sources = [...new Set(numbers.values())].sort((a, b) => b - a);
  let dropped = 0;
  let texts = build(() => true);
  while (size(texts) > max && dropped < sources.length) {
    dropped++;
    const without = new Set(sources.slice(0, dropped));
    texts = build((n) => !without.has(n));
  }
  return texts;
}

/** A source's heading for the provider: its number, title, topic path, host, the day it was added and its summary. */
function heading(n: number, link: LinkRow): string {
  const topic = parseStrings(link.topic_path_json).join(' > ');
  return [
    `[${n}] ${link.title}`,
    topic && `Topic: ${topic}`,
    `Host: ${link.host}`,
    `Added: ${link.added_at.slice(0, 10)}`,
    link.summary && `Summary: ${link.summary}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** The request to the provider: each source headed by its number and what is known of it, its passages, then the question. */
function answerRequest(
  sources: { n: number; row: LinkRow }[],
  texts: Map<number, string>,
  words: string[],
  detailed: boolean,
): AnswerRequest {
  const cited = sources.map((s) => `${heading(s.n, s.row)}\n\n${texts.get(s.n) ?? ''}`);
  const prompt = `${cited.join('\n\n')}\n\nQuestion: ${words.join(' ')}`;
  return detailed
    ? { system: DETAILED_SYSTEM, prompt, maxTokens: DETAILED_MAX_TOKENS }
    : { system: SYSTEM, prompt };
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
  const detailed = body.body.detailed ?? false;
  if (typeof detailed !== 'boolean') {
    return validationError(c, 'invalid_detailed', 'detailed', 'detailed must be true or false');
  }
  const parsed = parseQuery(question, QUESTION_MAX, { prose: true });
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

  const apiKey = await decryptKey(c.env, settings.ciphertext, settings.iv, userId);
  const call = { provider: settings.provider, apiKey, model: settings.model, userId };

  // The question as its author wrote it comes first: the reranker reads the passages against it.
  const typed = parsed.words.join(' ');
  const queries = [typed];
  const phrased = await phrasingsWith(c.env, call, phrasingsPrompt(typed));
  if (phrased.ok) {
    queries.push(...usablePhrasings(phrased.value, typed));
  } else if (phrased.kind === 'rejected') {
    await markKeyRejected(c.env.DB, userId, phrased.message);
    return refusal(c, 409, 'ai_key_rejected', phrased.message);
  }
  // Any other failure of the rephrasing leaves the question as typed.

  let found;
  try {
    found = await findPassages(
      c.env,
      userId,
      queries.map((q) => q.split(' ')),
      parsed.filters,
      detailed ? DETAILED_PASSAGES : ASK_PASSAGES,
    );
  } catch (err) {
    console.error('finding passages failed', err);
    return refusal(c, 503, 'search_unavailable', 'search by meaning is unavailable, try again');
  }
  const passages = found.passages;

  // The sources are numbered in the order of their best passage, which comes first.
  const numbers = new Map<string, number>();
  for (const p of passages) if (!numbers.has(p.link_id)) numbers.set(p.link_id, numbers.size + 1);
  const cited: { n: number; row: LinkRow }[] = [];
  for (const [id, n] of numbers) {
    const row = await getLink(c.env.DB, userId, id);
    if (row) cited.push({ n, row });
  }
  const sources: Source[] = cited.map(({ n, row }) => ({ n, link: toView(row) }));
  const texts = sourceTexts(
    await withNeighbours(c.env.DB, userId, passages),
    numbers,
    detailed ? DETAILED_CONTEXT_MAX : ASK_CONTEXT_MAX,
  );
  // The question is accepted and its answer starts: it counts, whatever the provider does.
  await countStatement(c.env.DB, { userId, at: now(), counter: 'asks' }).run();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(event('sources', { sources, queries, meaning: found.meaning }));
        if (passages.length === 0) {
          controller.enqueue(event('delta', { text: NOTHING_ANSWERS }));
          controller.enqueue(event('done', {}));
          return;
        }
        const outcome = await streamAnswer(
          c.env,
          call,
          answerRequest(cited, texts, parsed.words, detailed),
          (text) => void controller.enqueue(event('delta', { text })),
        );
        if (outcome.ok) {
          controller.enqueue(event('done', {}));
        } else if (outcome.kind === 'rejected') {
          // As a rejected enrichment does: the owner sees the key marked, and enrichment pauses.
          await markKeyRejected(c.env.DB, userId, outcome.message);
          controller.enqueue(
            event('error', { error: 'ai_key_rejected', message: outcome.message }),
          );
        } else {
          const error = outcome.kind === 'unavailable' ? 'provider_unavailable' : 'provider_failed';
          controller.enqueue(event('error', { error, message: outcome.message }));
        }
      } catch (err) {
        console.error('answering a question failed', err);
        controller.enqueue(
          event('error', { error: 'provider_failed', message: 'something went wrong, try again' }),
        );
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
});

/**
 * Passages: the pieces of the owner's links that best answer a question by
 * meaning. GET /api/v1/passages returns them; findPassages is what searching
 * by meaning and asking the library build on.
 */
import { Hono } from 'hono';
import { refusal, validationError } from '../api/errors';
import type { AppEnv, Env } from '../env';
import { filterConditions, parseQuery, type Filters } from '../search/query';
import { meaningBackend, QUERY_TOP_K, SIMILARITY_THRESHOLD, type VectorMatch } from './backend';

/** The passages a request returns when it names no limit. */
export const DEFAULT_PASSAGES = 8;
/** The most passages a request may ask for. */
export const MAX_PASSAGES = 20;
/** The most passages of one link a request returns. */
export const PASSAGES_PER_LINK = 3;
/** How long the embedding and the query may take together, in milliseconds. */
export const MEANING_TIMEOUT_MS = 5_000;

/** A passage of a link, as GET /api/v1/passages returns it. */
export interface Passage {
  link_id: string;
  title: string;
  /** The link's original URL. */
  url: string;
  passage: string;
  /** The passage's similarity to the question, from the similarity threshold up to 1. */
  score: number;
}

/** Workers AI or Vectorize failed, or did not answer in time. */
export class MeaningUnavailable extends Error {}

/** The vectors nearest to the question, or MeaningUnavailable. */
async function nearest(env: Env, userId: string, question: string): Promise<VectorMatch[]> {
  const backend = meaningBackend(env);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new MeaningUnavailable('search by meaning timed out')),
      MEANING_TIMEOUT_MS,
    );
  });
  const search = async () => {
    const [vector] = await backend.embed([question]);
    if (!vector) throw new Error('no embedding of the question');
    return backend.query(userId, vector, QUERY_TOP_K);
  };
  try {
    return await Promise.race([search(), timeout]);
  } catch (err) {
    throw err instanceof MeaningUnavailable
      ? err
      : new MeaningUnavailable(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

/** A stored passage with the link it belongs to. */
interface PassageRow {
  vector_id: string;
  link_id: string;
  position: number;
  text: string;
  title: string;
  original_url: string;
}

/**
 * The passages of the user's links that best match the free words by meaning,
 * best first: those scoring at least the similarity threshold, of links
 * satisfying the filters, at most three of a link and at most `limit` in all.
 * The index is only a guide to which passages to look at: every passage
 * returned is read from the user's own rows, so the vector of a deleted link
 * or of another user's link is never returned. Throws MeaningUnavailable.
 */
export async function findPassages(
  env: Env,
  userId: string,
  words: string[],
  filters: Filters,
  limit: number,
): Promise<Passage[]> {
  const matches = (await nearest(env, userId, words.join(' '))).filter(
    (m) => m.score >= SIMILARITY_THRESHOLD,
  );
  if (matches.length === 0) return [];
  const where = filterConditions(filters);
  const rows = await env.DB.prepare(
    `SELECT p.vector_id, p.link_id, p.position, p.text, l.title, l.original_url
     FROM link_passages p JOIN links l ON l.id = p.link_id
     WHERE p.user_id = ? AND l.user_id = ? AND p.vector_id IN (SELECT value FROM json_each(?))
       ${where.sql.map((c) => `AND ${c}`).join(' ')}`,
  )
    .bind(userId, userId, JSON.stringify(matches.map((m) => m.id)), ...where.params)
    .all<PassageRow>();
  const scores = new Map(matches.map((m) => [m.id, m.score]));
  const ranked = rows.results
    .map((row) => ({ row, score: scores.get(row.vector_id)! }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.row.link_id < b.row.link_id ? -1 : a.row.link_id > b.row.link_id ? 1 : 0) ||
        a.row.position - b.row.position,
    );
  const perLink = new Map<string, number>();
  const found: Passage[] = [];
  for (const { row, score } of ranked) {
    const taken = perLink.get(row.link_id) ?? 0;
    if (taken >= PASSAGES_PER_LINK) continue;
    perLink.set(row.link_id, taken + 1);
    found.push({
      link_id: row.link_id,
      title: row.title,
      url: row.original_url,
      passage: row.text,
      score,
    });
    if (found.length === limit) break;
  }
  return found;
}

/** The limit a request asks for, or null when it is not an integer from 1 to MAX_PASSAGES. */
function parseLimit(value: string | undefined): number | null {
  if (value === undefined) return DEFAULT_PASSAGES;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= MAX_PASSAGES ? n : null;
}

/** GET /api/v1/passages. */
export const passageRoutes = new Hono<AppEnv>();

passageRoutes.get('/', async (c) => {
  const parsed = parseQuery(c.req.query('q') ?? '');
  if (!parsed.ok) return validationError(c, parsed.error, 'q', parsed.message);
  if (parsed.words.length === 0) {
    return validationError(c, 'invalid_question', 'q', 'ask with at least one word');
  }
  const limit = parseLimit(c.req.query('limit'));
  if (limit === null) {
    return validationError(
      c,
      'invalid_limit',
      'limit',
      `limit must be an integer from 1 to ${MAX_PASSAGES}`,
    );
  }
  try {
    const items = await findPassages(c.env, c.get('user').id, parsed.words, parsed.filters, limit);
    return c.json({ items, meaning: 'used' });
  } catch (err) {
    if (!(err instanceof MeaningUnavailable)) throw err;
    console.error('search by meaning is unavailable', err);
    return refusal(c, 503, 'search_unavailable', 'search by meaning is unavailable, try again');
  }
});

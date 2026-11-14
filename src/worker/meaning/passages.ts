/**
 * Passages: the pieces of the owner's links that best answer a query.
 * findPassages is the one procedure hybrid search, GET /api/v1/passages and
 * asking the library all find them with: candidates by words and by meaning,
 * fused, then ordered by the reranker (ADR 10).
 */
import { Hono } from 'hono';
import { refusal, validationError } from '../api/errors';
import type { AppEnv, Env } from '../env';
import type { PassageKind } from './cut';
import { andAll, filterConditions, parseQuery, type Filters } from '../search/query';
import { ownerTerm } from '../search/search';
import {
  meaningBackend,
  QUERY_TOP_K,
  RELEVANCE_THRESHOLD,
  SIMILARITY_THRESHOLD,
  type VectorFilter,
  type VectorMatch,
} from './backend';

/** The passages a request returns when it names no limit. */
export const DEFAULT_PASSAGES = 8;
/** The most passages a request may ask for. */
export const MAX_PASSAGES = 20;
/** The most passages of one link a request returns. */
export const PASSAGES_PER_LINK = 3;
/** How long finding passages may wait for the embedding, the index and the reranker, in milliseconds. */
export const MEANING_TIMEOUT_MS = 5_000;
/** The share of that wait the embedding and the index may take; the reranker has what is left. */
const NEAREST_SHARE = 0.6;
/** How many passages a query's words find at most. */
export const WORD_CANDIDATES = 100;
/** How many fused candidates the reranker reads. */
export const RERANK_CANDIDATES = 50;
/** The constant of reciprocal rank fusion: a rank r contributes 1 / (60 + r). */
const RRF_K = 60;

/** How a passage or a link was found. */
export type MatchKind = 'keyword' | 'meaning' | 'both';

/**
 * Whether meaning took part in an answer: `used`; `unranked` when the index
 * answered and the reranker did not; `unavailable` when the index did not.
 */
export type Meaning = 'used' | 'unranked' | 'unavailable';

/** A passage of a link, as GET /api/v1/passages returns it. */
export interface Passage {
  link_id: string;
  title: string;
  /** The link's original URL. */
  url: string;
  passage: string;
  /**
   * The reranker's relevance, 0 to 1; with `unranked`, the similarity of a
   * passage found by meaning and null for one found by words alone; with
   * `unavailable`, null.
   */
  score: number | null;
  match: MatchKind;
}

/** A passage found, with where it sits in its link. */
export interface FoundPassage extends Passage {
  vector_id: string;
  position: number;
  version: number;
}

/** The passages found for a query, best first, and whether meaning took part. */
export interface Found {
  passages: FoundPassage[];
  meaning: Meaning;
}

/** Workers AI or Vectorize failed, or did not answer in time. */
export class MeaningUnavailable extends Error {}

/** `work`, or MeaningUnavailable when it fails or has not answered within `ms`. */
async function within<T>(work: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new MeaningUnavailable('search by meaning timed out')), ms);
  });
  try {
    return await Promise.race([work(), timeout]);
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
  version: number;
  text: string;
  title: string;
  original_url: string;
}

const ROW = 'p.vector_id, p.link_id, p.position, p.version, p.text, l.title, l.original_url';

/** The user's passages with these vector ids, of links satisfying the filters. */
async function passageRows(
  db: D1Database,
  userId: string,
  ids: string[],
  filters: Filters,
): Promise<Map<string, PassageRow>> {
  if (ids.length === 0) return new Map();
  const where = filterConditions(filters);
  const rows = await db
    .prepare(
      `SELECT ${ROW} FROM link_passages p JOIN links l ON l.id = p.link_id
       WHERE p.user_id = ? AND l.user_id = ? AND p.vector_id IN (SELECT value FROM json_each(?))
         ${andAll(where)}`,
    )
    .bind(userId, userId, JSON.stringify(ids), ...where.params)
    .all<PassageRow>();
  return new Map(rows.results.map((r) => [r.vector_id, r]));
}

/**
 * The user's passages, of links satisfying the filters, that hold at least one
 * of the words, best first: more of the words, and rarer ones, rank higher.
 */
async function passagesByWords(
  db: D1Database,
  userId: string,
  words: string[],
  filters: Filters,
): Promise<PassageRow[]> {
  const terms = words
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
    .map((w) => `"${w.replace(/"/g, '""')}"`);
  if (terms.length === 0) return [];
  const where = filterConditions(filters);
  const rows = await db
    .prepare(
      `SELECT ${ROW} FROM passage_search
         JOIN link_passages p ON p.vector_id = passage_search.vector_id
         JOIN links l ON l.id = p.link_id
       WHERE passage_search MATCH ? AND p.user_id = ? AND l.user_id = ? ${andAll(where)}
       ORDER BY bm25(passage_search), p.vector_id LIMIT ?`,
    )
    .bind(
      `owner : "${ownerTerm(userId)}" AND text : (${terms.join(' OR ')})`,
      userId,
      userId,
      ...where.params,
      WORD_CANDIDATES,
    )
    .all<PassageRow>();
  return rows.results;
}

/**
 * The passages of the user's links nearest to the text by meaning alone, best
 * first: those whose similarity reaches `threshold`, of links satisfying the
 * filters, at most `perLink` of a link and `limit` in all, optionally of one
 * `kind`. Related links use it (ADR 06); finding passages for a query goes
 * through findPassages. Every passage returned is read from the user's own
 * rows. Throws MeaningUnavailable.
 */
export async function nearestPassages(
  env: Env,
  userId: string,
  text: string,
  filters: Filters,
  limit: number,
  {
    deadlineMs = MEANING_TIMEOUT_MS,
    perLink = PASSAGES_PER_LINK,
    threshold = SIMILARITY_THRESHOLD,
    kind,
  }: { deadlineMs?: number; perLink?: number; threshold?: number; kind?: PassageKind } = {},
): Promise<{ link_id: string; score: number }[]> {
  const filter: VectorFilter = kind ? { kind } : {};
  const backend = meaningBackend(env);
  const matches = (
    await within(async () => {
      const [vector] = await backend.embed([text]);
      if (!vector) throw new Error('no embedding of the text');
      return backend.query(userId, vector, QUERY_TOP_K, filter);
    }, deadlineMs)
  ).filter((m) => m.score >= threshold);
  const rows = await passageRows(
    env.DB,
    userId,
    matches.map((m) => m.id),
    filters,
  );
  const counts = new Map<string, number>();
  const found: { link_id: string; score: number }[] = [];
  for (const m of matches) {
    const row = rows.get(m.id);
    if (!row) continue;
    const taken = counts.get(row.link_id) ?? 0;
    if (taken >= perLink) continue;
    counts.set(row.link_id, taken + 1);
    found.push({ link_id: row.link_id, score: m.score });
    if (found.length === limit) break;
  }
  return found;
}

/** A passage on its way through the procedure. */
interface Candidate {
  row: PassageRow;
  /** The sum of its reciprocal ranks over the lists that hold it. */
  fused: number;
  /** Whether a query's words found it. */
  byWords: boolean;
  /** Its best similarity to a query, when the index returned it. */
  similarity: number | null;
  relevance: number | null;
}

/**
 * The passages of the user's links that best answer a query, best first.
 * `queries` holds the query as its author wrote it, then any other phrasings
 * of it (asking the library adds them), each as its words. For each phrasing
 * the candidates are the 100 passages nearest by meaning and the 100 that
 * best match its words; all the lists are fused by reciprocal rank and the
 * best 50 are read by the reranker against the first query, whose relevance
 * orders them. A passage is returned when its relevance reaches the relevance
 * threshold; at most `perLink` of a link and `limit` in all, of links
 * satisfying the filters.
 *
 * `deadlineMs` bounds the embedding, the index and the reranker together.
 * When the reranker fails or is late the fused order stands (`unranked`):
 * passages found by meaning must then reach the similarity threshold, and
 * those found by words are kept. When the embedding or the index fails, the
 * passages found by words are used, reranked if the reranker answers
 * (`unavailable`). The index is only a guide: every passage returned is read
 * from the user's own rows. A failure of D1 throws.
 */
export async function findPassages(
  env: Env,
  userId: string,
  queries: string[][],
  filters: Filters,
  limit: number,
  {
    deadlineMs = MEANING_TIMEOUT_MS,
    perLink = PASSAGES_PER_LINK,
  }: { deadlineMs?: number; perLink?: number } = {},
): Promise<Found> {
  const started = Date.now();
  const backend = meaningBackend(env);
  const nearest: Promise<VectorMatch[][] | null> = within(async () => {
    const vectors = await backend.embed(queries.map((words) => words.join(' ')));
    if (vectors.length !== queries.length) throw new Error('no embedding of the query');
    return Promise.all(vectors.map((v) => backend.query(userId, v, QUERY_TOP_K)));
  }, deadlineMs * NEAREST_SHARE).catch((err: unknown) => {
    if (err instanceof MeaningUnavailable) return null;
    throw err;
  });
  const byWords = await Promise.all(
    queries.map((words) => passagesByWords(env.DB, userId, words, filters)),
  );
  const byMeaning = await nearest;
  const rows = await passageRows(
    env.DB,
    userId,
    [...new Set((byMeaning ?? []).flat().map((m) => m.id))],
    filters,
  );

  const candidates = new Map<string, Candidate>();
  const add = (row: PassageRow, rank: number, found: Partial<Candidate>) => {
    const have = candidates.get(row.vector_id) ?? {
      row,
      fused: 0,
      byWords: false,
      similarity: null,
      relevance: null,
    };
    have.fused += 1 / (RRF_K + rank + 1);
    if (found.byWords) have.byWords = true;
    if (found.similarity != null) {
      have.similarity = Math.max(have.similarity ?? 0, found.similarity);
    }
    candidates.set(row.vector_id, have);
  };
  for (const list of byWords) list.forEach((row, rank) => add(row, rank, { byWords: true }));
  for (const list of byMeaning ?? []) {
    let rank = 0;
    for (const m of list) {
      const row = rows.get(m.id);
      // The vector of a deleted link, of another user's or of a link the filters leave out.
      if (row) add(row, rank++, { similarity: m.score });
    }
  }
  const fused = [...candidates.values()]
    .sort((a, b) => b.fused - a.fused || (a.row.vector_id < b.row.vector_id ? -1 : 1))
    .slice(0, RERANK_CANDIDATES);

  let reranked = false;
  if (fused.length > 0) {
    try {
      const scores = await within(
        () =>
          backend.rerank(
            queries[0]!.join(' '),
            fused.map((c) => `${c.row.title}\n${c.row.text}`),
          ),
        Math.max(deadlineMs - (Date.now() - started), 0),
      );
      fused.forEach((c, i) => (c.relevance = scores[i] ?? 0));
      reranked = true;
    } catch (err) {
      if (!(err instanceof MeaningUnavailable)) throw err;
    }
  } else {
    reranked = true;
  }
  const meaning: Meaning = byMeaning === null ? 'unavailable' : reranked ? 'used' : 'unranked';

  const near = (c: Candidate) => c.similarity !== null && c.similarity >= SIMILARITY_THRESHOLD;
  const kept = reranked
    ? fused
        .map((c, order) => ({ c, order }))
        .filter(({ c }) => (c.relevance ?? 0) >= RELEVANCE_THRESHOLD)
        .sort((a, b) => b.c.relevance! - a.c.relevance! || a.order - b.order)
        .map(({ c }) => c)
    : fused.filter((c) => c.byWords || near(c));

  const counts = new Map<string, number>();
  const passages: FoundPassage[] = [];
  for (const c of kept) {
    const taken = counts.get(c.row.link_id) ?? 0;
    if (taken >= perLink) continue;
    counts.set(c.row.link_id, taken + 1);
    passages.push({
      link_id: c.row.link_id,
      title: c.row.title,
      url: c.row.original_url,
      passage: c.row.text,
      score:
        meaning === 'used' ? c.relevance : meaning === 'unranked' && near(c) ? c.similarity : null,
      match: c.byWords ? (near(c) ? 'both' : 'keyword') : 'meaning',
      vector_id: c.row.vector_id,
      position: c.row.position,
      version: c.row.version,
    });
    if (passages.length === limit) break;
  }
  return { passages, meaning };
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
    const found = await findPassages(
      c.env,
      c.get('user').id,
      [parsed.words],
      parsed.filters,
      limit,
    );
    return c.json({
      items: found.passages.map(({ link_id, title, url, passage, score, match }) => ({
        link_id,
        title,
        url,
        passage,
        score,
        match,
      })),
      meaning: found.meaning,
    });
  } catch (err) {
    // Without Workers AI or Vectorize the passages are found by their words; only D1 can fail here.
    console.error('finding passages failed', err);
    return refusal(c, 503, 'search_unavailable', 'search by meaning is unavailable, try again');
  }
});

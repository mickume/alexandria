/**
 * Search by meaning: the keyword matches of a query and the links whose
 * passages answer it (found by words and by meaning, ordered by the reranker:
 * meaning/passages.ts), in one ranking.
 *
 * The ranking has two tiers. First come the links whose title, tags and topic
 * together hold every free word (a strong keyword match); then every other
 * match, by keyword elsewhere, by meaning or both. Within a tier the links are
 * ordered by reciprocal rank fusion of the keyword ranking and the ranking of
 * each link's best passage, and links with equal scores by pin, last use and id, as keyword
 * search orders its ties. The tiers make it hold by construction that a strong
 * keyword match is never below a link found by meaning alone.
 */
import type { Env } from '../env';
import { meaningBackend } from '../meaning/backend';
import { findPassages, type MatchKind, type Meaning } from '../meaning/passages';
import { filterConditions, type Filters } from './query';
import {
  keywordMatches,
  linkMatch,
  SNIPPET_WORDS,
  strongMatchIds,
  type KeywordMatch,
  type Segment,
} from './search';

export type { MatchKind };

/** The constant of reciprocal rank fusion: a rank r contributes 1 / (60 + r). */
const RRF_K = 60;
/** How many keyword matches, best first, take part in the fusion; the rest follow in keyword order. */
export const FUSION_KEYWORD_MAX = 1_000;
/** How many links their passages add at most, each with its best passage. */
export const MEANING_CANDIDATES = 50;
/** How long a search waits for meaning and reranking together, in milliseconds. */
export const MEANING_DEADLINE_MS = 3_000;
/** How long a page waits for the reranker to choose its snippets, in milliseconds. */
export const SNIPPET_DEADLINE_MS = 1_500;

/** A link of the ranking, with how it matched and, for a meaning match, its best passage. */
export interface HybridEntry {
  id: string;
  match: MatchKind;
  /** The text of the best passage; set when the link matched by meaning. */
  passage?: string;
}

/** The whole ranking of a hybrid search, and whether meaning took part in it. */
export interface HybridRanking {
  entries: HybridEntry[];
  meaning: Meaning;
}

/** A link on its way to its place: what orders it. */
interface Candidate {
  id: string;
  strong: boolean;
  /** Where it falls in the keyword order past the fusion, or null when it takes part in it. */
  beyond: number | null;
  score: number;
  pin: number | null;
  used: string;
  entry: HybridEntry;
}

/** The rank of each item of `scores`, sorted best first: the number of items strictly better. */
function competitionRanks(scores: number[]): number[] {
  const ranks: number[] = [];
  scores.forEach((score, i) => ranks.push(i > 0 && score === scores[i - 1] ? ranks[i - 1]! : i));
  return ranks;
}

/** Orders two candidates: tier, then fused ones by score, ties by pin, last use and id. */
function byPlace(a: Candidate, b: Candidate): number {
  if (a.strong !== b.strong) return a.strong ? -1 : 1;
  if ((a.beyond === null) !== (b.beyond === null)) return a.beyond === null ? -1 : 1;
  if (a.beyond !== null && b.beyond !== null) return a.beyond - b.beyond;
  if (a.score !== b.score) return b.score - a.score;
  if ((a.pin === null) !== (b.pin === null)) return a.pin === null ? 1 : -1;
  if (a.pin !== null && b.pin !== null && a.pin !== b.pin) return a.pin - b.pin;
  if (a.used !== b.used) return a.used < b.used ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The words of `text`, in runs of at most SNIPPET_WORDS. */
function runs(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += SNIPPET_WORDS) {
    out.push(words.slice(i, i + SNIPPET_WORDS).join(' '));
  }
  return out;
}

/** A word as it is compared with the query's: lower-cased, without accents or punctuation. */
function plain(word: string): string {
  return word
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** `run` as segments, the words that are among the query's marked. */
function marked(run: string, words: string[]): Segment[] {
  const asked = new Set(words.map(plain).filter(Boolean));
  const out: Segment[] = [];
  for (const piece of run.split(/(\s+)/)) {
    const match = asked.has(plain(piece));
    const last = out[out.length - 1];
    if (last && last.match === match) last.text += piece;
    else if (piece) out.push({ text: piece, match });
  }
  return out;
}

/**
 * The snippet of each meaning match: the run of at most SNIPPET_WORDS words
 * of its best passage that the reranker scores highest against the query,
 * with the query's words marked in it. When the reranker fails or is late,
 * the start of each passage, unmarked.
 */
export async function passageSnippets(
  env: Env,
  words: string[],
  passages: { id: string; passage: string }[],
): Promise<Map<string, Segment[]>> {
  const out = new Map<string, Segment[]>();
  if (passages.length === 0) return out;
  const cut = passages.map((p) => ({ id: p.id, runs: runs(p.passage) }));
  let scores: number[] | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    scores = await Promise.race([
      meaningBackend(env).rerank(
        words.join(' '),
        cut.flatMap((c) => c.runs),
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), SNIPPET_DEADLINE_MS);
      }),
    ]);
  } catch (err) {
    console.error('choosing snippets with the reranker failed', err);
  } finally {
    clearTimeout(timer);
  }
  let at = 0;
  for (const c of cut) {
    let best = 0;
    if (scores) {
      for (let i = 1; i < c.runs.length; i++) {
        if ((scores[at + i] ?? 0) > (scores[at + best] ?? 0)) best = i;
      }
    }
    at += c.runs.length;
    const run = c.runs[best] ?? '';
    out.set(c.id, scores ? marked(run, words) : [{ text: run, match: false }]);
  }
  return out;
}

/** What the passages found say of their links: each link's rank and best passage. */
async function passageMatches(
  env: Env,
  userId: string,
  words: string[],
  filters: Filters,
): Promise<{
  found: { id: string; rank: number; passage: string; byMeaning: boolean }[];
  meaning: Meaning;
}> {
  const { passages, meaning } = await findPassages(
    env,
    userId,
    [words],
    filters,
    MEANING_CANDIDATES,
    { deadlineMs: MEANING_DEADLINE_MS, perLink: 1 },
  );
  // A link that is no keyword match is listed for a passage the reranker or the index vouches for.
  const vouched = passages.filter((p) => p.score !== null);
  const ranks = competitionRanks(vouched.map((p) => -p.score!));
  return {
    found: vouched.map((p, i) => ({
      id: p.link_id,
      rank: ranks[i]!,
      passage: p.passage,
      byMeaning: p.match !== 'keyword',
    })),
    meaning,
  };
}

/** The pin and last use of links that meaning found and the keyword search did not. */
async function placing(db: D1Database, userId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, KeywordMatch>();
  const rows = await db
    .prepare(
      `SELECT id, 0 AS score, pin_position, last_used_at FROM links
       WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))`,
    )
    .bind(userId, JSON.stringify(ids))
    .all<KeywordMatch>();
  return new Map(rows.results.map((r) => [r.id, r]));
}

/**
 * The ranking of a search with at least one free word: the keyword matches
 * (all of them), and the links one of whose passages answers the query, in
 * one order. The search waits MEANING_DEADLINE_MS for meaning and reranking:
 * without the reranker the passages are those the index vouches for
 * (`unranked`); without the index, the keyword matches alone (`unavailable`).
 */
export async function hybridRanking(
  env: Env,
  userId: string,
  words: string[],
  filters: Filters,
): Promise<HybridRanking> {
  const where = filterConditions(filters);
  const match = linkMatch(userId, words);
  const passagesPending = passageMatches(env, userId, words, filters);
  const [keyword, strong] = await Promise.all([
    match ? keywordMatches(env.DB, userId, match, where) : [],
    strongMatchIds(env.DB, userId, words, where),
  ]);
  const { found, meaning } = await passagesPending;
  if (meaning === 'unavailable') {
    return {
      entries: keyword.map((k) => ({ id: k.id, match: 'keyword' as const })),
      meaning,
    };
  }

  const keywordRanks = competitionRanks(keyword.map((k) => k.score));
  const candidates = new Map<string, Candidate>();
  keyword.forEach((k, i) => {
    const fused = i < FUSION_KEYWORD_MAX;
    candidates.set(k.id, {
      id: k.id,
      strong: strong.has(k.id),
      beyond: fused ? null : i,
      score: fused ? 1 / (RRF_K + keywordRanks[i]! + 1) : 0,
      pin: k.pin_position,
      used: k.last_used_at,
      entry: { id: k.id, match: 'keyword' },
    });
  });
  const known = await placing(
    env.DB,
    userId,
    found.map((f) => f.id).filter((id) => !candidates.has(id)),
  );
  for (const f of found) {
    const gain = 1 / (RRF_K + f.rank + 1);
    const have = candidates.get(f.id);
    if (have) {
      have.beyond = null;
      have.score += gain;
      // A passage found by its words alone says nothing the keyword match did not.
      if (f.byMeaning) have.entry = { id: f.id, match: 'both' };
      continue;
    }
    const row = known.get(f.id);
    if (!row) continue;
    candidates.set(f.id, {
      id: f.id,
      strong: false,
      beyond: null,
      score: gain,
      pin: row.pin_position,
      used: row.last_used_at,
      entry: { id: f.id, match: 'meaning', passage: f.passage },
    });
  }
  const ordered = [...candidates.values()].sort(byPlace);
  return { entries: ordered.map((c) => c.entry), meaning };
}

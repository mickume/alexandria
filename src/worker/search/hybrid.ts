/**
 * Search by meaning: the keyword matches of a query and the links whose
 * passages match it by meaning, in one ranking.
 *
 * The ranking has two tiers. First come the links whose title, tags and topic
 * together hold every free word (a strong keyword match); then every other
 * match, by keyword elsewhere, by meaning or both. Within a tier the links are
 * ordered by reciprocal rank fusion of the keyword ranking and the meaning
 * ranking, and links with equal scores by pin, last use and id, as keyword
 * search orders its ties. The tiers make it hold by construction that a strong
 * keyword match is never below a link found by meaning alone.
 */
import type { Env } from '../env';
import { findPassages, MeaningUnavailable } from '../meaning/passages';
import { filterConditions, type Filters } from './query';
import {
  keywordMatches,
  linkMatch,
  SNIPPET_WORDS,
  strongMatchIds,
  type KeywordMatch,
} from './search';

/** The constant of reciprocal rank fusion: a rank r contributes 1 / (60 + r). */
const RRF_K = 60;
/** How many keyword matches, best first, take part in the fusion; the rest follow in keyword order. */
export const FUSION_KEYWORD_MAX = 1_000;
/** How many links meaning adds at most, each with its best passage. */
export const MEANING_CANDIDATES = 100;
/** How long the embedding and the query may take, in milliseconds, before meaning is given up. */
export const MEANING_DEADLINE_MS = 600;

/** How a link matched a hybrid search. */
export type MatchKind = 'keyword' | 'meaning' | 'both';

/** A link of the ranking, with how it matched and, for a meaning match, its best passage. */
export interface HybridEntry {
  id: string;
  match: MatchKind;
  /** The text of the best passage; set when the link matched by meaning. */
  passage?: string;
}

/** The whole ranking of a hybrid search, and whether meaning could be added to it. */
export interface HybridRanking {
  entries: HybridEntry[];
  meaning: 'used' | 'unavailable';
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

/** The first `SNIPPET_WORDS` words of a passage, as one unmarked segment's text. */
export function passageSnippet(passage: string): string {
  return passage.trim().split(/\s+/).slice(0, SNIPPET_WORDS).join(' ');
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

/** What the passages found by meaning say of their links: score ranks and best passage text. */
async function meaningMatches(
  env: Env,
  userId: string,
  words: string[],
  filters: Filters,
): Promise<{ id: string; rank: number; passage: string }[] | null> {
  try {
    const found = await findPassages(env, userId, words, filters, MEANING_CANDIDATES, {
      deadlineMs: MEANING_DEADLINE_MS,
      perLink: 1,
    });
    const ranks = competitionRanks(found.map((p) => -p.score));
    return found.map((p, i) => ({ id: p.link_id, rank: ranks[i]!, passage: p.passage }));
  } catch (err) {
    if (err instanceof MeaningUnavailable) return null;
    throw err;
  }
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
 * (all of them), and the links whose best passage reaches the similarity
 * threshold, in one order. When Workers AI or Vectorize fails or is too slow
 * the ranking is the keyword matches alone, each `keyword`, `unavailable`.
 */
export async function hybridRanking(
  env: Env,
  userId: string,
  words: string[],
  filters: Filters,
): Promise<HybridRanking> {
  const where = filterConditions(filters);
  const match = linkMatch(userId, words);
  const meaningPending = meaningMatches(env, userId, words, filters);
  const [keyword, strong] = await Promise.all([
    match ? keywordMatches(env.DB, userId, match, where) : [],
    strongMatchIds(env.DB, userId, words, where),
  ]);
  const found = await meaningPending;
  if (found === null) {
    return {
      entries: keyword.map((k) => ({ id: k.id, match: 'keyword' as const })),
      meaning: 'unavailable',
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
      have.entry = { id: f.id, match: 'both' };
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
  return { entries: ordered.map((c) => c.entry), meaning: 'used' };
}

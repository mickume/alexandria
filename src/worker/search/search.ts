/** Search: the full-text index of the user's links, and the searches over it. */
import type { Env } from '../env';
import type { Conditions } from './query';

/** The most reader-view text the index holds for a link, in characters. */
export const INDEXED_TEXT_MAX = 500_000;

/**
 * The statement that makes `text` (or none, for null) the reader-view text
 * indexed for a link, replacing what was indexed before. The fetch worker
 * runs it in the batch that stores the text.
 */
export function indexReaderTextStatement(
  db: D1Database,
  linkId: string,
  text: string | null,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE link_search SET reader_text = ?
       WHERE rowid = (SELECT id FROM link_search_keys WHERE link_id = ?)`,
    )
    .bind((text ?? '').slice(0, INDEXED_TEXT_MAX), linkId);
}

/** Indexes `text` as the link's reader-view text, at most its first 500,000 characters. */
export async function indexReaderText(
  env: Env,
  linkId: string,
  text: string | null,
): Promise<void> {
  await indexReaderTextStatement(env.DB, linkId, text).run();
}

/** The term every index row of a user carries: 'u' and the user's id without hyphens. */
export function ownerTerm(userId: string): string {
  return `u${userId.replace(/-/g, '')}`;
}

/** The indexed text columns of a link's row, which free words are matched against. */
const LINK_COLUMNS = 'title tags topic summary host original_url note reader_text';
/** The bm25 weights of link_search's columns, in order (owner and link id weigh nothing). */
const LINK_WEIGHTS = '10.0, 5.0, 5.0, 3.0, 2.0, 2.0, 2.0, 1.0, 0.0, 0.0';
/** The longest snippet, in words. */
export const SNIPPET_WORDS = 32;

/** Whether a free word holds a character the index keeps: a letter or a digit. */
function searchable(word: string): boolean {
  return /[\p{L}\p{N}]/u.test(word);
}

/**
 * The FTS5 match expression that finds the user's rows holding every free
 * word as the prefix of a word, or null when no word has anything to match.
 * Each word is a quoted string, so the engine's operators and punctuation are
 * text, never syntax.
 */
export function matchExpression(userId: string, words: string[], columns: string): string | null {
  const phrases = words.filter(searchable).map((w) => `"${w.replace(/"/g, '""')}"*`);
  if (phrases.length === 0) return null;
  return `owner : "${ownerTerm(userId)}" AND {${columns}} : (${phrases.join(' AND ')})`;
}

/** A piece of a snippet: text, and whether it is a matched word. */
export interface Segment {
  text: string;
  match: boolean;
}

const OPEN = '\u0001';
const CLOSE = '\u0002';

/** Splits a snippet marked with OPEN and CLOSE into segments; never HTML. */
export function segments(marked: string): Segment[] {
  const out: Segment[] = [];
  for (const part of marked.split(OPEN)) {
    const close = part.indexOf(CLOSE);
    if (close >= 0) {
      out.push({ text: part.slice(0, close), match: true });
      if (close + 1 < part.length) out.push({ text: part.slice(close + 1), match: false });
    } else if (part) {
      out.push({ text: part, match: false });
    }
  }
  return out;
}

/** The SQL of a snippet from the best-matching column of `table`. */
function snippetSql(table: string): string {
  return `snippet(${table}, -1, char(1), char(2), '', ${SNIPPET_WORDS})`;
}

/** One link of a search's results, by id, with its snippet. */
export interface RankedLink {
  id: string;
  snippet: Segment[];
}

/**
 * One page of the user's links matching `match`, most relevant first (bm25,
 * title 10, tags and topic 5, summary 3, host, original URL and note 2,
 * reader text 1), then pinned by position, then the more recently used, then
 * by id; each with its snippet. Fetches one more than `limit`, so the caller
 * knows whether a next page exists.
 */
export async function rankedLinks(
  db: D1Database,
  userId: string,
  match: string,
  where: Conditions,
  limit: number,
  offset: number,
): Promise<RankedLink[]> {
  const conditions = where.sql.map((c) => `AND ${c}`).join(' ');
  const ranked = await db
    .prepare(
      `SELECT link_search.link_id AS id FROM link_search JOIN links l ON l.id = link_search.link_id
       WHERE link_search MATCH ? AND l.user_id = ? ${conditions}
       ORDER BY bm25(link_search, ${LINK_WEIGHTS}), l.pin_position IS NULL, l.pin_position,
         l.last_used_at DESC, l.id
       LIMIT ? OFFSET ?`,
    )
    .bind(match, userId, ...where.params, limit + 1, offset)
    .all<{ id: string }>();
  const ids = ranked.results.map((r) => r.id);
  if (ids.length === 0) return [];
  const snippets = await db
    .prepare(
      `SELECT link_id AS id, ${snippetSql('link_search')} AS snippet FROM link_search
       WHERE link_search MATCH ?
         AND rowid IN (SELECT id FROM link_search_keys WHERE link_id IN (SELECT value FROM json_each(?)))`,
    )
    .bind(match, JSON.stringify(ids))
    .all<{ id: string; snippet: string }>();
  const byId = new Map(snippets.results.map((r) => [r.id, r.snippet]));
  return ids.map((id) => ({ id, snippet: segments(byId.get(id) ?? '') }));
}

/** A workspace among a search's results. */
export interface WorkspaceResult {
  id: string;
  name: string;
  snippet: Segment[];
}

/** The most workspaces a search lists. */
const WORKSPACE_RESULTS = 50;

/** The user's workspaces whose name, description or note holds every free word, best first. */
export async function matchingWorkspaces(
  db: D1Database,
  userId: string,
  words: string[],
): Promise<WorkspaceResult[]> {
  const match = matchExpression(userId, words, 'name description note');
  if (!match) return [];
  const rows = await db
    .prepare(
      `SELECT w.id, w.name, ${snippetSql('workspace_search')} AS snippet
       FROM workspace_search JOIN workspaces w ON w.id = workspace_search.workspace_id
       WHERE workspace_search MATCH ? AND w.user_id = ?
       ORDER BY bm25(workspace_search, 10.0, 2.0, 1.0, 0.0, 0.0), w.name_key, w.id
       LIMIT ?`,
    )
    .bind(match, userId, WORKSPACE_RESULTS)
    .all<{ id: string; name: string; snippet: string }>();
  return rows.results.map((r) => ({ id: r.id, name: r.name, snippet: segments(r.snippet) }));
}

/** The match expression of a link search for the user's free words. */
export function linkMatch(userId: string, words: string[]): string | null {
  return matchExpression(userId, words, LINK_COLUMNS);
}

import { Hono, type Context } from 'hono';
import { validationError } from '../api/errors';
import { decodeCursor, encodeCursor, MAX_LIMIT, parseLimit } from '../api/pagination';
import type { AppEnv } from '../env';
import { toView, type LinkRow } from '../links/store';
import { isStreamCursor, listStream } from '../links/stream';
import { parseQuery } from './query';
import { linkMatch, matchingWorkspaces, rankedLinks, type Conditions } from './search';

/** GET /api/v1/search. */
export const searchRoutes = new Hono<AppEnv>();

/** Where a page of ranked results ends: the number of results before the next page. */
interface RankCursor {
  s: 'r';
  o: number;
}

function isRankCursor(value: unknown): value is RankCursor {
  const c = value as RankCursor | null;
  return typeof c === 'object' && c !== null && c.s === 'r' && Number.isInteger(c.o) && c.o > 0;
}

const NOT_ARCHIVED: Conditions = { sql: ["l.state <> 'archived'"], params: [] };

function invalidCursor(c: Context<AppEnv>) {
  return validationError(c, 'invalid_cursor', 'cursor', 'the cursor was not issued by this API');
}

/** The user's links with these ids, in the order of `ids`. */
async function linksInOrder(db: D1Database, userId: string, ids: string[]): Promise<LinkRow[]> {
  const rows = await db
    .prepare(
      'SELECT * FROM link_views WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))',
    )
    .bind(userId, JSON.stringify(ids))
    .all<LinkRow>();
  const byId = new Map(rows.results.map((r) => [r.id, r]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/** A query without free words: the stream, as GET /api/v1/links lists it, without snippets. */
async function streamPage(c: Context<AppEnv>, limit: number, raw: string | undefined) {
  let after = null;
  if (raw !== undefined) {
    after = await decodeCursor(c.env, raw);
    if (!isStreamCursor(after)) return invalidCursor(c);
  }
  const page = await listStream(c.env.DB, c.get('user').id, limit, after);
  return c.json({
    items: page.items.map((row) => ({ link: toView(row), snippet: [] })),
    workspaces: [],
    next_cursor: page.next ? await encodeCursor(c.env, page.next) : null,
  });
}

/** A query with free words: the matching links by relevance, and on the first page the workspaces. */
async function rankedPage(
  c: Context<AppEnv>,
  words: string[],
  limit: number,
  raw: string | undefined,
) {
  let offset = 0;
  if (raw !== undefined) {
    const cursor = await decodeCursor(c.env, raw);
    if (!isRankCursor(cursor)) return invalidCursor(c);
    offset = cursor.o;
  }
  const userId = c.get('user').id;
  const match = linkMatch(userId, words);
  const ranked = match
    ? await rankedLinks(c.env.DB, userId, match, NOT_ARCHIVED, limit, offset)
    : [];
  const page = ranked.slice(0, limit);
  const rows = await linksInOrder(
    c.env.DB,
    userId,
    page.map((r) => r.id),
  );
  const snippets = new Map(page.map((r) => [r.id, r.snippet]));
  return c.json({
    items: rows.map((row) => ({ link: toView(row), snippet: snippets.get(row.id) ?? [] })),
    workspaces: offset === 0 ? await matchingWorkspaces(c.env.DB, userId, words) : [],
    next_cursor:
      ranked.length > limit ? await encodeCursor(c.env, { s: 'r', o: offset + limit }) : null,
  });
}

searchRoutes.get('/', async (c) => {
  const parsed = parseQuery(c.req.query('q') ?? '');
  if (!parsed.ok) return validationError(c, parsed.error, 'q', parsed.message);
  const limit = parseLimit(c.req.query('limit'));
  if (limit === null) {
    return validationError(
      c,
      'invalid_limit',
      'limit',
      `limit must be an integer from 1 to ${MAX_LIMIT}`,
    );
  }
  const raw = c.req.query('cursor');
  return parsed.words.length === 0
    ? streamPage(c, limit, raw)
    : rankedPage(c, parsed.words, limit, raw);
});

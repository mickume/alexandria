import { Hono, type Context } from 'hono';
import { notFound, readJson, refusal, validationError } from '../api/errors';
import { decodeCursor, encodeCursor, MAX_LIMIT, parseLimit } from '../api/pagination';
import type { AppEnv } from '../env';
import { toView, type LinkRow } from '../links/store';
import { queueIndexing } from '../meaning/indexing';
import { isStreamCursor, listStream } from '../links/stream';
import { filterConditions, parseQuery, type Filters } from './query';
import { linkMatch, matchingWorkspaces, rankedLinks } from './search';
import {
  carrierIds,
  isVocabularyCursor,
  listVocabularyItems,
  mergeEntry,
  parseName,
  renameEntry,
  TAG_NAME_MAX,
  TOPIC_NAME_MAX,
  type VocabularyKind,
} from './vocabulary';

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

/**
 * A query without free words: the links satisfying its filters in stream
 * order, as GET /api/v1/links lists them, without snippets.
 */
async function streamPage(
  c: Context<AppEnv>,
  filters: Filters,
  limit: number,
  raw: string | undefined,
) {
  let after = null;
  if (raw !== undefined) {
    after = await decodeCursor(c.env, raw);
    if (!isStreamCursor(after)) return invalidCursor(c);
  }
  const where = filterConditions(filters);
  const page = await listStream(c.env.DB, c.get('user').id, limit, after, where);
  return c.json({
    items: page.items.map((row) => ({ link: toView(row), snippet: [] })),
    workspaces: [],
    next_cursor: page.next ? await encodeCursor(c.env, page.next) : null,
  });
}

/** A query with free words: the matching links by relevance, and on the first page the workspaces. */
async function rankedPage(
  c: Context<AppEnv>,
  { words, filters }: { words: string[]; filters: Filters },
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
    ? await rankedLinks(c.env.DB, userId, match, filterConditions(filters), limit, offset)
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
    ? streamPage(c, parsed.filters, limit, raw)
    : rankedPage(c, parsed, limit, raw);
});

/** GET /api/v1/topics or /api/v1/tags: the vocabulary of `kind`, newest first. */
function vocabularyRoutes(kind: VocabularyKind): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', async (c) => {
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
    let after = null;
    if (raw !== undefined) {
      after = await decodeCursor(c.env, raw);
      if (!isVocabularyCursor(after)) return invalidCursor(c);
    }
    const page = await listVocabularyItems(c.env.DB, c.get('user').id, kind, limit, after);
    return c.json({
      items: page.items,
      next_cursor: page.next ? await encodeCursor(c.env, page.next) : null,
    });
  });

  routes.patch('/:id', async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return parsed.response;
    const name = parseName(kind, parsed.body.name);
    if (name === null) {
      return validationError(c, 'invalid_name', 'name', NAME_RULE[kind]);
    }
    const userId = c.get('user').id;
    const id = c.req.param('id');
    const renamed = await renameEntry(c.env.DB, userId, kind, id, name);
    if (renamed === null) return notFound(c);
    if (renamed === 'taken') {
      const what = kind === 'topics' ? 'topic' : 'tag';
      return refusal(
        c,
        409,
        'name_taken',
        `another ${what} is named ${name}: merge this ${what} into it instead`,
      );
    }
    await queueIndexing(c.env, userId, await carrierIds(c.env.DB, userId, kind, id));
    return c.json(renamed);
  });

  routes.post('/:id/merge', async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return parsed.response;
    const id = c.req.param('id');
    const into = parsed.body.into;
    if (typeof into !== 'string' || into === '') {
      return validationError(c, 'invalid_merge', 'into', `into must name another of your ${kind}`);
    }
    if (into === id) {
      return validationError(
        c,
        'invalid_merge',
        'into',
        `a ${kind.slice(0, -1)} cannot merge into itself`,
      );
    }
    // The links the merge moves onto the survivor are the source's carriers.
    const userId = c.get('user').id;
    const moved = await carrierIds(c.env.DB, userId, kind, id);
    const merged = await mergeEntry(c.env.DB, userId, kind, id, into);
    if (!merged) return notFound(c);
    await queueIndexing(c.env, userId, moved);
    return c.json(merged);
  });
  return routes;
}

/** What a valid new name is, as the refusal of an invalid one says. */
const NAME_RULE: Record<VocabularyKind, string> = {
  tags: `a tag name of 1 to ${TAG_NAME_MAX} lower-case letters and digits in hyphen-joined words`,
  topics: `a topic name of 1 to ${TOPIC_NAME_MAX} characters`,
};

/** The topics, at /api/v1/topics. */
export const topicRoutes = vocabularyRoutes('topics');
/** The tags, at /api/v1/tags. */
export const tagRoutes = vocabularyRoutes('tags');

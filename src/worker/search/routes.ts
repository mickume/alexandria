import { Hono, type Context } from 'hono';
import { limitReached, notFound, readJson, refusal, validationError } from '../api/errors';
import { decodeCursor, encodeCursor, MAX_LIMIT, parseLimit } from '../api/pagination';
import type { AppEnv } from '../env';
import { toView, type LinkRow } from '../links/store';
import { queueIndexing } from '../meaning/indexing';
import { decryptKey, getAiSettings, markKeyRejected } from '../enrich/keys';
import { splitWith } from '../enrich/providers';
import { buildSplitPrompt } from '../enrich/enrich';
import { isStreamCursor, listStream } from '../links/stream';
import { filterConditions, parseQuery, type Filters } from './query';
import { hybridRanking, passageSnippet } from './hybrid';
import { linkMatch, matchingWorkspaces, rankedLinks, snippetsFor } from './search';
import {
  carrierIds,
  isVocabularyCursor,
  listVocabularyItems,
  applySplit,
  mergeEntry,
  moveTopic,
  prepareSplit,
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
  /** 'r' for a keyword ranking, 'h' for a hybrid one: a cursor is refused in the other mode. */
  s: 'r' | 'h';
  o: number;
}

function isRankCursor(value: unknown, kind: RankCursor['s'] = 'r'): value is RankCursor {
  const c = value as RankCursor | null;
  return typeof c === 'object' && c !== null && c.s === kind && Number.isInteger(c.o) && c.o > 0;
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
  hybrid: boolean,
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
    ...(hybrid ? { meaning: 'used' } : {}),
  });
}

/**
 * A hybrid query with free words: the keyword matches and the links found by
 * meaning in one ranking, paged by offset, each saying how it matched, and on
 * the first page the matching workspaces.
 */
async function hybridPage(
  c: Context<AppEnv>,
  { words, filters }: { words: string[]; filters: Filters },
  limit: number,
  raw: string | undefined,
) {
  let offset = 0;
  if (raw !== undefined) {
    const cursor = await decodeCursor(c.env, raw);
    if (!isRankCursor(cursor, 'h')) return invalidCursor(c);
    offset = cursor.o;
  }
  const userId = c.get('user').id;
  const ranking = await hybridRanking(c.env, userId, words, filters);
  const page = ranking.entries.slice(offset, offset + limit);
  const match = linkMatch(userId, words);
  const snippets = match
    ? await snippetsFor(
        c.env.DB,
        match,
        page.filter((e) => e.match !== 'meaning').map((e) => e.id),
      )
    : new Map();
  const rows = await linksInOrder(
    c.env.DB,
    userId,
    page.map((e) => e.id),
  );
  const entries = new Map(page.map((e) => [e.id, e]));
  return c.json({
    items: rows.map((row) => {
      const entry = entries.get(row.id)!;
      const snippet =
        entry.match === 'meaning'
          ? [{ text: passageSnippet(entry.passage ?? ''), match: false }]
          : (snippets.get(row.id) ?? []);
      return { link: toView(row), snippet, match: entry.match };
    }),
    workspaces: offset === 0 ? await matchingWorkspaces(c.env.DB, userId, words) : [],
    next_cursor:
      offset + limit < ranking.entries.length
        ? await encodeCursor(c.env, { s: 'h', o: offset + limit })
        : null,
    meaning: ranking.meaning,
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
  const mode = c.req.query('mode');
  if (mode !== undefined && mode !== 'keyword' && mode !== 'hybrid') {
    return validationError(c, 'invalid_mode', 'mode', 'mode takes keyword, hybrid');
  }
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
    ? streamPage(c, parsed.filters, limit, raw, mode === 'hybrid')
    : mode === 'hybrid'
      ? hybridPage(c, parsed, limit, raw)
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
    // A topic's name is in the path of every link beneath it.
    await queueIndexing(
      c.env,
      userId,
      await carrierIds(c.env.DB, userId, kind, id, { subtree: true }),
    );
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
    // The links the merge moves onto the survivor are the source's carriers,
    // and a topic's name is also in the path of every link beneath it.
    const userId = c.get('user').id;
    const moved = await carrierIds(c.env.DB, userId, kind, id, { subtree: true });
    const merged = await mergeEntry(c.env.DB, userId, kind, id, into);
    if (!merged) return notFound(c);
    if (typeof merged === 'string') return refusal(c, 409, merged, MERGE_REFUSALS[merged]);
    await queueIndexing(c.env, userId, moved);
    return c.json(merged);
  });
  return routes;
}

/** What a valid new name is, as the refusal of an invalid one says. */
const NAME_RULE: Record<VocabularyKind, string> = {
  tags: `a tag name of 1 to ${TAG_NAME_MAX} lower-case letters and digits in hyphen-joined words`,
  topics: `a topic name of 1 to ${TOPIC_NAME_MAX} characters, without >`,
};

/** What a merge of topics refused for each reason answers. */
const MERGE_REFUSALS = {
  invalid_merge: 'a topic cannot merge into a topic beneath it',
  too_deep: 'topics are at most three levels deep',
} as const;

/** The topics, at /api/v1/topics. */
export const topicRoutes = vocabularyRoutes('topics');

/** What a move refused for each reason answers. */
const MOVE_REFUSALS = {
  invalid_move: 'a topic cannot move under itself',
  too_deep: 'topics are at most three levels deep',
} as const;

topicRoutes.post('/:id/move', async (c) => {
  const parsed = await readJson(c);
  if (!parsed.ok) return parsed.response;
  const parent = parsed.body.parent;
  if (!('parent' in parsed.body) || (parent !== null && (typeof parent !== 'string' || !parent))) {
    return validationError(
      c,
      'invalid_move',
      'parent',
      'parent must be null or the id of another of your topics',
    );
  }
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const before = await carrierIds(c.env.DB, userId, 'topics', id, { subtree: true });
  const moved = await moveTopic(c.env.DB, userId, id, parent);
  if (moved === 'not_found') return notFound(c);
  if (typeof moved === 'string') return refusal(c, 409, moved, MOVE_REFUSALS[moved]);
  // Every link beneath the topic has a new path; the unchanged ones are not stale and are skipped.
  await queueIndexing(c.env, userId, before);
  return c.json(moved);
});
/** The tags, at /api/v1/tags. */
export const tagRoutes = vocabularyRoutes('tags');

/** What a split refused before the provider is asked answers. */
const SPLIT_REFUSALS = {
  too_deep: 'topics are at most three levels deep',
  too_few_links: 'a topic needs at least 20 links to be split',
  too_many_links: 'a topic with more than 500 links cannot be split at once',
} as const;

/** The fewest and the most sub-topics a split's answer may propose, and the longest name. */
const SPLIT_MIN_SUBTOPICS = 2;
const SPLIT_MAX_SUBTOPICS = 10;
const SUBTOPIC_NAME_MAX = 100;

/**
 * The provider's split as each sent link's sub-topic name ('' to leave it),
 * or null when it cannot be used: not 2 to 10 sub-topics, each 1 to 100
 * characters once its spaces are collapsed and without '>'; a link that was
 * not sent; or a link filed under a name that is not among the sub-topics
 * (ignoring case).
 */
function usableSplit(value: unknown, sent: Set<string>): Map<string, string> | null {
  const answer = value as { subtopics?: unknown; links?: unknown } | null;
  if (!answer || !Array.isArray(answer.subtopics) || !Array.isArray(answer.links)) return null;
  const clean = (name: unknown) =>
    typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : null;
  const names = answer.subtopics.map(clean);
  if (names.length < SPLIT_MIN_SUBTOPICS || names.length > SPLIT_MAX_SUBTOPICS) return null;
  if (names.some((n) => !n || n.length > SUBTOPIC_NAME_MAX || n.includes('>'))) return null;
  const proposed = new Map(names.map((n) => [n!.toLowerCase(), n!]));
  const assignments = new Map<string, string>();
  for (const link of answer.links as { id?: unknown; subtopic?: unknown }[]) {
    const name = clean(link?.subtopic);
    if (typeof link?.id !== 'string' || !sent.has(link.id) || name === null) return null;
    if (name !== '' && !proposed.has(name.toLowerCase())) return null;
    assignments.set(link.id, name === '' ? '' : proposed.get(name.toLowerCase())!);
  }
  return assignments;
}

topicRoutes.post('/:id/split', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const request = await prepareSplit(c.env.DB, userId, id);
  if (request === 'not_found') return notFound(c);
  if (typeof request === 'string') return refusal(c, 409, request, SPLIT_REFUSALS[request]);
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
  const outcome = await splitWith(
    c.env,
    { provider: settings.provider, apiKey, model: settings.model },
    buildSplitPrompt({
      topic: request.path.at(-1)!,
      children: request.children,
      links: request.links,
    }),
  );
  // The provider's failures take Ask's codes.
  if (!outcome.ok && outcome.kind === 'rejected') {
    await markKeyRejected(c.env.DB, userId, outcome.message);
    return refusal(c, 409, 'ai_key_rejected', outcome.message);
  }
  if (!outcome.ok && outcome.kind === 'unavailable') {
    return refusal(c, 503, 'provider_unavailable', outcome.message);
  }
  if (!outcome.ok) return refusal(c, 502, 'provider_failed', outcome.message);
  const assignments = usableSplit(outcome.value, new Set(request.links.map((l) => l.id)));
  if (!assignments) {
    return refusal(c, 502, 'provider_failed', "the provider's split could not be used");
  }
  const split = await applySplit(c.env.DB, userId, id, request.path, assignments);
  if (!split) return notFound(c);
  await queueIndexing(c.env, userId, split.movedIds);
  return c.json({ topic: split.topic, children: split.children, moved: split.moved });
});

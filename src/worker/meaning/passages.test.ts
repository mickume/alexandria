import { describe, expect, it } from 'vitest';
import { api, count, deliverIndexing, env, signIn, type TestUser } from '../test/helpers';
import { ARTICLES, meaning, seedArticle, type Article } from '../test/meaning';

interface Item {
  link_id: string;
  title: string;
  url: string;
  passage: string;
  score: number;
}

/** Indexes the links as the queue consumer would. */
async function index(user: TestUser, ids: string[]) {
  const r = await deliverIndexing(ids.map((link_id) => ({ user_id: user.id, link_id })));
  expect(r.retried).toEqual([]);
}

/** Seeds and indexes the articles; the links' ids, in order. */
async function indexed(user: TestUser, articles: Article[]): Promise<string[]> {
  const ids: string[] = [];
  for (const article of articles) ids.push(await seedArticle(user, article));
  await index(user, ids);
  return ids;
}

function passages(user: TestUser, query: string) {
  return api('GET', `/api/v1/passages${query}`, { as: user.session });
}

/** The use count and last use of every link. */
async function uses() {
  const rows = await env.DB.prepare(
    'SELECT id, use_count, last_used_at FROM links ORDER BY id',
  ).all();
  return rows.results;
}

const ask = (q: string, limit?: number) =>
  `?q=${encodeURIComponent(q)}${limit === undefined ? '' : `&limit=${limit}`}`;

describe('GET /api/v1/passages', () => {
  it.each([
    { q: 'run a task later', first: 0 },
    { q: 'tomato soil compost', first: 2 },
    { q: 'quarterly tax return', first: null },
  ])('returns the best passages for $q, best first, and records no use', async ({ q, first }) => {
    const user = await signIn();
    const links = [ARTICLES.alarms, ARTICLES.queues, ARTICLES.tomatoes];
    const ids = await indexed(user, links);
    const usesBefore = await count('link_uses');
    const linksBefore = await uses();

    const r = await passages(user, ask(q));

    expect(r.status).toBe(200);
    expect(r.json.meaning).toBe('used');
    const items: Item[] = r.json.items;
    if (first === null) {
      expect(items).toEqual([]);
    } else {
      expect(items[0]).toMatchObject({
        link_id: ids[first],
        title: links[first]!.title,
        url: links[first]!.url,
      });
      expect(items[0]!.passage.length).toBeGreaterThan(0);
      expect(items[0]!.passage.length).toBeLessThanOrEqual(1_500);
      expect(items.every((i) => i.link_id === ids[first])).toBe(true);
    }
    const scores = items.map((i) => i.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores.every((s) => s >= 0.5)).toBe(true);
    expect(await count('link_uses')).toBe(usesBefore);
    expect(await uses()).toEqual(linksBefore);
  });

  it('returns at most the limit, and at most three passages of one link', async () => {
    const user = await signIn();
    // One link with seven passages that match with a score of 1; six others with one passage each, below it.
    const big: Article = {
      url: 'https://big.example/',
      title: 'Scheduling notes',
      text: 'Schedule a task for later. '.repeat(330),
    };
    const others = Array.from({ length: 6 }, (_, i): Article => ({
      url: `https://other${i}.example/`,
      title: `Alarm ${i} worker`,
      text: null,
    }));
    const [bigId] = await indexed(user, [big, ...others]);

    const counts = await Promise.all(
      [undefined, 2, 20].map(async (limit) => {
        const r = await passages(user, ask('schedule a task', limit));
        expect(r.status).toBe(200);
        const items: Item[] = r.json.items;
        const perLink = Object.values(Object.groupBy(items, (i) => i.link_id)).map(
          (g) => g!.length,
        );
        expect(Math.max(...perLink)).toBeLessThanOrEqual(3);
        return { total: items.length, fromBig: items.filter((i) => i.link_id === bigId).length };
      }),
    );

    expect(counts).toEqual([
      { total: 8, fromBig: 3 },
      { total: 2, fromBig: 2 },
      { total: 9, fromBig: 3 },
    ]);
  });

  it.each([
    { filter: '', expected: [1, 2, 3] },
    { filter: 'state:archived', expected: [0] },
    { filter: 'state:any', expected: [0, 1, 2, 3] },
    { filter: 'tag:infra', expected: [1] },
    { filter: 'in:Research', expected: [2] },
    { filter: 'is:pinned', expected: [2] },
    { filter: 'host:docs.example', expected: [3] },
  ])('applies the filter "$filter" as search does', async ({ filter, expected }) => {
    const user = await signIn();
    const ids = await indexed(user, [
      { url: 'https://a.example/', title: 'Alarm archived', state: 'archived' },
      { url: 'https://b.example/', title: 'Alarm tagged', tags: ['infra'] },
      { url: 'https://c.example/', title: 'Alarm pinned' },
      { url: 'https://docs.example/alarm', title: 'Alarm on docs' },
    ]);
    await api('POST', `/api/v1/links/${ids[2]}/pin`, { as: user.session });
    const workspace = await api('POST', '/api/v1/workspaces', {
      as: user.session,
      body: { name: 'Research' },
    });
    await api('POST', `/api/v1/workspaces/${workspace.json.id}/links`, {
      as: user.session,
      body: { link_id: ids[2] },
    });

    const r = await passages(user, ask(`schedule a task ${filter}`));

    expect(r.status).toBe(200);
    expect(new Set((r.json.items as Item[]).map((i) => i.link_id))).toEqual(
      new Set(expected.map((i) => ids[i])),
    );
  });

  it('does not return the text a link had before it changed', async () => {
    const user = await signIn();
    const [id] = await indexed(user, [
      {
        url: 'https://notes.example/',
        title: 'Reading list',
        text: null,
        note: 'Schedule a task to run later.',
      },
    ]);
    expect(
      ((await passages(user, ask('run a task later'))).json.items as Item[]).map((i) => i.link_id),
    ).toEqual([id]);

    await api('PATCH', `/api/v1/links/${id}`, {
      as: user.session,
      body: { note: 'Compost the tomato soil.' },
    });
    await index(user, [id!]);

    // The vectors of the old text are still in the index; no passage of theirs is left to return.
    expect(meaning.index.all(user.id).length).toBeGreaterThan(1);
    expect((await passages(user, ask('run a task later'))).json.items).toEqual([]);
    expect(
      ((await passages(user, ask('tomato soil'))).json.items as Item[]).map((i) => i.link_id),
    ).toEqual([id]);
  });
});

describe('a passage request it refuses', () => {
  it.each([
    {
      query: '',
      status: 400,
      error: 'invalid_question',
      field: 'q',
      message: 'ask with at least one word',
    },
    {
      query: '?q=',
      status: 400,
      error: 'invalid_question',
      field: 'q',
      message: 'ask with at least one word',
    },
    {
      query: '?q=%20%20%20',
      status: 400,
      error: 'invalid_question',
      field: 'q',
      message: 'ask with at least one word',
    },
    {
      query: '?q=tag%3Ainfra',
      status: 400,
      error: 'invalid_question',
      field: 'q',
      message: 'ask with at least one word',
    },
    {
      query: `?q=${'a'.repeat(201)}`,
      status: 400,
      error: 'query_too_long',
      field: 'q',
      message: 'a query of at most 200 characters',
    },
    {
      query: '?q=alarms%20state%3Abogus',
      status: 400,
      error: 'invalid_filter',
      field: 'q',
      message: expect.stringContaining('state:bogus'),
    },
    {
      query: '?q=alarms&limit=0',
      status: 400,
      error: 'invalid_limit',
      field: 'limit',
      message: 'limit must be an integer from 1 to 20',
    },
    {
      query: '?q=alarms&limit=21',
      status: 400,
      error: 'invalid_limit',
      field: 'limit',
      message: 'limit must be an integer from 1 to 20',
    },
    {
      query: '?q=alarms&limit=x',
      status: 400,
      error: 'invalid_limit',
      field: 'limit',
      message: 'limit must be an integer from 1 to 20',
    },
  ])(
    'answers $error for "$query" without embedding anything',
    async ({ query, status, ...body }) => {
      const user = await signIn();

      const r = await passages(user, query);

      expect(r.status).toBe(status);
      expect(r.json).toEqual(body);
      expect(meaning.calls).toEqual([]);
    },
  );

  it.each([
    { name: 'the embedding fails', arrange: () => meaning.fail('embed') },
    { name: 'the index fails', arrange: () => meaning.fail('query') },
    { name: 'the embedding does not answer', arrange: () => meaning.stall('embed') },
  ])('answers 503 when $name', { timeout: 20_000 }, async ({ arrange }) => {
    const user = await signIn();
    await indexed(user, [ARTICLES.alarms]);
    arrange();
    const start = Date.now();

    const r = await passages(user, ask('alarms'));

    expect(r.status).toBe(503);
    expect(r.json).toEqual({
      error: 'search_unavailable',
      message: 'search by meaning is unavailable, try again',
    });
    expect(Date.now() - start).toBeLessThan(7_000);
  });
});

describe('passages and the users’ separation', () => {
  it('queries only the asking user’s namespace and returns only their links, even from an index that mixes users', async () => {
    const a = await signIn('a@example.test', 'A');
    const b = await signIn('b@example.test', 'B');
    const [aLink] = await indexed(a, [{ ...ARTICLES.alarms, url: 'https://a.example/alarms' }]);
    await indexed(b, [{ ...ARTICLES.alarms, url: 'https://b.example/alarms' }]);
    meaning.calls.length = 0;

    const first = await passages(a, ask('run a task later'));
    expect(first.status).toBe(200);
    expect(meaning.callsOf('query').map((c) => c.namespace)).toEqual([a.id]);

    meaning.ignoreNamespaces = true;
    const mixed = await passages(a, ask('run a task later'));
    expect(mixed.status).toBe(200);
    expect(mixed.json.items.length).toBeGreaterThan(0);
    expect((mixed.json.items as Item[]).every((i) => i.link_id === aLink)).toBe(true);
  });
});

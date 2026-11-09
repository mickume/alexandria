import { describe, expect, it } from 'vitest';
import { api, deliverIndexing, env, signIn, type TestUser } from '../test/helpers';
import { embedText } from '../test/embedder';
import { ARTICLES, meaning, seedArticle, type Article } from '../test/meaning';

/** GET /api/v1/search as the user. */
function search(user: TestUser, query: string, extra = '') {
  return api('GET', `/api/v1/search?q=${encodeURIComponent(query)}${extra}`, { as: user.session });
}

/** Indexes the links as the queue consumer would. */
async function index(user: TestUser, ids: string[]) {
  const r = await deliverIndexing(ids.map((link_id) => ({ user_id: user.id, link_id })));
  expect(r.retried).toEqual([]);
}

/** The three articles of the fixtures, the first tagged 'infra' and pinned later by a test, indexed. */
async function library(user: TestUser): Promise<string[]> {
  const ids = [
    await seedArticle(user, { ...ARTICLES.alarms, tags: ['infra'] }),
    await seedArticle(user, ARTICLES.queues),
    await seedArticle(user, ARTICLES.tomatoes),
  ];
  await index(user, ids);
  return ids;
}

describe('the search mode', () => {
  it.each(['cloudflare queues', 'tag:infra', '', 'cloudflare state:any', 'zzz-nothing'])(
    'answers "%s" byte for byte as before without a mode and with mode=keyword',
    async (query) => {
      const user = await signIn();
      await library(user);

      const bare = await search(user, query);
      const keyword = await search(user, query, '&mode=keyword');

      expect(keyword.status).toBe(bare.status);
      const text = await bare.response.clone().text();
      expect(await keyword.response.text()).toBe(text);
      expect(bare.json).not.toHaveProperty('meaning');
      for (const item of bare.json.items) expect(item).not.toHaveProperty('match');
    },
  );

  it.each(['', 'HYBRID', 'semantic', 'keyword,hybrid'])(
    'refuses mode "%s" without embedding anything',
    async (mode) => {
      const user = await signIn();
      await library(user);
      meaning.calls.length = 0;

      const r = await search(user, 'alarms', `&mode=${encodeURIComponent(mode)}`);

      expect(r.status).toBe(400);
      expect(r.json).toEqual({
        error: 'invalid_mode',
        field: 'mode',
        message: 'mode takes keyword, hybrid',
      });
      expect(meaning.calls).toEqual([]);
    },
  );

  it.each(['', '   ', 'tag:infra', 'state:expired', 'host:example.com'])(
    'answers the query "%s" of filters only or nothing as keyword does, with meaning used',
    async (query) => {
      const user = await signIn();
      await library(user);
      meaning.calls.length = 0;

      const keyword = await search(user, query, '&mode=keyword');
      const hybrid = await search(user, query, '&mode=hybrid');

      expect(hybrid.status).toBe(200);
      expect(hybrid.json).toEqual({ ...keyword.json, meaning: 'used' });
      expect(meaning.calls).toEqual([]);
    },
  );
});

interface Item {
  link: { id: string };
  snippet: { text: string; match: boolean }[];
  match?: 'keyword' | 'meaning' | 'both';
}

/** Seeds the articles, indexes those marked, and returns the links' ids in order. */
async function seed(user: TestUser, articles: (Article & { indexed?: boolean })[]) {
  const ids: string[] = [];
  for (const article of articles) ids.push(await seedArticle(user, article));
  await index(
    user,
    ids.filter((_, i) => articles[i]!.indexed !== false),
  );
  return ids;
}

const idsOf = (items: Item[]) => items.map((i) => i.link.id);

/** The ids of every page of a search, with the matching workspaces of each page. */
async function allPages(user: TestUser, query: string, mode: string, limit = 5) {
  const ids: string[] = [];
  const workspaces: number[] = [];
  let cursor: string | null = null;
  do {
    const extra: string = `&mode=${mode}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const r = await search(user, query, extra);
    expect(r.status).toBe(200);
    ids.push(...idsOf(r.json.items));
    workspaces.push(r.json.workspaces.length);
    cursor = r.json.next_cursor;
  } while (cursor);
  return { ids, workspaces };
}

describe('a search by meaning', () => {
  it('finds a link that shares no word with the query, and a query unrelated to everything finds nothing', async () => {
    const user = await signIn();
    const [alarms] = await seed(user, [
      ARTICLES.alarms,
      ARTICLES.queues,
      ARTICLES.tomatoes,
      { ...ARTICLES.alarms, url: `${ARTICLES.alarms.url}-expired`, state: 'expired' },
    ]);

    const keyword = await search(user, 'timer delay', '&mode=keyword');
    const hybrid = await search(user, 'timer delay', '&mode=hybrid');

    expect(keyword.json.items).toEqual([]);
    expect(hybrid.status).toBe(200);
    expect(hybrid.json.meaning).toBe('used');
    expect(idsOf(hybrid.json.items)).toEqual([alarms]);

    const unrelated = await search(user, 'quarterly tax return', '&mode=hybrid');
    expect(unrelated.json).toMatchObject({ items: [], meaning: 'used' });
  });

  it.each(['cloudflare', 'cloudflare queues', 'alarm', 'tomatoes compost'])(
    'returns every link the keyword search of "%s" returns, each once, across its pages',
    async (query) => {
      const user = await signIn();
      const articles: (Article & { indexed?: boolean })[] = Array.from({ length: 30 }, (_, i) => {
        const base = [ARTICLES.alarms, ARTICLES.queues, ARTICLES.tomatoes][i % 3]!;
        return {
          ...base,
          url: `${base.url}-${i}`,
          title: i % 2 === 0 ? `${base.title} ${i}` : `Note ${i}`,
          indexed: i % 4 !== 3,
        };
      });
      await seed(user, articles);

      const keyword = await allPages(user, query, 'keyword');
      const hybrid = await allPages(user, query, 'hybrid');

      expect(new Set(hybrid.ids).size).toBe(hybrid.ids.length);
      expect(hybrid.ids).toEqual(expect.arrayContaining(keyword.ids));
      expect(hybrid.ids.length).toBeGreaterThanOrEqual(keyword.ids.length);
    },
  );

  it.each(['cloudflare queues', 'queues'])(
    'ranks a title, tag or topic match above every link found by meaning alone for "%s"',
    async (query) => {
      const user = await signIn();
      const meaningOnly = (n: number): Article => ({
        url: `https://workers${n}.example/`,
        title: `Durable workers ${n}`,
        text: 'A worker and a durable object.',
      });
      const [title, tags] = await seed(user, [
        { ...ARTICLES.queues },
        // Unindexed, so only its tags make it a match: plain fusion would put the
        // three links of meaning alone, tied at the best rank, above it.
        {
          url: 'https://notes.example/',
          title: 'Notes',
          tags: ['cloudflare', 'queues'],
          indexed: false,
        },
        {
          url: 'https://reading.example/',
          title: 'Reading',
          note: 'cloudflare queues',
          indexed: false,
        },
        meaningOnly(1),
        meaningOnly(2),
        meaningOnly(3),
      ]);

      const r = await search(user, query, '&mode=hybrid');

      const items: Item[] = r.json.items;
      const first = items.findIndex((i) => i.match === 'meaning');
      expect(first).toBeGreaterThanOrEqual(0);
      expect(idsOf(items).slice(0, 2).sort()).toEqual([title, tags].sort());
      expect(items.slice(0, first).every((i) => i.match !== 'meaning')).toBe(true);
    },
  );

  it('breaks ties as keyword search does: pinned, then the more recently used, then by id', async () => {
    const user = await signIn();
    const same = (n: number): Article => ({
      url: `https://same${n}.example/`,
      title: `Alarm ${n}`,
      text: null,
    });
    const [older, newer, pinned] = await seed(user, [same(1), same(2), same(3)]);
    await env.DB.batch([
      env.DB.prepare('UPDATE links SET last_used_at = ? WHERE id = ?').bind(
        '2026-10-01T00:00:00.000Z',
        older!,
      ),
      env.DB.prepare('UPDATE links SET last_used_at = ? WHERE id = ?').bind(
        '2026-10-02T00:00:00.000Z',
        newer!,
      ),
    ]);
    expect((await api('POST', `/api/v1/links/${pinned}/pin`, { as: user.session })).status).toBe(
      200,
    );

    const r = await search(user, 'timer delay', '&mode=hybrid');

    expect(idsOf(r.json.items)).toEqual([pinned, newer, older]);
  });

  it.each([
    { suffix: '', expected: [1, 2, 3] },
    { suffix: 'state:expired', expected: [0] },
    { suffix: 'tag:infra', expected: [1] },
    { suffix: 'in:Research', expected: [2] },
    { suffix: 'host:docs.example', expected: [3] },
  ])('applies the filter "$suffix" to links found by meaning', async ({ suffix, expected }) => {
    const user = await signIn();
    const ids = await seed(user, [
      { url: 'https://a.example/', title: 'Alarm expired', text: null, state: 'expired' },
      { url: 'https://b.example/', title: 'Alarm tagged', text: null, tags: ['infra'] },
      { url: 'https://c.example/', title: 'Alarm filed', text: null },
      { url: 'https://docs.example/alarm', title: 'Alarm on docs', text: null },
    ]);
    const workspace = await api('POST', '/api/v1/workspaces', {
      as: user.session,
      body: { name: 'Research' },
    });
    await api('POST', `/api/v1/workspaces/${workspace.json.id}/links`, {
      as: user.session,
      body: { link_id: ids[2] },
    });

    const r = await search(user, `timer delay ${suffix}`, '&mode=hybrid');

    expect(new Set(idsOf(r.json.items))).toEqual(new Set(expected.map((i) => ids[i])));
  });

  it('pages one ranking: every result once, the workspaces on the first page only', async () => {
    const user = await signIn();
    await seed(
      user,
      Array.from({ length: 12 }, (_, i) =>
        i % 3 === 0
          ? {
              url: `https://k${i}.example/`,
              title: `Cloudflare keyword ${i}`,
              text: null,
              indexed: false,
            }
          : i % 3 === 1
            ? {
                url: `https://m${i}.example/`,
                title: `Durable workers ${i}`,
                text: 'A worker and a durable object.',
              }
            : {
                url: `https://b${i}.example/`,
                title: `Cloudflare both ${i}`,
                text: 'Cloudflare workers.',
              },
      ),
    );
    await api('POST', '/api/v1/workspaces', { as: user.session, body: { name: 'Cloudflare' } });

    const whole = await search(user, 'cloudflare', '&mode=hybrid&limit=100');
    const paged = await allPages(user, 'cloudflare', 'hybrid', 5);

    expect(whole.json.items).toHaveLength(12);
    expect(paged.ids).toEqual(idsOf(whole.json.items));
    expect(new Set(paged.ids).size).toBe(12);
    expect(paged.workspaces[0]).toBe(1);
    expect(paged.workspaces.slice(1).every((n) => n === 0)).toBe(true);
  });

  it('refuses a cursor of the other mode, and the refusals of keyword search stay', async () => {
    const user = await signIn();
    await seed(
      user,
      [1, 2, 3].map((n) => ({
        url: `https://c${n}.example/`,
        title: `Cloudflare ${n}`,
        text: null,
      })),
    );
    const keywordCursor = (await search(user, 'cloudflare', '&mode=keyword&limit=1')).json
      .next_cursor;
    const hybridCursor = (await search(user, 'cloudflare', '&mode=hybrid&limit=1')).json
      .next_cursor;
    expect(keywordCursor).toBeTruthy();
    expect(hybridCursor).toBeTruthy();
    expect(hybridCursor).not.toBe(keywordCursor);

    const refused = {
      error: 'invalid_cursor',
      field: 'cursor',
      message: 'the cursor was not issued by this API',
    };
    const a = await search(
      user,
      'cloudflare',
      `&mode=hybrid&cursor=${encodeURIComponent(keywordCursor)}`,
    );
    const b = await search(
      user,
      'cloudflare',
      `&mode=keyword&cursor=${encodeURIComponent(hybridCursor)}`,
    );
    expect([a.status, a.json]).toEqual([400, refused]);
    expect([b.status, b.json]).toEqual([400, refused]);

    for (const extra of ['&limit=0', '&limit=101']) {
      const k = await search(user, 'cloudflare', `&mode=keyword${extra}`);
      const h = await search(user, 'cloudflare', `&mode=hybrid${extra}`);
      expect([h.status, h.json]).toEqual([k.status, k.json]);
    }
    for (const query of ['x'.repeat(201), 'cloudflare state:bogus']) {
      const k = await search(user, query, '&mode=keyword');
      const h = await search(user, query, '&mode=hybrid');
      expect(h.status).toBe(400);
      expect([h.status, h.json]).toEqual([k.status, k.json]);
    }
  });
});

describe('how a hybrid result matched', () => {
  const library = (user: TestUser) =>
    seed(user, [
      { url: 'https://clocks.example/', title: 'Alarm clocks', text: null, indexed: false },
      {
        url: 'https://reading.example/',
        title: 'Reading list',
        text: ['schedule', 'a', 'task', ...Array.from({ length: 47 }, (_, i) => `filler${i}`)].join(
          ' ',
        ),
      },
      ARTICLES.alarms,
    ]);

  it('says keyword, meaning or both for each link', async () => {
    const user = await signIn();
    const [keywordOnly, meaningOnly, both] = await library(user);

    const r = await search(user, 'alarm', '&mode=hybrid');

    const matches = Object.fromEntries((r.json.items as Item[]).map((i) => [i.link.id, i.match]));
    expect(matches).toEqual({
      [keywordOnly!]: 'keyword',
      [meaningOnly!]: 'meaning',
      [both!]: 'both',
    });
  });

  it('snippets a meaning match with the start of its best passage and the others as keyword search does', async () => {
    const user = await signIn();
    const [keywordOnly, meaningOnly, both] = await library(user);

    const hybrid = await search(user, 'alarm', '&mode=hybrid');
    const keyword = await search(user, 'alarm', '&mode=keyword');

    const byId = (r: { json: { items: Item[] } }) =>
      new Map(r.json.items.map((i) => [i.link.id, i]));
    const h = byId(hybrid);
    const k = byId(keyword);
    const words = ['schedule', 'a', 'task', ...Array.from({ length: 29 }, (_, i) => `filler${i}`)];
    expect(h.get(meaningOnly!)!.snippet).toEqual([{ text: words.join(' '), match: false }]);
    expect(h.get(keywordOnly!)!.snippet).toEqual(k.get(keywordOnly!)!.snippet);
    expect(h.get(both!)!.snippet).toEqual(k.get(both!)!.snippet);
    expect(h.get(keywordOnly!)!.snippet.some((s) => s.match)).toBe(true);
  });
});

describe('a search by meaning while meaning is unavailable', () => {
  it.each([
    { name: 'the embedding fails', arrange: () => meaning.fail('embed') },
    { name: 'the index fails', arrange: () => meaning.fail('query') },
    { name: 'the embedding does not answer', arrange: () => meaning.stall('embed') },
  ])('answers with the keyword results when $name', { timeout: 20_000 }, async ({ arrange }) => {
    const user = await signIn();
    await seed(
      user,
      [1, 2, 3].map((n) => ({
        url: `https://queues${n}.example/`,
        title: `Cloudflare Queues explained ${n}`,
        text: 'Queues deliver messages.',
      })),
    );
    await api('POST', '/api/v1/workspaces', {
      as: user.session,
      body: { name: 'Cloudflare queues' },
    });
    const keyword = await search(user, 'cloudflare queues', '&mode=keyword&limit=2');
    arrange();
    const start = Date.now();

    const r = await search(user, 'cloudflare queues', '&mode=hybrid&limit=2');

    expect(Date.now() - start).toBeLessThan(1_500);
    expect(r.status).toBe(200);
    expect(r.json.meaning).toBe('unavailable');
    expect(idsOf(r.json.items)).toEqual(idsOf(keyword.json.items));
    expect((r.json.items as Item[]).every((i) => i.match === 'keyword')).toBe(true);
    expect(r.json.items.map((i: Item) => i.snippet)).toEqual(
      keyword.json.items.map((i: Item) => i.snippet),
    );
    expect(r.json.workspaces).toEqual(keyword.json.workspaces);
    // The next page continues the same results, still from the keyword matches.
    expect(r.json.next_cursor).toBeTruthy();
    const next = await search(
      user,
      'cloudflare queues',
      `&mode=hybrid&limit=2&cursor=${encodeURIComponent(r.json.next_cursor)}`,
    );
    expect(next.status).toBe(200);
    expect(idsOf(next.json.items)).toHaveLength(1);
    expect(next.json.meaning).toBe('unavailable');
  });
});

describe('hybrid search over 10,000 links', () => {
  it('answers within 800 ms at the 95th percentile', { timeout: 600_000 }, async () => {
    const user = await signIn();
    let seedValue = 11;
    const random = () => {
      seedValue = (seedValue * 1103515245 + 12345) % 2 ** 31;
      return seedValue / 2 ** 31;
    };
    const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]!;
    const vocabulary = Array.from({ length: 300 }, (_, i) => `term${i}x`);
    const common = ['cloud', 'design', 'history', 'notes', 'guide', 'review', 'python', 'garden'];
    const timing = ['alarm', 'schedule', 'timer', 'delay', 'cron'];
    const title = (i: number) =>
      [
        ...Array.from({ length: 6 }, () => pick(random() < 0.3 ? common : vocabulary)),
        ...(i % 25 === 0 ? [pick(timing)] : []),
      ].join(' ');

    for (let start = 0; start < 10_000; start += 250) {
      const links: D1PreparedStatement[] = [];
      const passages: D1PreparedStatement[] = [];
      for (let i = start; i < start + 250; i++) {
        const id = crypto.randomUUID();
        const text = title(i);
        const host = `site${i % 500}.example`;
        const at = new Date(Date.parse('2026-01-01T00:00:00.000Z') + i * 60_000).toISOString();
        links.push(
          env.DB.prepare(
            `INSERT INTO links (id, user_id, url, original_url, host, title, state, added_at,
               last_used_at, pin_position, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            id,
            user.id,
            `https://${host}/p${i}`,
            `https://${host}/p${i}`,
            host,
            text,
            i % 7 === 0 ? 'expired' : 'active',
            at,
            at,
            i < 20 ? i + 1 : null,
            at,
          ),
        );
        passages.push(
          env.DB.prepare(
            `INSERT INTO link_passages (vector_id, link_id, user_id, version, position, text)
             VALUES (?, ?, ?, 0, 0, ?)`,
          ).bind(`${id}:0:0`, id, user.id, text),
        );
        meaning.index.upsert([{ id: `${id}:0:0`, namespace: user.id, values: embedText(text) }]);
      }
      await env.DB.batch(links);
      await env.DB.batch(passages);
    }

    const queries = [
      'cloud design',
      'term7x',
      'guide',
      'timer delay',
      'schedule cron',
      'cloud timer',
      'history alarm',
      'term12x term40x',
      'garden',
      'python review',
    ];
    const matched = new Set<string>();
    const timed = async (q: string) => {
      const start = performance.now();
      const r = await search(user, q, '&mode=hybrid');
      const took = performance.now() - start;
      expect(r.status).toBe(200);
      expect(r.json.meaning).toBe('used');
      for (const item of r.json.items as Item[]) matched.add(item.match!);
      return took;
    };
    await timed('warm up');
    const times: number[] = [];
    for (let round = 0; round < 10; round++) for (const q of queries) times.push(await timed(q));
    // The queries found things both ways, so the time is of a search that did the work.
    expect(matched).toEqual(new Set(['keyword', 'meaning', 'both']));

    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(800);
  });
});

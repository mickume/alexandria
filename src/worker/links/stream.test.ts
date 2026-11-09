import { describe, expect, it } from 'vitest';
import { encodeCursor } from '../api/pagination';
import {
  api,
  env,
  FILTER_TABLE,
  seedFilterLinks,
  seedLinks,
  setNow,
  signIn,
  type TestUser,
} from '../test/helpers';

type Item = { id: string };
const ids = (items: Item[]) => items.map((i) => i.id);

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T = Date.parse('2027-06-01T12:00:00.000Z');

/** Puts `id` in a new workspace of `user`. */
async function intoWorkspace(user: TestUser, id: string) {
  const w = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO workspaces (id, user_id, name, name_key, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(w, user.id, w, w, new Date(T).toISOString()),
    env.DB.prepare(
      'INSERT INTO workspace_links (workspace_id, link_id, position) VALUES (?, ?, 1)',
    ).bind(w, id),
  ]);
}

describe('the stream', () => {
  it('lists pinned links by position, then the rest by points, last use and id', async () => {
    setNow(T);
    const user = await signIn();
    const at = (ms: number) => new Date(T - ms).toISOString();
    const [pinned2, pinned1, a, b, c, d, e, f] = await seedLinks(user, [
      { url: 'https://p2.example', lastUsedAt: at(0), pinPosition: 2, state: 'active' },
      { url: 'https://p1.example', lastUsedAt: at(400 * DAY), pinPosition: 1, state: 'active' },
      { url: 'https://a.example', lastUsedAt: at(5 * DAY), useCount: 10, state: 'active' },
      { url: 'https://b.example', lastUsedAt: at(0), useCount: 1, state: 'active' },
      { url: 'https://c.example', lastUsedAt: at(3 * HOUR), useCount: 1, state: 'active' },
      { url: 'https://d.example', lastUsedAt: at(70 * DAY), state: 'active' },
      { url: 'https://e.example', lastUsedAt: at(10 * DAY), state: 'active' },
      { url: 'https://f.example', lastUsedAt: at(10 * DAY), state: 'active' },
    ]);
    await intoWorkspace(user, d!);
    const r = await api('GET', '/api/v1/links', { as: user.session });
    expect(r.status).toBe(200);
    expect(ids(r.json.items)).toEqual([pinned1, pinned2, a, b, c, ...[e, f].sort().reverse(), d]);
    expect(r.json.items.map((l: { points: number }) => l.points)).toEqual([
      -340, 60, 65, 61, 61, 50, 50, -10,
    ]);
  });

  it('pages by the points of the first page, every link once, across a day boundary', async () => {
    setNow(T);
    const user = await signIn();
    // Each link's last use crosses a 24-hour boundary within the hour after T.
    const links = Array.from({ length: 120 }, (_, i) => ({
      url: `https://cross${i}.example`,
      state: 'active',
      useCount: i % 7,
      lastUsedAt: new Date(T - ((i % 13) + 1) * DAY + (i % 60) * 60_000).toISOString(),
    }));
    await seedLinks(user, links);
    const first = await api('GET', '/api/v1/links?limit=50', { as: user.session });
    const atT = (await api('GET', '/api/v1/links?limit=100', { as: user.session })).json;
    const rest = await api('GET', `/api/v1/links?limit=100&cursor=${atT.next_cursor}`, {
      as: user.session,
    });
    const expected = [...ids(atT.items), ...ids(rest.json.items)];
    setNow(T + HOUR);
    const seen = [...ids(first.json.items)];
    let cursor: string | null = first.json.next_cursor;
    while (cursor) {
      const page = await api('GET', `/api/v1/links?limit=50&cursor=${encodeURIComponent(cursor)}`, {
        as: user.session,
      });
      expect(page.status).toBe(200);
      seen.push(...ids(page.json.items));
      cursor = page.json.next_cursor;
    }
    expect(new Set(seen).size).toBe(120);
    expect(seen).toEqual(expected);
  });

  it('leaves expired links out', async () => {
    const user = await signIn();
    const [t1, t2, t3, expired] = await seedLinks(user, [
      { url: 'https://t1.example', lastUsedAt: '2026-01-01T00:00:00.000Z', pinPosition: 1 },
      { url: 'https://t2.example', lastUsedAt: '2026-01-02T00:00:00.000Z' },
      { url: 'https://t3.example', lastUsedAt: '2026-01-03T00:00:00.000Z' },
      { url: 'https://gone.example', lastUsedAt: '2026-01-04T00:00:00.000Z', state: 'expired' },
    ]);
    const r = await api('GET', '/api/v1/links', { as: user.session });
    expect(r.status).toBe(200);
    expect(ids(r.json.items)).toEqual([t1, t3, t2]);
    expect(ids(r.json.items)).not.toContain(expired);
    expect(r.json.next_cursor).toBeNull();
  });

  it('leaves archived links out of the stream, its filters and the change feed', async () => {
    const user = await signIn();
    const [active, archived] = await seedLinks(user, [
      { url: 'https://kept.example', lastUsedAt: '2026-03-01T00:00:00.000Z', state: 'active' },
      { url: 'https://boxed.example', lastUsedAt: '2026-03-02T00:00:00.000Z', state: 'archived' },
    ]);
    for (const id of [active!, archived!]) {
      await api('PATCH', `/api/v1/links/${id}`, { as: user.session, body: { tags: ['x'] } });
    }
    const list = async (query: string) =>
      ids((await api('GET', `/api/v1/links${query}`, { as: user.session })).json.items);
    expect(await list('')).toEqual([active]);
    expect(await list('?tag=x')).toEqual([active]);
    expect(await list('?changed_since=2026-01-01T00:00:00.000Z')).toEqual([active]);
    expect(await list('?state=archived')).toEqual([archived]);
    expect((await list('?state=any')).sort()).toEqual([active, archived].sort());
  });

  it('leaves expired links out of the change feed', async () => {
    const user = await signIn();
    const [active, expired] = await seedLinks(user, [
      { url: 'https://kept.example', lastUsedAt: '2026-03-01T00:00:00.000Z', state: 'active' },
      { url: 'https://gone.example', lastUsedAt: '2026-03-01T00:00:00.000Z', state: 'expired' },
    ]);
    const r = await api('GET', '/api/v1/links?changed_since=2026-01-01T00:00:00.000Z', {
      as: user.session,
    });
    expect(r.status).toBe(200);
    expect(ids(r.json.items)).toEqual([active]);
    expect(ids(r.json.items)).not.toContain(expired);
  });

  it.each([
    { limit: 50, sizes: [50, 50, 20] },
    { limit: 100, sizes: [100, 20] },
  ])('pages through every link once with limit $limit', async ({ limit, sizes }) => {
    const user = await signIn();
    const shared = '2026-02-01T00:00:00.000Z';
    await seedLinks(
      user,
      Array.from({ length: 120 }, (_, i) => ({
        url: `https://l${i}.example`,
        lastUsedAt: i < 30 ? shared : new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
        pinPosition: i >= 115 ? i - 114 : null,
      })),
    );
    const all = await api('GET', '/api/v1/links?limit=100', { as: user.session });
    const rest = await api('GET', `/api/v1/links?limit=100&cursor=${all.json.next_cursor}`, {
      as: user.session,
    });
    const expected = [...ids(all.json.items), ...ids(rest.json.items)];
    expect(new Set(expected).size).toBe(120);

    const pages: Item[][] = [];
    let cursor: string | null = null;
    do {
      const query: string = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const r = await api('GET', `/api/v1/links?${query}`, { as: user.session });
      expect(r.status).toBe(200);
      pages.push(r.json.items);
      cursor = r.json.next_cursor;
    } while (cursor);
    expect(pages.map((p) => p.length)).toEqual(sizes);
    expect(pages.flat().map((i) => i.id)).toEqual(expected);
  });

  it('serves 50 links by default', async () => {
    const user = await signIn();
    await seedLinks(
      user,
      Array.from({ length: 60 }, (_, i) => ({ url: `https://d${i}.example` })),
    );
    const r = await api('GET', '/api/v1/links', { as: user.session });
    expect(r.json.items).toHaveLength(50);
    expect(r.json.next_cursor).toEqual(expect.any(String));
  });

  it.each([
    { query: 'limit=0', error: 'invalid_limit', field: 'limit' },
    { query: 'limit=101', error: 'invalid_limit', field: 'limit' },
    { query: 'limit=abc', error: 'invalid_limit', field: 'limit' },
    { query: 'cursor=garbage', error: 'invalid_cursor', field: 'cursor' },
    { query: 'tampered', error: 'invalid_cursor', field: 'cursor' },
    { query: 'a cursor of the order by last use', error: 'invalid_cursor', field: 'cursor' },
    { query: 'a pinned cursor of the order by last use', error: 'invalid_cursor', field: 'cursor' },
  ])('refuses $query', async ({ query, error, field }) => {
    const user = await signIn();
    await seedLinks(
      user,
      Array.from({ length: 3 }, (_, i) => ({ url: `https://q${i}.example` })),
    );
    let q = query;
    if (query === 'tampered') {
      const first = await api('GET', '/api/v1/links?limit=1', { as: user.session });
      const [body = '', mac] = (first.json.next_cursor as string).split('.');
      const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
      const forged = btoa(JSON.stringify({ ...payload, i: 'zzzz' }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      q = `limit=1&cursor=${forged}.${mac}`;
    }
    if (query === 'a cursor of the order by last use') {
      const old = await encodeCursor(env, { s: 'u', l: '2026-01-01T00:00:00.000Z', i: 'x' });
      q = `cursor=${encodeURIComponent(old)}`;
    }
    if (query === 'a pinned cursor of the order by last use') {
      q = `cursor=${encodeURIComponent(await encodeCursor(env, { s: 'p', p: 1 }))}`;
    }
    const r = await api('GET', `/api/v1/links?${q}`, { as: user.session });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error, field, message: expect.any(String) });
    if (query.includes('order by last use')) {
      const search = await api('GET', `/api/v1/search?q=state%3Aany&${q}`, { as: user.session });
      expect([search.status, search.json.error]).toEqual([400, 'invalid_cursor']);
    }
  });
});

describe('the filtered link list', () => {
  /** A query's filters as query parameters: tag:a in:"x y" becomes tag=a&in=x%20y. */
  const asParams = (query: string) =>
    query
      .match(/\w+:("[^"]*"|\S+)/g)!
      .map((f) => {
        const [name, ...rest] = f.split(':');
        return `${name}=${encodeURIComponent(rest.join(':').replace(/^"|"$/g, ''))}`;
      })
      .join('&');

  it.each(FILTER_TABLE)('%s lists what the search lists, in stream order', async (query) => {
    const user = await signIn();
    const { b, c } = await seedFilterLinks(user);
    // Points and last use disagree: b is used more, c more recently.
    await env.DB.batch([
      env.DB.prepare('UPDATE links SET use_count = 20, last_used_at = ? WHERE id = ?').bind(
        new Date(Date.now() - 3 * DAY).toISOString(),
        b,
      ),
      env.DB.prepare('UPDATE links SET use_count = 0 WHERE id = ?').bind(c),
    ]);
    const listed = await api('GET', `/api/v1/links?${asParams(query)}`, { as: user.session });
    expect(listed.status).toBe(200);
    const searched = await api('GET', `/api/v1/search?q=${encodeURIComponent(query)}`, {
      as: user.session,
    });
    const found = searched.json.items.map((i: { link: Item }) => i.link.id);
    expect(ids(listed.json.items)).toEqual(found);
    const stream = ids((await api('GET', '/api/v1/links', { as: user.session })).json.items);
    expect(found).toEqual(stream.filter((id) => found.includes(id)));
  });

  it.each(['tag:x', 'topic:Reading'])(
    'lists the links of the search %s by points, as the stream does',
    async (query) => {
      setNow(T);
      const user = await signIn();
      const at = (ms: number) => new Date(T - ms).toISOString();
      const [used, recent, old] = await seedLinks(user, [
        { url: 'https://used.example', lastUsedAt: at(5 * DAY), useCount: 10, state: 'active' },
        { url: 'https://recent.example', lastUsedAt: at(HOUR), useCount: 1, state: 'active' },
        { url: 'https://old.example', lastUsedAt: at(DAY), useCount: 0, state: 'active' },
      ]);
      for (const id of [old!, recent!, used!]) {
        await api('PATCH', `/api/v1/links/${id}`, {
          as: user.session,
          body: { tags: ['x'], topic: 'Reading' },
        });
      }
      const r = await api('GET', `/api/v1/search?q=${encodeURIComponent(query)}`, {
        as: user.session,
      });
      expect(r.json.items.map((i: { link: Item }) => i.link.id)).toEqual([used, recent, old]);
    },
  );

  it('lists archived links after the links with points in a search of filters alone, newest last use first, each once across pages', async () => {
    setNow(T);
    const user = await signIn();
    const at = (ms: number) => new Date(T - ms).toISOString();
    const [pin, high, low, negative, kept1, kept2, kept3, gone] = await seedLinks(user, [
      { url: 'https://pin.example', lastUsedAt: at(DAY), pinPosition: 1, state: 'active' },
      { url: 'https://high.example', lastUsedAt: at(0), useCount: 10, state: 'active' },
      { url: 'https://low.example', lastUsedAt: at(50 * DAY), state: 'active' },
      { url: 'https://negative.example', lastUsedAt: at(65 * DAY), state: 'active' },
      { url: 'https://kept1.example', lastUsedAt: at(DAY), state: 'archived' },
      { url: 'https://kept2.example', lastUsedAt: at(2 * DAY), state: 'archived' },
      { url: 'https://kept3.example', lastUsedAt: at(3 * DAY), state: 'archived' },
      { url: 'https://gone.example', lastUsedAt: at(DAY), state: 'expired' },
    ]);
    await intoWorkspace(user, negative!);
    const all = [pin, high, low, negative, kept1, kept2, kept3] as string[];
    for (const id of [...all, gone!]) {
      await api('PATCH', `/api/v1/links/${id}`, { as: user.session, body: { tags: ['x'] } });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { json: { items: { link: Item }[]; next_cursor: string | null } } = await api(
        'GET',
        `/api/v1/search?q=tag%3Ax&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { as: user.session },
      );
      seen.push(...page.json.items.map((i) => i.link.id));
      cursor = page.json.next_cursor;
    } while (cursor);
    expect(seen).toEqual(all);
  });

  it('pages a filtered list with the shared cursor, every match once', async () => {
    const user = await signIn();
    const links = await seedFilterLinks(user);
    const extra = await seedLinks(
      user,
      Array.from({ length: 3 }, (_, i) => ({ url: `https://more${i}.example/` })),
    );
    for (const id of extra) {
      await api('PATCH', `/api/v1/links/${id}`, {
        as: user.session,
        body: { tags: ['cloudflare'] },
      });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { json: { items: Item[]; next_cursor: string | null } } = await api(
        'GET',
        `/api/v1/links?tag=cloudflare&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { as: user.session },
      );
      seen.push(...ids(page.json.items));
      cursor = page.json.next_cursor;
    } while (cursor);
    expect(seen.sort()).toEqual([links.a, links.b, ...extra].sort());
  });

  it('applies state and repeated parameters together', async () => {
    const user = await signIn();
    const [pending, active, unreachable, expired, archived] = await seedLinks(user, [
      { url: 'https://p.example/', state: 'pending' },
      { url: 'https://a.example/', state: 'active' },
      { url: 'https://u.example/', state: 'unreachable' },
      { url: 'https://x.example/', state: 'expired' },
      { url: 'https://r.example/', state: 'archived' },
    ]);
    const list = async (params: string) =>
      ids((await api('GET', `/api/v1/links?${params}`, { as: user.session })).json.items);
    expect(await list('state=pending')).toEqual([pending]);
    expect(await list('state=active')).toEqual([active]);
    expect(await list('state=unreachable')).toEqual([unreachable]);
    expect(await list('state=expired')).toEqual([expired]);
    expect(await list('state=archived')).toEqual([archived]);
    expect((await list('')).sort()).toEqual([pending, active, unreachable].sort());
    expect((await list('state=any')).sort()).toEqual(
      [pending, active, unreachable, expired, archived].sort(),
    );
    expect(await list('state=any&state=active')).toEqual([active]);
  });

  it.each([
    ['state=gone', 'state'],
    ['state=dormant', 'state'],
    ['is=starred', 'is'],
    ['state=', 'state'],
  ])('refuses %s, naming the parameter', async (params, field) => {
    const user = await signIn();
    const r = await api('GET', `/api/v1/links?${params}`, { as: user.session });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: 'invalid_filter', field });
  });
});

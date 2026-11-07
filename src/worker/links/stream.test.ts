import { describe, expect, it } from 'vitest';
import { api, seedLinks, signIn } from '../test/helpers';

type Item = { id: string };
const ids = (items: Item[]) => items.map((i) => i.id);

describe('the stream', () => {
  it('lists pinned links first, then the rest by last use, without archived links', async () => {
    const user = await signIn();
    const [t1, t2, t3, archived] = await seedLinks(user, [
      { url: 'https://t1.example', lastUsedAt: '2026-01-01T00:00:00.000Z', pinPosition: 1 },
      { url: 'https://t2.example', lastUsedAt: '2026-01-02T00:00:00.000Z' },
      { url: 'https://t3.example', lastUsedAt: '2026-01-03T00:00:00.000Z' },
      { url: 'https://gone.example', lastUsedAt: '2026-01-04T00:00:00.000Z', state: 'archived' },
    ]);
    const r = await api('GET', '/api/v1/links', { as: user.session });
    expect(r.status).toBe(200);
    expect(ids(r.json.items)).toEqual([t1, t3, t2]);
    expect(ids(r.json.items)).not.toContain(archived);
    expect(r.json.next_cursor).toBeNull();
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
    const r = await api('GET', `/api/v1/links?${q}`, { as: user.session });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error, field, message: expect.any(String) });
  });
});

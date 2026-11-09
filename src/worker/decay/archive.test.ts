import { describe, expect, it } from 'vitest';
import { FakeOrigin } from '../test/origin';
import { api, env, seedLinks, setNow, signIn, type TestUser } from '../test/helpers';

const T = Date.parse('2027-06-01T12:00:00.000Z');

async function pinned(user: TestUser): Promise<[string, number][]> {
  const rows = await env.DB.prepare(
    'SELECT id, pin_position FROM links WHERE user_id = ? AND pin_position IS NOT NULL ORDER BY pin_position',
  )
    .bind(user.id)
    .all<{ id: string; pin_position: number }>();
  return rows.results.map((r) => [r.id, r.pin_position]);
}

describe('the withdrawn archive', () => {
  it('answers 404 to archiving a link by hand and to the archive list, and changes no link', async () => {
    setNow(T);
    const user = await signIn();
    const [x = ''] = await seedLinks(user, [
      { url: 'https://x.example/', state: 'active', pinPosition: 1 },
    ]);
    const r = await api('POST', `/api/v1/links/${x}/archive`, { as: user.session });
    expect([r.status, r.json]).toEqual([404, { error: 'not_found' }]);
    expect(await pinned(user)).toEqual([[x, 1]]);
    expect(
      (await env.DB.prepare('SELECT state FROM links WHERE id = ?').bind(x).first())?.state,
    ).toBe('active');
    const list = await api('GET', '/api/v1/archive', { as: user.session });
    expect([list.status, list.json]).toEqual([404, { error: 'not_found' }]);
  });
});

/** Seeds expired links for `user`, each expired at its own time. */
async function seedExpired(user: TestUser, times: number[]): Promise<string[]> {
  const ids = await seedLinks(
    user,
    times.map((_, i) => ({ url: `https://expired${i}.example/`, state: 'expired' })),
  );
  await env.DB.batch(
    ids.map((id, i) =>
      env.DB.prepare('UPDATE links SET expired_at = ? WHERE id = ?').bind(
        new Date(times[i]!).toISOString(),
        id,
      ),
    ),
  );
  return ids;
}

describe('the expired list', () => {
  it('lists the expired links most recently expired first, with their removal dates', async () => {
    setNow(T);
    const user = await signIn();
    const other = await signIn('other@example.test', 'Other');
    const [a = '', b = '', c = '', tie = ''] = await seedExpired(user, [
      T - 3_000,
      T - 1_000,
      T - 2_000,
      T - 2_000,
    ]);
    const [active] = await seedLinks(user, [{ url: 'https://active.example/', state: 'active' }]);
    await seedExpired(other, [T]);
    const r = await api('GET', '/api/v1/expired', { as: user.session });
    expect(r.status).toBe(200);
    const listed = r.json.items.map((l: { id: string }) => l.id);
    expect(listed).toEqual([b, ...[c, tie].sort().reverse(), a]);
    expect(listed).not.toContain(active);
    for (const l of r.json.items) {
      expect(Date.parse(l.removal_at) - Date.parse(l.expired_at)).toBe(180 * 86_400_000);
    }
    expect(r.json.next_cursor).toBeNull();
  });

  it('pages them with limit and cursor, every expired link once', async () => {
    setNow(T);
    const user = await signIn();
    const ids = await seedExpired(
      user,
      Array.from({ length: 150 }, (_, i) => T - Math.floor(i / 3) * 1000),
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const page: { json: { items: { id: string }[]; next_cursor: string | null } } = await api(
        'GET',
        `/api/v1/expired?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { as: user.session },
      );
      sizes.push(page.json.items.length);
      seen.push(...page.json.items.map((l) => l.id));
      cursor = page.json.next_cursor;
    } while (cursor);
    expect(sizes).toEqual([100, 50]);
    expect(new Set(seen).size).toBe(150);
    expect([...seen].sort()).toEqual([...ids].sort());
    const first = await api('GET', '/api/v1/expired', { as: user.session });
    expect(first.json.items).toHaveLength(50);
  });

  it.each([
    { query: 'limit=0', error: 'invalid_limit', field: 'limit' },
    { query: 'limit=101', error: 'invalid_limit', field: 'limit' },
    { query: 'limit=x', error: 'invalid_limit', field: 'limit' },
    { query: 'cursor=garbage', error: 'invalid_cursor', field: 'cursor' },
    { query: 'stream cursor', error: 'invalid_cursor', field: 'cursor' },
  ])('refuses $query', async ({ query, error, field }) => {
    setNow(T);
    const user = await signIn();
    await seedLinks(
      user,
      Array.from({ length: 3 }, (_, i) => ({ url: `https://s${i}.example/`, state: 'active' })),
    );
    let q = query;
    if (query === 'stream cursor') {
      const stream = await api('GET', '/api/v1/links?limit=1', { as: user.session });
      q = `cursor=${encodeURIComponent(stream.json.next_cursor)}`;
    }
    const r = await api('GET', `/api/v1/expired?${q}`, { as: user.session });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error, field });
  });
});

describe('restoring a link', () => {
  it('brings it back active to the top of the stream, without counting a use', async () => {
    setNow(T);
    const user = await signIn();
    const [pin = '', old = ''] = await seedLinks(user, [
      { url: 'https://pinned.example/', state: 'active', pinPosition: 1 },
      {
        url: 'https://old.example/',
        state: 'expired',
        useCount: 3,
        lastUsedAt: new Date(T - 300 * 86_400_000).toISOString(),
      },
      {
        url: 'https://other.example/',
        state: 'active',
        lastUsedAt: new Date(T - 1000).toISOString(),
      },
    ]);
    await env.DB.prepare('UPDATE links SET expired_at = ? WHERE id = ?')
      .bind(new Date(T - 10 * 86_400_000).toISOString(), old)
      .run();
    const t = T + 5_000;
    setNow(t);
    const r = await api('POST', `/api/v1/links/${old}/restore`, { as: user.session });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      state: 'active',
      expired_at: null,
      removal_at: null,
      last_used_at: new Date(t).toISOString(),
      use_count: 3,
      points: 63,
    });
    const stream = (await api('GET', '/api/v1/links', { as: user.session })).json.items.map(
      (l: { id: string }) => l.id,
    );
    expect(stream.slice(0, 2)).toEqual([pin, old]);
  });

  it.each(['active', 'pending', 'unreachable'])('is refused for a %s link', async (state) => {
    setNow(T);
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: 'https://here.example/', state }]);
    const before = await env.DB.prepare(
      'SELECT state, last_used_at, expired_at FROM links WHERE id = ?',
    )
      .bind(id)
      .first();
    const r = await api('POST', `/api/v1/links/${id}/restore`, { as: user.session });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: 'not_expired', message: 'this link is not expired' });
    expect(
      await env.DB.prepare('SELECT state, last_used_at, expired_at FROM links WHERE id = ?')
        .bind(id)
        .first(),
    ).toEqual(before);
  });
});

describe('another user’s link', () => {
  it('is answered as one that does not exist by archive, restore and check', async () => {
    setNow(T);
    const a = await signIn('a@example.test', 'A');
    const b = await signIn('b@example.test', 'B');
    const [link = ''] = await seedLinks(b, [{ url: 'https://b-only.example/', state: 'expired' }]);
    const origin = new FakeOrigin().byMethod('https://b-only.example/', {
      HEAD: () => new Response(null, { status: 200 }),
    });
    const before = await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(link).first();
    for (const action of ['archive', 'restore', 'check']) {
      const r = await api('POST', `/api/v1/links/${link}/${action}`, { as: a.session });
      const unknown = await api('POST', `/api/v1/links/${crypto.randomUUID()}/${action}`, {
        as: a.session,
      });
      expect([r.status, r.json], action).toEqual([404, { error: 'not_found' }]);
      expect([unknown.status, unknown.json]).toEqual([404, { error: 'not_found' }]);
    }
    expect(await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(link).first()).toEqual(
      before,
    );
    expect(origin.log).toEqual([]);
  });
});

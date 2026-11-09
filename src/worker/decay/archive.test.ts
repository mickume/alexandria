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

async function archivedAt(id: string): Promise<string | null | undefined> {
  return (
    await env.DB.prepare('SELECT archived_at FROM links WHERE id = ?')
      .bind(id)
      .first<{ archived_at: string | null }>()
  )?.archived_at;
}

describe('archiving a link by hand', () => {
  it('archives it whatever keeps it from decay, unpins it and keeps its workspaces', async () => {
    setNow(T);
    const user = await signIn();
    const [x = '', y = ''] = await seedLinks(user, [
      { url: 'https://x.example/', state: 'active', pinPosition: 1 },
      { url: 'https://y.example/', state: 'active', pinPosition: 2 },
    ]);
    await env.DB.batch(
      [0, 1, 2, 3, 4].map((d) =>
        env.DB.prepare('INSERT INTO link_uses (link_id, user_id, at) VALUES (?, ?, ?)').bind(
          x,
          user.id,
          `2027-05-0${d + 1}T10:00:00.000Z`,
        ),
      ),
    );
    const w = (
      await api('POST', '/api/v1/workspaces', { as: user.session, body: { name: 'Kept' } })
    ).json.id;
    await api('POST', `/api/v1/workspaces/${w}/links`, { as: user.session, body: { link_id: x } });
    const r = await api('POST', `/api/v1/links/${x}/archive`, { as: user.session });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      state: 'archived',
      pinned: false,
    });
    expect(await archivedAt(x)).toBe(new Date(T).toISOString());
    expect(r.json.removal_at).toBe(new Date(T + 180 * 86_400_000).toISOString());
    expect(await pinned(user)).toEqual([[y, 1]]);
    expect(r.json.workspaces.map((ws: { id: string }) => ws.id)).toEqual([w]);
    const stream = (await api('GET', '/api/v1/links', { as: user.session })).json.items.map(
      (l: { id: string }) => l.id,
    );
    expect(stream).not.toContain(x);
    setNow(T + 60_000);
    const again = await api('POST', `/api/v1/links/${x}/archive`, { as: user.session });
    expect(again.status).toBe(200);
    expect(again.json.state).toBe('archived');
    expect(await archivedAt(x)).toBe(new Date(T).toISOString());
  });
});

describe('the archive list', () => {
  it('lists the archived links most recently archived first, with their removal dates', async () => {
    setNow(T);
    const user = await signIn();
    const other = await signIn('other@example.test', 'Other');
    const [a = '', b = '', c = ''] = await seedLinks(
      user,
      ['a', 'b', 'c'].map((n) => ({ url: `https://${n}.example/`, state: 'active' })),
    );
    await seedLinks(other, [{ url: 'https://o.example/', state: 'archived' }]);
    for (const [id, t] of [
      [a, T],
      [b, T + 2_000],
      [c, T + 1_000],
    ] as const) {
      setNow(t);
      await api('POST', `/api/v1/links/${id}/archive`, { as: user.session });
    }
    setNow(T + 3_000);
    const r = await api('GET', '/api/v1/archive', { as: user.session });
    expect(r.status).toBe(200);
    expect(r.json.items.map((l: { id: string }) => l.id)).toEqual([b, c, a]);
    for (const l of r.json.items) {
      expect(Date.parse(l.removal_at) - Date.parse((await archivedAt(l.id))!)).toBe(
        180 * 86_400_000,
      );
    }
  });

  it('pages 100 at a time', async () => {
    setNow(T);
    const user = await signIn();
    const ids = await seedLinks(
      user,
      Array.from({ length: 123 }, (_, i) => ({
        url: `https://arch${i}.example/`,
        state: 'archived',
      })),
    );
    await env.DB.batch(
      ids.map((id, i) =>
        env.DB.prepare('UPDATE links SET archived_at = ? WHERE id = ?').bind(
          new Date(T - i * 1000).toISOString(),
          id,
        ),
      ),
    );
    const first = await api('GET', '/api/v1/archive', { as: user.session });
    expect(first.json.items).toHaveLength(100);
    const second = await api(
      'GET',
      `/api/v1/archive?cursor=${encodeURIComponent(first.json.next_cursor)}`,
      { as: user.session },
    );
    expect(second.json.items).toHaveLength(23);
    expect(second.json.next_cursor).toBeNull();
  });
});

describe('restoring a link', () => {
  it('brings it back active to the top of the stream, without counting a use', async () => {
    setNow(T);
    const user = await signIn();
    const [pin = '', old = ''] = await seedLinks(user, [
      { url: 'https://pinned.example/', state: 'active', pinPosition: 1 },
      { url: 'https://old.example/', state: 'active', useCount: 3 },
      {
        url: 'https://other.example/',
        state: 'active',
        lastUsedAt: new Date(T - 1000).toISOString(),
      },
    ]);
    await api('POST', `/api/v1/links/${old}/archive`, { as: user.session });
    const t = T + 5_000;
    setNow(t);
    const r = await api('POST', `/api/v1/links/${old}/restore`, { as: user.session });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      state: 'active',
      removal_at: null,
      last_used_at: new Date(t).toISOString(),
      use_count: 3,
    });
    const stream = (await api('GET', '/api/v1/links', { as: user.session })).json.items.map(
      (l: { id: string }) => l.id,
    );
    expect(stream.slice(0, 2)).toEqual([pin, old]);
    expect((await api('GET', '/api/v1/archive', { as: user.session })).json.items).toEqual([]);
  });

  it.each(['active', 'dormant', 'pending'])('is refused for a %s link', async (state) => {
    setNow(T);
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: 'https://here.example/', state }]);
    const before = await env.DB.prepare('SELECT state, last_used_at FROM links WHERE id = ?')
      .bind(id)
      .first();
    const r = await api('POST', `/api/v1/links/${id}/restore`, { as: user.session });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: 'not_archived', message: 'this link is not archived' });
    expect(
      await env.DB.prepare('SELECT state, last_used_at FROM links WHERE id = ?').bind(id).first(),
    ).toEqual(before);
  });
});

describe('another user’s link', () => {
  it('is answered as one that does not exist by archive, restore and check', async () => {
    setNow(T);
    const a = await signIn('a@example.test', 'A');
    const b = await signIn('b@example.test', 'B');
    const [link = ''] = await seedLinks(b, [{ url: 'https://b-only.example/', state: 'archived' }]);
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

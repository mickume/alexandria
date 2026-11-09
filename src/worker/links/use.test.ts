import { describe, expect, it } from 'vitest';
import { api, count, createToken, seedLinks, setNow, signIn } from '../test/helpers';

async function addLink(session: string, url: string): Promise<string> {
  const r = await api('POST', '/api/v1/links', { as: session, body: { url } });
  return r.json.link.id;
}

describe('opening a link', () => {
  it('records a use and redirects to the normalised URL, by session or by token', async () => {
    const user = await signIn();
    const id = await addLink(user.session, 'https://example.com/a?utm_source=x');
    const t = '2026-07-01T12:00:00.000Z';
    setNow(t);
    const r = await api('GET', `/api/v1/links/${id}/open`, { as: user.session });
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toBe('https://example.com/a');
    let link = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
    expect(link.use_count).toBe(1);
    expect(link.last_used_at).toBe(t);
    expect(await count('link_uses', 'link_id = ?', id)).toBe(1);

    const token = await createToken(user);
    const r2 = await api('GET', `/api/v1/links/${id}/open`, { bearer: token.secret });
    expect(r2.status).toBe(302);
    link = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
    expect(link.use_count).toBe(2);

    const [old = ''] = await seedLinks(user, [
      {
        url: 'https://old.example/',
        state: 'active',
        useCount: 4,
        lastUsedAt: '2026-06-01T12:00:00.000Z',
      },
    ]);
    await api('GET', `/api/v1/links/${old}/open`, { as: user.session });
    link = (await api('GET', `/api/v1/links/${old}`, { as: user.session })).json;
    expect([link.use_count, link.points]).toEqual([5, 65]);
  });

  it('counts every one of concurrent opens', async () => {
    const user = await signIn();
    const id = await addLink(user.session, 'https://busy.example');
    await Promise.all(
      Array.from({ length: 10 }, () =>
        api('GET', `/api/v1/links/${id}/open`, { as: user.session }),
      ),
    );
    const link = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
    expect(link.use_count).toBe(10);
    expect(await count('link_uses', 'link_id = ?', id)).toBe(10);
  });
});

describe('a link’s history', () => {
  it('lists its uses newest first', async () => {
    const user = await signIn();
    const id = await addLink(user.session, 'https://history.example');
    const t1 = '2026-07-02T08:00:00.000Z';
    const t2 = '2026-07-03T08:00:00.000Z';
    setNow(t1);
    await api('GET', `/api/v1/links/${id}/open`, { as: user.session });
    setNow(t2);
    await api('GET', `/api/v1/links/${id}/open`, { as: user.session });
    const r = await api('GET', `/api/v1/links/${id}/history`, { as: user.session });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      items: [
        { kind: 'use', at: t2 },
        { kind: 'use', at: t1 },
      ],
      next_cursor: null,
    });
  });

  it('pages at most 100 events at a time', async () => {
    const user = await signIn();
    const id = await addLink(user.session, 'https://popular.example');
    for (let i = 0; i < 105; i++) {
      setNow(Date.UTC(2026, 6, 4, 0, i));
      await api('GET', `/api/v1/links/${id}/open`, { as: user.session });
    }
    const first = await api('GET', `/api/v1/links/${id}/history`, { as: user.session });
    expect(first.json.items).toHaveLength(100);
    const second = await api(
      'GET',
      `/api/v1/links/${id}/history?cursor=${encodeURIComponent(first.json.next_cursor)}`,
      { as: user.session },
    );
    expect(second.json.items).toHaveLength(5);
    expect(second.json.next_cursor).toBeNull();
    const all = [...first.json.items, ...second.json.items].map((e: { at: string }) => e.at);
    expect(all).toEqual([...all].sort().reverse());
    expect(new Set(all).size).toBe(105);
  });
});

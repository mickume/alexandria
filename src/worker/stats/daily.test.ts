import { describe, expect, it } from 'vitest';
import {
  api,
  createToken,
  mcpTool,
  seedLinks,
  setNow,
  signIn,
  type TestUser,
} from '../test/helpers';

const NOW = '2026-11-10T12:00:00.000Z';

/** The user's record for the last `days` days, as GET /api/v1/stats/history answers it. */
async function days(user: TestUser, n = 1) {
  const r = await api('GET', `/api/v1/stats/history?days=${n}`, { as: user.session });
  expect(r.status).toBe(200);
  return r.json.days as Record<string, number | null>[];
}

/** Today's record of the user. */
async function today(user: TestUser) {
  return (await days(user)).at(-1)!;
}

/** Imports `lines` as a text file through the API. */
async function importText(user: TestUser, lines: string[]) {
  const r = await api('POST', '/api/v1/imports', {
    as: user.session,
    body: `${lines.join('\n')}\n`,
    headers: { 'Content-Type': 'text/plain' },
  });
  expect(r.status).toBe(201);
}

describe('counting link events', () => {
  it.each([
    [
      'a new link pasted, and the same URL again',
      async (u: TestUser) => {
        await api('POST', '/api/v1/links', { as: u.session, body: { url: 'https://a.example/' } });
        await api('POST', '/api/v1/links', { as: u.session, body: { url: 'https://a.example/' } });
      },
      1,
    ],
    [
      'a batch of 3 new links and 1 duplicate',
      async (u: TestUser) => {
        await api('POST', '/api/v1/links', { as: u.session, body: { url: 'https://d.example/' } });
        await api('POST', '/api/v1/links/batch', {
          as: u.session,
          body: {
            urls: [
              'https://b1.example/',
              'https://b2.example/',
              'https://b3.example/',
              'https://d.example/',
            ],
          },
        });
      },
      4,
    ],
    [
      'a link added through the MCP server',
      async (u: TestUser) => {
        const token = await createToken(u);
        const r = await mcpTool(token.secret, 'add_link', { url: 'https://mcp.example/' });
        expect(r.isError ?? false).toBe(false);
      },
      1,
    ],
    [
      'an import of 5 lines, one a duplicate',
      async (u: TestUser) => {
        await importText(u, [
          'https://i1.example/',
          'https://i2.example/',
          'https://i3.example/',
          'https://i4.example/',
          'https://i1.example/',
        ]);
      },
      4,
    ],
  ])('counts the links added: %s', async (_, act, expected) => {
    setNow(NOW);
    const user = await signIn();
    await act(user);
    expect((await today(user)).added).toBe(expected);
  });

  it('counts every use recorded', async () => {
    setNow(NOW);
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: 'https://used.example/', state: 'active' }]);
    for (let i = 0; i < 3; i++) {
      const r = await api('GET', `/api/v1/links/${id}/open`, { as: user.session });
      expect(r.status).toBe(302);
    }
    expect((await today(user)).used).toBe(3);
  });

  it.each([
    [
      'a use',
      (u: TestUser, id: string) => api('GET', `/api/v1/links/${id}/open`, { as: u.session }),
    ],
    [
      'a re-paste',
      (u: TestUser) =>
        api('POST', '/api/v1/links', { as: u.session, body: { url: 'https://gone.example/' } }),
    ],
    [
      'the restore route',
      (u: TestUser, id: string) => api('POST', `/api/v1/links/${id}/restore`, { as: u.session }),
    ],
  ])('counts an expired link brought back by %s as restored', async (_, act) => {
    setNow(NOW);
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [
      // Stored as the normaliser stores it, so the re-paste finds it.
      { url: 'https://gone.example', state: 'expired', addedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const r = await act(user, id);
    expect(r.status).toBeLessThan(400);
    const day = await today(user);
    expect(day.restored).toBe(1);
    expect(day.added).toBe(0);
  });

  it.each([
    ['archived', 'POST', '/archive', 'active'],
    ['unarchived', 'POST', '/unarchive', 'archived'],
    ['deleted', 'DELETE', '', 'active'],
  ])('counts a link %s', async (counter, method, suffix, state) => {
    setNow(NOW);
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [
      { url: 'https://x.example/', state, addedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const r = await api(method, `/api/v1/links/${id}${suffix}`, { as: user.session });
    expect(r.status).toBeLessThan(300);
    const day = await today(user);
    for (const c of ['archived', 'unarchived', 'deleted']) {
      expect(day[c]).toBe(c === counter ? 1 : 0);
    }
  });

  it('counts nothing for a refused archive or a delete of an unknown link', async () => {
    setNow(NOW);
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [
      { url: 'https://y.example/', state: 'archived', addedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect((await api('POST', `/api/v1/links/${id}/unarchive`, { as: user.session })).status).toBe(
      200,
    );
    expect((await api('POST', `/api/v1/links/${id}/unarchive`, { as: user.session })).status).toBe(
      409,
    );
    const missing = await api('DELETE', `/api/v1/links/${crypto.randomUUID()}`, {
      as: user.session,
    });
    expect(missing.status).toBe(404);
    const day = await today(user);
    expect(day.unarchived).toBe(1);
    expect(day.deleted).toBe(0);
  });

  it('keeps a day’s counts when the links it counted are deleted', async () => {
    setNow('2026-11-09T12:00:00.000Z');
    const user = await signIn();
    const added = await api('POST', '/api/v1/links/batch', {
      as: user.session,
      body: { urls: ['https://k1.example/', 'https://k2.example/'] },
    });
    const ids = (added.json.added as { id: string }[]).map((l) => l.id);
    await api('GET', `/api/v1/links/${ids[0]}/open`, { as: user.session });
    setNow(NOW);
    for (const id of ids) await api('DELETE', `/api/v1/links/${id}`, { as: user.session });
    const [yesterday, now] = await days(user, 2);
    expect(yesterday).toMatchObject({ added: 2, used: 1, deleted: 0 });
    expect(now).toMatchObject({ added: 0, used: 0, deleted: 2 });
  });

  it('counts each event on the UTC day of its stored time', async () => {
    const user = await signIn();
    setNow('2026-11-09T23:59:59.999Z');
    await api('POST', '/api/v1/links', {
      as: user.session,
      body: { url: 'https://late.example/' },
    });
    setNow('2026-11-10T00:00:00.000Z');
    await api('POST', '/api/v1/links', {
      as: user.session,
      body: { url: 'https://early.example/' },
    });
    const [d9, d10] = await days(user, 2);
    expect(d9).toMatchObject({ day: '2026-11-09', added: 1 });
    expect(d10).toMatchObject({ day: '2026-11-10', added: 1 });
  });

  it('counts nothing for a link the full library refuses', { timeout: 120_000 }, async () => {
    setNow(NOW);
    const user = await signIn();
    await seedLinks(
      user,
      Array.from({ length: 20_000 }, (_, i) => ({
        url: `https://full${i}.example/`,
        addedAt: '2026-01-01T00:00:00.000Z',
      })),
    );
    const r = await api('POST', '/api/v1/links', {
      as: user.session,
      body: { url: 'https://one-too-many.example/' },
    });
    expect(r.status).toBe(409);
    expect((await today(user)).added).toBe(0);
  });
});

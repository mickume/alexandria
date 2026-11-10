import { describe, expect, it } from 'vitest';
import { runScheduled } from '../decay/cron';
import { evaluateDecay } from '../decay/decay';
import { blogArticle } from '../fetcher/fixtures/pages';
import { FakeAi } from '../test/ai';
import { ARTICLES, seedArticle } from '../test/meaning';
import { FakeOrigin } from '../test/origin';
import {
  api,
  addAndFetch,
  createToken,
  deliverEnrichments,
  deliverFetches,
  deliverIndexing,
  env,
  recordEnrichQueue,
  recordFetchQueue,
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

describe('counting decay', () => {
  /** Seeds 3 links past their points and 2 expired links past remove_days (180). */
  async function seedDecaying(user: TestUser) {
    const old = '2026-01-01T00:00:00.000Z';
    const ids = await seedLinks(user, [
      ...[1, 2, 3].map((i) => ({
        url: `https://old${i}.example/`,
        state: 'active',
        lastUsedAt: old,
      })),
      ...[1, 2].map((i) => ({
        url: `https://gone${i}.example/`,
        state: 'expired',
        lastUsedAt: old,
      })),
    ]);
    for (const id of ids.slice(3)) {
      await env.DB.prepare('UPDATE links SET expired_at = ? WHERE id = ?').bind(old, id).run();
    }
    return ids;
  }

  it('counts the links an evaluation expires and removes, once', async () => {
    setNow(NOW);
    const user = await signIn();
    await seedDecaying(user);
    await evaluateDecay(env, user.id);
    expect(await today(user)).toMatchObject({ expired: 3, removed: 2 });
    await evaluateDecay(env, user.id);
    expect(await today(user)).toMatchObject({ expired: 3, removed: 2 });
  });

  it('counts nothing when the evaluation is rolled back', async () => {
    setNow(NOW);
    const user = await signIn();
    const ids = await seedDecaying(user);
    // A batch that ends in a failing statement: D1 rolls the whole batch back.
    const failing = {
      ...env.DB,
      prepare: env.DB.prepare.bind(env.DB),
      batch: (statements: D1PreparedStatement[]) =>
        env.DB.batch([...statements, env.DB.prepare('SELECT * FROM no_such_table')]),
    } as unknown as D1Database;
    await expect(evaluateDecay({ ...env, DB: failing }, user.id)).rejects.toThrow();
    const states = await env.DB.prepare(
      `SELECT state FROM links WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY url`,
    )
      .bind(...ids)
      .all<{ state: string }>();
    expect(states.results.map((r) => r.state).sort()).toEqual(
      ['active', 'active', 'active', 'expired', 'expired'].sort(),
    );
    expect(await today(user)).toMatchObject({ expired: 0, removed: 0 });
  });
});

/** The user's fetch events of today by outcome, as the link histories show them. */
async function historyFetches(user: TestUser, ids: string[]) {
  const out = { ok: 0, failed: 0 };
  for (const id of ids) {
    const r = await api('GET', `/api/v1/links/${id}/history`, { as: user.session });
    for (const e of r.json.items as { kind: string; at: string; outcome: 'ok' | 'failed' }[]) {
      if (e.kind === 'fetch' && e.at.startsWith(NOW.slice(0, 10))) out[e.outcome] += 1;
    }
  }
  return out;
}

/** Saves an Anthropic key the fake provider accepts. */
async function saveKey(user: TestUser) {
  const r = await api('PUT', '/api/v1/settings/ai', {
    as: user.session,
    body: { provider: 'anthropic', api_key: 'sk-ant-abcd1234' },
  });
  expect(r.status).toBe(200);
}

describe('counting background work', () => {
  it('counts each fetch event by its outcome, as the link histories show them', async () => {
    setNow(NOW);
    const user = await signIn();
    const origin = new FakeOrigin().page('https://ok.example/a', blogArticle);
    origin.status('https://down.example/a', 503);
    const ok = await addAndFetch(user, 'https://ok.example/a');
    const retries = recordFetchQueue();
    const down = await addAndFetch(user, 'https://down.example/a');
    // The failed first fetch is tried again; deliver the retries the worker sent.
    for (let i = 0; i < 2 && retries.length; i++) {
      await deliverFetches(retries.splice(0, retries.length).map((m) => m.body));
    }
    const [kept = ''] = await seedLinks(user, [{ url: 'https://kept.example/', state: 'active' }]);
    env.FETCH_QUEUE = {
      send: () => Promise.reject(new Error('the queue is down')),
    } as unknown as typeof env.FETCH_QUEUE;
    expect((await api('POST', `/api/v1/links/${kept}/archive`, { as: user.session })).status).toBe(
      200,
    );
    const shown = await historyFetches(user, [ok.id, down.id, kept]);
    expect(shown.ok).toBe(1);
    expect(shown.failed).toBeGreaterThanOrEqual(2);
    const day = await today(user);
    expect({ ok: day.fetch_ok, failed: day.fetch_failed }).toEqual(shown);
  });

  it('counts a fetch delivered again only as often as the history records it', async () => {
    setNow(NOW);
    const user = await signIn();
    new FakeOrigin().page('https://twice.example/a', blogArticle);
    const fetched = await addAndFetch(user, 'https://twice.example/a');
    await deliverFetches(fetched.sent.map((m) => m.body));
    const shown = await historyFetches(user, [fetched.id]);
    expect((await today(user)).fetch_ok).toBe(shown.ok);
  });

  it('counts each enrichment stored and each failure stored', async () => {
    setNow(NOW);
    const user = await signIn();
    const ai = new FakeAi();
    await saveKey(user);
    new FakeOrigin()
      .page('https://enrich.example/a', blogArticle)
      .page('https://fails.example/a', blogArticle);
    const enrich = recordEnrichQueue();
    await addAndFetch(user, 'https://enrich.example/a');
    await deliverEnrichments(enrich.splice(0, enrich.length).map((m) => m.body));
    ai.status(400, 'the request could not be used');
    await addAndFetch(user, 'https://fails.example/a');
    // The first automatic attempt fails and is sent again; the retry fails too.
    for (let i = 0; i < 2 && enrich.length; i++) {
      await deliverEnrichments(enrich.splice(0, enrich.length).map((m) => m.body));
    }
    expect(await today(user)).toMatchObject({ enriched: 1, enrichment_failed: 2 });
  });

  it.each([
    ['answered by the provider', 'answer', 1],
    ['with no passage near enough', 'nothing', 1],
    ['with the provider failing', 'fail', 1],
    ['refused as empty', 'empty', 0],
    ['refused without a key', 'nokey', 0],
  ])('counts an Ask question %s', async (_, how, expected) => {
    setNow(NOW);
    const user = await signIn();
    const ai = new FakeAi();
    if (how !== 'nokey') await saveKey(user);
    const id = await seedArticle(user, ARTICLES.alarms);
    expect((await deliverIndexing([{ user_id: user.id, link_id: id }])).retried).toEqual([]);
    if (how === 'fail') ai.status(500, 'overloaded');
    const question =
      how === 'empty'
        ? ''
        : how === 'nothing'
          ? 'quarterly tax return'
          : 'how do I schedule background work on cloudflare';
    const r = await api('POST', '/api/v1/ask', { as: user.session, body: { question } });
    await r.response.text();
    expect((await today(user)).asks).toBe(expected);
  });
});

describe('end-of-day size', () => {
  /** Seeds 2 pending, 3 active, 1 unreachable, 1 expired and 1 archived link. */
  async function seedEveryState(user: TestUser, prefix: string) {
    const states = [
      'pending',
      'pending',
      'active',
      'active',
      'active',
      'unreachable',
      'expired',
      'archived',
    ];
    await seedLinks(
      user,
      states.map((state, i) => ({ url: `https://${prefix}${i}.example/`, state })),
    );
  }

  /** The size recorded for `day`, by the history route. */
  async function sizeOn(user: TestUser, day: string) {
    const r = await api('GET', '/api/v1/stats/history?days=3', { as: user.session });
    return (r.json.days as { day: string; size: unknown }[]).find((d) => d.day === day)?.size;
  }

  it('records each owner’s size for the day that ended, once, at the first run after midnight', async () => {
    const user = await signIn();
    const leaving = await signIn('leaving@example.test', 'L');
    await seedEveryState(user, 's');
    await seedEveryState(leaving, 'l');
    await env.DB.prepare('UPDATE users SET deletion_requested_at = ? WHERE id = ?')
      .bind('2026-11-09T20:00:00.000Z', leaving.id)
      .run();
    setNow('2026-11-10T00:05:00.000Z');
    await runScheduled(env);
    setNow('2026-11-10T00:50:00.000Z');
    await seedLinks(user, [{ url: 'https://later.example/', state: 'active' }]);
    await runScheduled(env);
    expect(await sizeOn(user, '2026-11-09')).toEqual({
      total: 8,
      pending: 2,
      active: 3,
      unreachable: 1,
      expired: 1,
      archived: 1,
    });
    expect(await sizeOn(user, '2026-11-10')).toBeNull();
    const theirs = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM daily_stats WHERE user_id = ? AND size_total IS NOT NULL',
    )
      .bind(leaving.id)
      .first<{ n: number }>();
    expect(theirs?.n).toBe(0);
  });

  it('leaves a day’s size null when no run starts in the hour after midnight', async () => {
    const user = await signIn();
    await seedEveryState(user, 's');
    setNow('2026-11-10T02:00:00.000Z');
    await runScheduled(env);
    setNow('2026-11-11T00:10:00.000Z');
    await runScheduled(env);
    setNow('2026-11-11T12:00:00.000Z');
    expect(await sizeOn(user, '2026-11-09')).toBeNull();
    expect(await sizeOn(user, '2026-11-10')).toMatchObject({ total: 8 });
  });
});

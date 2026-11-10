import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readerKey, snapshotKey } from '../fetcher/snapshots';
import {
  api,
  count,
  createToken,
  env,
  seedLinks,
  setNow,
  signIn,
  type TestUser,
} from '../test/helpers';

const DAY = 86_400_000;
/** Noon UTC: the last use of the previous UTC day is at least 12 hours before. */
const T = Date.parse('2027-06-01T12:00:00.000Z');
const iso = (t: number) => new Date(t).toISOString();

function setUseBoost(user: TestUser, useBoost: number) {
  return env.DB.prepare('UPDATE users SET use_boost = ? WHERE id = ?')
    .bind(useBoost, user.id)
    .run();
}

async function readLink(user: TestUser, id: string) {
  return (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
}

async function open(user: TestUser, id: string) {
  return api('GET', `/api/v1/links/${id}/open`, { as: user.session });
}

/** Puts `id` in a new workspace of `user`. */
async function intoWorkspace(user: TestUser, id: string) {
  const w = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO workspaces (id, user_id, name, name_key, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(w, user.id, w, w, iso(T)),
    env.DB.prepare(
      'INSERT INTO workspace_links (workspace_id, link_id, position) VALUES (?, ?, 1)',
    ).bind(w, id),
  ]);
}

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
    // 30 days into its decay, the use wins back half of them: 60 + 5 - 15.
    expect([link.use_count, link.points]).toEqual([5, 50]);
  });

  it('counts every one of concurrent opens, and moves the decay start once', async () => {
    setNow(T);
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [
      {
        url: 'https://busy.example/',
        state: 'active',
        lastUsedAt: iso(T - 13 * 3_600_000),
        decayFrom: iso(T - 40 * DAY),
      },
    ]);
    setNow(T);
    await Promise.all(Array.from({ length: 10 }, () => open(user, id)));
    const link = await readLink(user, id);
    expect(link.use_count).toBe(10);
    expect(await count('link_uses', 'link_id = ?', id)).toBe(10);
    expect(link.decay_from).toBe(iso(T - 20 * DAY));
  });
});

describe('using an expired link', () => {
  it.each([
    { label: 'an open', method: 'GET', path: (id: string) => `/api/v1/links/${id}/open` },
    { label: 'a read', method: 'GET', path: (id: string) => `/api/v1/links/${id}/reader` },
    {
      label: 'a snapshot view',
      method: 'GET',
      path: (id: string) => `/api/v1/links/${id}/snapshot`,
    },
    { label: 'a re-paste', method: 'POST', path: () => '/api/v1/links' },
  ])('makes it active again by $label, its decay starting afresh', async ({ method, path }) => {
    setNow(T);
    const user = await signIn();
    await setUseBoost(user, 50);
    const url = 'https://expired.example';
    const [id = ''] = await seedLinks(user, [
      {
        url,
        state: 'expired',
        useCount: 2,
        lastUsedAt: iso(T - 200 * DAY),
        decayFrom: iso(T - 200 * DAY),
      },
    ]);
    await env.DB.prepare(
      "UPDATE links SET expired_at = ?, content_kind = 'html', has_snapshot = 1 WHERE id = ?",
    )
      .bind('2026-01-01T00:00:00.000Z', id)
      .run();
    await env.SNAPSHOTS.put(snapshotKey(user.id, id), '<html><body>kept</body></html>');
    await env.SNAPSHOTS.put(
      readerKey(user.id, id),
      JSON.stringify({ title: 'T', byline: null, html: '<p>kept</p>' }),
    );
    setNow(T);
    const r = await api(method, path(id), {
      as: user.session,
      ...(method === 'POST' ? { body: { url } } : {}),
    });
    expect(r.status).toBeLessThan(400);
    const link = await readLink(user, id);
    expect([link.state, link.expired_at]).toEqual(['active', null]);
    expect([link.decay_from, link.last_used_at]).toEqual([iso(T), iso(T)]);
    expect(link.points).toBe(60 + link.use_count);
    const stream = (await api('GET', '/api/v1/links', { as: user.session })).json.items;
    expect(stream.map((l: { id: string }) => l.id)).toContain(id);
  });
});

describe('using an archived link', () => {
  it.each([
    { label: 'an open', method: 'GET', path: (id: string) => `/api/v1/links/${id}/open`, uses: 4 },
    { label: 'a read', method: 'GET', path: (id: string) => `/api/v1/links/${id}/reader`, uses: 4 },
    {
      label: 'a snapshot view',
      method: 'GET',
      path: (id: string) => `/api/v1/links/${id}/snapshot`,
      uses: 4,
    },
    { label: 'a re-paste', method: 'POST', path: () => '/api/v1/links', uses: 3 },
  ])('keeps it archived through $label, last used now', async ({ method, path, uses }) => {
    const user = await signIn();
    const url = 'https://kept.example';
    const [id = ''] = await seedLinks(user, [{ url, state: 'archived', useCount: 3 }]);
    const archivedAt = '2026-01-01T00:00:00.000Z';
    await env.DB.prepare(
      "UPDATE links SET archived_at = ?, content_kind = 'html', has_snapshot = 1 WHERE id = ?",
    )
      .bind(archivedAt, id)
      .run();
    await env.SNAPSHOTS.put(snapshotKey(user.id, id), '<html><body>kept</body></html>');
    await env.SNAPSHOTS.put(
      readerKey(user.id, id),
      JSON.stringify({ title: 'T', byline: null, html: '<p>kept</p>' }),
    );
    const t = '2026-06-01T08:00:00.000Z';
    setNow(t);
    const r = await api(method, path(id), {
      as: user.session,
      ...(method === 'POST' ? { body: { url } } : {}),
    });
    expect(r.status).toBeLessThan(400);
    const link = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
    expect(link).toMatchObject({
      state: 'archived',
      archived_at: archivedAt,
      last_used_at: t,
      use_count: uses,
    });
  });
});

describe('the boost of a use', () => {
  it.each([
    { useBoost: 50, uses: 5, decayed: 62 * DAY, points: 35, decayFrom: iso(T - 31 * DAY) },
    { useBoost: 50, uses: 5, decayed: 6 * DAY, points: 63, decayFrom: iso(T - 3 * DAY) },
    { useBoost: 100, uses: 3, decayed: 20 * DAY, points: 64, decayFrom: iso(T) },
    { useBoost: 10, uses: 0, decayed: 30 * DAY, points: 34, decayFrom: iso(T - 27 * DAY) },
    // 33% of 10 days and 7 ms is 285,120,002.31 ms, rounded down to the millisecond.
    {
      useBoost: 33,
      uses: 0,
      decayed: 10 * DAY + 7,
      points: 55,
      decayFrom: iso(T - 10 * DAY - 7 + 285_120_002),
    },
  ])(
    'wins back $useBoost% of $decayed ms of decay on the first use of a UTC day',
    async ({ useBoost, uses, decayed, points, decayFrom }) => {
      setNow(T);
      const user = await signIn();
      await setUseBoost(user, useBoost);
      const [id = ''] = await seedLinks(user, [
        {
          url: 'https://boosted.example/',
          state: 'active',
          useCount: uses,
          lastUsedAt: iso(T - 13 * 3_600_000),
          decayFrom: iso(T - decayed),
        },
      ]);
      setNow(T);
      expect((await open(user, id)).status).toBe(302);
      const link = await readLink(user, id);
      expect(link).toMatchObject({
        use_count: uses + 1,
        last_used_at: iso(T),
        decay_from: decayFrom,
        points,
      });
    },
  );

  const midnight = Date.parse('2027-06-01T00:00:00.000Z');
  it.each([
    { label: 'at 00:00 of the same UTC day', lastUsed: midnight, t: T, moves: false },
    { label: 'a minute before, the same UTC day', lastUsed: T - 60_000, t: T, moves: false },
    {
      label: 'at 23:59:59.999 of the previous UTC day',
      lastUsed: midnight - 1,
      t: midnight,
      moves: true,
    },
  ])('after a last use $label, moves the decay start: $moves', async ({ lastUsed, t, moves }) => {
    setNow(T);
    const user = await signIn();
    await setUseBoost(user, 50);
    const decayFrom = iso(t - 40 * DAY);
    const [id = ''] = await seedLinks(user, [
      { url: 'https://again.example/', state: 'active', lastUsedAt: iso(lastUsed), decayFrom },
    ]);
    setNow(t);
    const before = await readLink(user, id);
    await open(user, id);
    const after = await readLink(user, id);
    expect(after.last_used_at).toBe(iso(t));
    if (moves) {
      expect(after.decay_from).toBe(iso(t - 20 * DAY));
    } else {
      expect(after.decay_from).toBe(decayFrom);
      expect(after.points).toBe(before.points + 1);
    }
  });

  it.each([
    { label: 'a pinned link', state: 'active', pinned: true, member: false },
    { label: 'a link in a workspace', state: 'active', pinned: false, member: true },
    { label: 'an archived link', state: 'archived', pinned: false, member: false },
  ])('applies to $label as to any other', async ({ state, pinned, member }) => {
    setNow(T);
    const user = await signIn();
    await setUseBoost(user, 50);
    const [id = ''] = await seedLinks(user, [
      {
        url: 'https://kept.example/',
        state,
        pinPosition: pinned ? 1 : null,
        lastUsedAt: iso(T - 13 * 3_600_000),
        decayFrom: iso(T - 40 * DAY),
      },
    ]);
    if (member) await intoWorkspace(user, id);
    setNow(T);
    await open(user, id);
    const link = await readLink(user, id);
    expect(link.decay_from).toBe(iso(T - 20 * DAY));
    expect(link.state).toBe(state);
    if (state === 'archived') expect(link.points).toBeNull();
  });

  it('raises a link’s points by at least one, whatever the boost, the decay and the day of the last use', async () => {
    setNow(T);
    const user = await signIn();
    const config = fc.record({
      useBoost: fc.integer({ min: 10, max: 100 }),
      uses: fc.integer({ min: 0, max: 50 }),
      decayedMs: fc.integer({ min: 0, max: 400 * DAY }),
      // The last use, this many ms before T: 0 to 12 hours is the same UTC day, more is the day before.
      lastUsedMs: fc.integer({ min: 0, max: 36 * 3_600_000 - 1 }),
      state: fc.constantFrom('active', 'expired'),
    });
    await fc.assert(
      fc.asyncProperty(config, async (c) => {
        await env.DB.prepare('DELETE FROM links WHERE user_id = ?').bind(user.id).run();
        await setUseBoost(user, c.useBoost);
        const [id = ''] = await seedLinks(user, [
          {
            url: 'https://any.example/',
            state: c.state,
            useCount: c.uses,
            lastUsedAt: iso(T - c.lastUsedMs),
            decayFrom: iso(T - c.decayedMs),
          },
        ]);
        setNow(T);
        const before = (await readLink(user, id)).points;
        await open(user, id);
        expect((await readLink(user, id)).points).toBeGreaterThanOrEqual(before + 1);
      }),
      { numRuns: 40 },
    );
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

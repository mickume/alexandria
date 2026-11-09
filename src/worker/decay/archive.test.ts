import { describe, expect, it } from 'vitest';
import { FakeOrigin } from '../test/origin';
import {
  api,
  env,
  recordFetchQueue,
  seedLinks,
  setNow,
  signIn,
  type TestUser,
} from '../test/helpers';

const T = Date.parse('2027-06-01T12:00:00.000Z');

async function pinned(user: TestUser): Promise<[string, number][]> {
  const rows = await env.DB.prepare(
    'SELECT id, pin_position FROM links WHERE user_id = ? AND pin_position IS NOT NULL ORDER BY pin_position',
  )
    .bind(user.id)
    .all<{ id: string; pin_position: number }>();
  return rows.results.map((r) => [r.id, r.pin_position]);
}

/** Puts the link in a new workspace of the user's; returns the workspace's id. */
async function addToWorkspace(user: TestUser, link: string): Promise<string> {
  const w = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO workspaces (id, user_id, name, name_key, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(w, user.id, `w-${w}`, `w-${w}`, '2027-01-01T00:00:00.000Z'),
    env.DB.prepare(
      'INSERT INTO workspace_links (workspace_id, link_id, position) VALUES (?, ?, 1)',
    ).bind(w, link),
  ]);
  return w;
}

/** Seeds one link archived at `at`. */
async function seedArchived(
  user: TestUser,
  at: number,
  opts: { useCount?: number; url?: string } = {},
): Promise<string> {
  const [id = ''] = await seedLinks(user, [
    {
      url: opts.url ?? `https://kept-${crypto.randomUUID()}.example/`,
      state: 'archived',
      useCount: opts.useCount ?? 0,
      lastUsedAt: new Date(at - 1000).toISOString(),
    },
  ]);
  await env.DB.prepare('UPDATE links SET archived_at = ?, updated_at = ? WHERE id = ?')
    .bind(new Date(at).toISOString(), new Date(at).toISOString(), id)
    .run();
  return id;
}

describe('archiving a link', () => {
  it.each(['active', 'pending', 'unreachable', 'expired'])(
    'archives a %s link at once, unpins it and keeps its workspaces',
    async (state) => {
      setNow(T);
      const user = await signIn();
      const [link = '', second = '', third = ''] = await seedLinks(user, [
        { url: 'https://kept.example/', state, pinPosition: 1 },
        { url: 'https://second.example/', state: 'active', pinPosition: 2 },
        { url: 'https://third.example/', state: 'active', pinPosition: 3 },
      ]);
      if (state === 'expired') {
        await env.DB.prepare('UPDATE links SET expired_at = ? WHERE id = ?')
          .bind(new Date(T - 86_400_000).toISOString(), link)
          .run();
      }
      const workspace = await addToWorkspace(user, link);
      recordFetchQueue();
      const t = T + 5_000;
      setNow(t);
      const r = await api('POST', `/api/v1/links/${link}/archive`, { as: user.session });
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({
        id: link,
        state: 'archived',
        archived_at: new Date(t).toISOString(),
        expired_at: null,
        pinned: false,
        pin_position: null,
        workspaces: [{ id: workspace }],
      });
      expect(await pinned(user)).toEqual([
        [second, 1],
        [third, 2],
      ]);
    },
  );

  it('queues one refresh of its page, without touching the refresh window', async () => {
    setNow(T);
    const user = await signIn();
    const recently = new Date(T - 60_000).toISOString();
    const [link = '', fresh = ''] = await seedLinks(user, [
      { url: 'https://kept.example/', state: 'active' },
      { url: 'https://fresh.example/', state: 'active' },
    ]);
    await env.DB.prepare('UPDATE links SET refresh_requested_at = ? WHERE id = ?')
      .bind(recently, link)
      .run();
    const sent = recordFetchQueue();
    await api('POST', `/api/v1/links/${link}/archive`, { as: user.session });
    expect(sent).toEqual([
      { body: { user_id: user.id, link_id: link, refresh: true }, delaySeconds: undefined },
    ]);
    const row = await env.DB.prepare('SELECT refresh_requested_at FROM links WHERE id = ?')
      .bind(link)
      .first<{ refresh_requested_at: string | null }>();
    expect(row?.refresh_requested_at).toBe(recently);

    await api('POST', `/api/v1/links/${fresh}/archive`, { as: user.session });
    const refresh = await api('POST', `/api/v1/links/${fresh}/refresh`, { as: user.session });
    expect(refresh.status).toBe(202);
  });

  it('changes nothing and queues nothing for a link already archived', async () => {
    setNow(T);
    const user = await signIn();
    const earlier = T - 86_400_000;
    const id = await seedArchived(user, earlier);
    const sent = recordFetchQueue();
    const r = await api('POST', `/api/v1/links/${id}/archive`, { as: user.session });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      state: 'archived',
      archived_at: new Date(earlier).toISOString(),
      updated_at: new Date(earlier).toISOString(),
    });
    expect(sent).toEqual([]);
  });

  it('keeps the link archived and says so in its history when the refresh cannot be queued', async () => {
    setNow(T);
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: 'https://kept.example/', state: 'active' }]);
    env.FETCH_QUEUE = {
      send: () => Promise.reject(new Error('the queue is down')),
    } as unknown as typeof env.FETCH_QUEUE;
    const r = await api('POST', `/api/v1/links/${id}/archive`, { as: user.session });
    expect(r.status).toBe(200);
    expect(r.json.state).toBe('archived');
    const history = await api('GET', `/api/v1/links/${id}/history`, { as: user.session });
    expect(history.json.items).toContainEqual(
      expect.objectContaining({
        kind: 'fetch',
        outcome: 'failed',
        reason: 'refresh before archiving could not be queued',
      }),
    );
  });
});

describe('unarchiving a link', () => {
  it('makes it active with its points reset, without counting a use or pinning it', async () => {
    setNow(T);
    const user = await signIn();
    const id = await seedArchived(user, T - 300 * 86_400_000, { useCount: 3 });
    const t = T + 5_000;
    setNow(t);
    const r = await api('POST', `/api/v1/links/${id}/unarchive`, { as: user.session });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      state: 'active',
      archived_at: null,
      pinned: false,
      use_count: 3,
      last_used_at: new Date(t).toISOString(),
      points: 63,
    });
    const stream = await api('GET', '/api/v1/links', { as: user.session });
    expect(stream.json.items.map((l: { id: string }) => l.id)).toContain(id);
  });

  it.each(['active', 'pending', 'unreachable', 'expired'])(
    'is refused for a %s link',
    async (state) => {
      setNow(T);
      const user = await signIn();
      const [id = ''] = await seedLinks(user, [{ url: 'https://here.example/', state }]);
      const before = await env.DB.prepare(
        'SELECT state, last_used_at, expired_at, archived_at FROM links WHERE id = ?',
      )
        .bind(id)
        .first();
      const r = await api('POST', `/api/v1/links/${id}/unarchive`, { as: user.session });
      expect(r.status).toBe(409);
      expect(r.json).toEqual({ error: 'not_archived', message: 'this link is not archived' });
      expect(
        await env.DB.prepare(
          'SELECT state, last_used_at, expired_at, archived_at FROM links WHERE id = ?',
        )
          .bind(id)
          .first(),
      ).toEqual(before);
    },
  );
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

/** Seeds links archived at the given times, one each. */
async function seedArchivedAt(user: TestUser, times: number[]): Promise<string[]> {
  const ids = await seedLinks(
    user,
    times.map((_, i) => ({ url: `https://archived${i}.example/`, state: 'archived' })),
  );
  await env.DB.batch(
    ids.map((id, i) =>
      env.DB.prepare('UPDATE links SET archived_at = ? WHERE id = ?').bind(
        new Date(times[i]!).toISOString(),
        id,
      ),
    ),
  );
  return ids;
}

describe('the archive list', () => {
  it('lists the archived links most recently archived first, without a removal date', async () => {
    setNow(T);
    const user = await signIn();
    const other = await signIn('other@example.test', 'Other');
    const [a = '', b = '', c = '', tie = ''] = await seedArchivedAt(user, [
      T - 3_000,
      T - 1_000,
      T - 2_000,
      T - 2_000,
    ]);
    const [active = ''] = await seedLinks(user, [
      { url: 'https://active.example/', state: 'active' },
    ]);
    const [expired = ''] = await seedExpired(user, [T]);
    await seedArchivedAt(other, [T]);
    const r = await api('GET', '/api/v1/archive', { as: user.session });
    expect(r.status).toBe(200);
    const listed = r.json.items.map((l: { id: string }) => l.id);
    expect(listed).toEqual([b, ...[c, tie].sort().reverse(), a]);
    expect(listed).not.toContain(active);
    expect(listed).not.toContain(expired);
    for (const l of r.json.items) {
      expect(l.archived_at).not.toBeNull();
      expect(l.removal_at).toBeNull();
    }
    expect(r.json.next_cursor).toBeNull();
  });

  it('pages them with limit and cursor, every archived link once', async () => {
    setNow(T);
    const user = await signIn();
    const ids = await seedArchivedAt(
      user,
      Array.from({ length: 123 }, (_, i) => T - Math.floor(i / 3) * 1000),
    );
    const seen: string[] = [];
    const sizes: number[] = [];
    let cursor: string | null = null;
    do {
      const page: { json: { items: { id: string }[]; next_cursor: string | null } } = await api(
        'GET',
        `/api/v1/archive?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { as: user.session },
      );
      sizes.push(page.json.items.length);
      seen.push(...page.json.items.map((l) => l.id));
      cursor = page.json.next_cursor;
    } while (cursor);
    expect(sizes).toEqual([100, 23]);
    expect([...seen].sort()).toEqual([...ids].sort());
    const first = await api('GET', '/api/v1/archive', { as: user.session });
    expect(first.json.items).toHaveLength(50);
  });

  it.each([
    { query: 'limit=0', error: 'invalid_limit', field: 'limit' },
    { query: 'limit=101', error: 'invalid_limit', field: 'limit' },
    { query: 'limit=x', error: 'invalid_limit', field: 'limit' },
    { query: 'cursor=garbage', error: 'invalid_cursor', field: 'cursor' },
    { query: 'expired list cursor', error: 'invalid_cursor', field: 'cursor' },
  ])('refuses $query', async ({ query, error, field }) => {
    setNow(T);
    const user = await signIn();
    await seedExpired(user, [T - 1000, T - 2000]);
    let q = query;
    if (query === 'expired list cursor') {
      const expired = await api('GET', '/api/v1/expired?limit=1', { as: user.session });
      q = `cursor=${encodeURIComponent(expired.json.next_cursor)}`;
    }
    const r = await api('GET', `/api/v1/archive?${q}`, { as: user.session });
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
  it('is answered as one that does not exist by archive, unarchive, restore and check', async () => {
    setNow(T);
    const a = await signIn('a@example.test', 'A');
    const b = await signIn('b@example.test', 'B');
    const theirs = await seedLinks(b, [
      { url: 'https://b-only.example/', state: 'expired' },
      { url: 'https://b-kept.example/', state: 'archived' },
    ]);
    const origin = new FakeOrigin();
    for (const url of ['https://b-only.example/', 'https://b-kept.example/']) {
      origin.byMethod(url, { HEAD: () => new Response(null, { status: 200 }) });
    }
    const rows = () =>
      env.DB.prepare('SELECT * FROM links WHERE user_id = ? ORDER BY id').bind(b.id).all();
    const before = (await rows()).results;
    for (const link of theirs) {
      for (const action of ['archive', 'unarchive', 'restore', 'check']) {
        const r = await api('POST', `/api/v1/links/${link}/${action}`, { as: a.session });
        const unknown = await api('POST', `/api/v1/links/${crypto.randomUUID()}/${action}`, {
          as: a.session,
        });
        expect([r.status, r.json], action).toEqual([404, { error: 'not_found' }]);
        expect([unknown.status, unknown.json]).toEqual([404, { error: 'not_found' }]);
      }
    }
    expect((await rows()).results).toEqual(before);
    expect(origin.log).toEqual([]);
  });
});

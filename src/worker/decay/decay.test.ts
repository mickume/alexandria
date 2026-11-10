import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import worker from '../index';
import {
  api,
  createToken,
  env,
  seedLinks,
  setNow,
  signIn,
  type ApiOptions,
  type TestUser,
} from '../test/helpers';
import { decayHooks, evaluateDecay } from './decay';

const DAY = 86_400_000;
const T = Date.parse('2027-06-01T12:00:00.000Z');

const tokens = new Map<string, string>();

/**
 * Authenticates as `user` with a personal access token: these tests move the
 * clock by months, past any session's expiry.
 */
async function as(user: TestUser, extra: ApiOptions = {}): Promise<ApiOptions> {
  if (!tokens.has(user.id)) tokens.set(user.id, (await createToken(user)).secret);
  return { ...extra, bearer: tokens.get(user.id) };
}

/** Seeds one link last used `days` before T, with optional state, pin and workspace. */
async function seedAged(
  user: TestUser,
  days: number,
  opts: { state?: string; pinned?: boolean; member?: boolean; url?: string } = {},
) {
  const [id = ''] = await seedLinks(user, [
    {
      url: opts.url ?? `https://aged-${Math.random().toString(36).slice(2)}.example/`,
      state: opts.state ?? 'active',
      lastUsedAt: new Date(T - days * DAY).toISOString(),
      addedAt: new Date(T - (days + 1) * DAY).toISOString(),
      pinPosition: opts.pinned ? 1 : null,
    },
  ]);
  if (opts.member) {
    const w = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO workspaces (id, user_id, name, name_key, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(w, user.id, w, w, '2027-01-01T00:00:00.000Z'),
      env.DB.prepare(
        'INSERT INTO workspace_links (workspace_id, link_id, position) VALUES (?, ?, 1)',
      ).bind(w, id),
    ]);
  }
  return id;
}

/** Records `uses` through the open endpoint, each at its own time. */
async function useAt(user: TestUser, id: string, times: number[]) {
  for (const t of times) {
    setNow(t);
    await api('GET', `/api/v1/links/${id}/open`, await as(user));
  }
}

async function stateOf(id: string): Promise<string | undefined> {
  return (
    await env.DB.prepare('SELECT state FROM links WHERE id = ?').bind(id).first<{ state: string }>()
  )?.state;
}

const DEFAULTS = { start_points: 60, remove_days: 180 };

function thresholds(user: TestUser) {
  return api('GET', '/api/v1/settings/decay', { as: user.session });
}

function save(user: TestUser, body: unknown) {
  return api('PUT', '/api/v1/settings/decay', { as: user.session, body });
}

describe('the decay settings', () => {
  it('are 60 start points and 180 days to removal for a user who never changed them', async () => {
    const r = await thresholds(await signIn());
    expect(r.status).toBe(200);
    expect(r.json).toEqual(DEFAULTS);
  });

  it('are stored per user and apply to the points of every link at once', async () => {
    setNow(T);
    const user = await signIn();
    const other = await signIn('other@example.test', 'Other');
    const id = await seedAged(user, 8);
    const r = await save(user, { start_points: 7, remove_days: 3650 });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ start_points: 7, remove_days: 3650 });
    expect((await thresholds(user)).json).toEqual({ start_points: 7, remove_days: 3650 });
    expect((await api('GET', `/api/v1/links/${id}`, { as: user.session })).json.points).toBe(-1);
    await evaluateDecay(env, user.id);
    expect(await stateOf(id)).toBe('expired');
    expect((await thresholds(other)).json).toEqual(DEFAULTS);
    expect((await save(user, { start_points: 3650, remove_days: 7 })).status).toBe(200);
  });

  it.each([
    { body: { remove_days: 180 }, field: 'start_points' },
    { body: { start_points: 60 }, field: 'remove_days' },
    { body: { start_points: 6, remove_days: 180 }, field: 'start_points' },
    { body: { start_points: 60, remove_days: 3651 }, field: 'remove_days' },
    { body: { start_points: 7.5, remove_days: 180 }, field: 'start_points' },
    { body: { start_points: '60', remove_days: 180 }, field: 'start_points' },
  ])('refuses $body', async ({ body, field }) => {
    const user = await signIn();
    const r = await save(user, body);
    expect(r.status).toBe(400);
    expect(r.json).toEqual({
      error: 'invalid_threshold',
      field,
      message: `${field} must be a whole number from 7 to 3650`,
    });
    expect((await thresholds(user)).json).toEqual(DEFAULTS);
  });
});

describe('a link’s points', () => {
  it.each([
    { uses: 0, unused: 0, points: 60 },
    { uses: 0, unused: DAY - 60_000, points: 60 },
    { uses: 0, unused: DAY, points: 59 },
    { uses: 10, unused: 5 * DAY, points: 65 },
    { uses: 0, unused: 61 * DAY, points: -1 },
    { uses: 3, unused: 200 * DAY, points: -137 },
  ])(
    'are start points plus $uses uses minus whole days in $unused ms unused: $points',
    async ({ uses, unused, points }) => {
      const user = await signIn();
      const [id = ''] = await seedLinks(user, [
        {
          url: 'https://points.example/',
          state: 'active',
          useCount: uses,
          lastUsedAt: new Date(T - unused).toISOString(),
        },
      ]);
      setNow(T);
      const link = (await api('GET', `/api/v1/links/${id}`, await as(user))).json;
      expect(link.points).toBe(points);
      expect(link.expired_at).toBeNull();
      expect('sticky' in link).toBe(false);
      expect(link.archived_at).toBeNull();
    },
  );
});

describe('why a link is in its state', () => {
  /** Seeds a link with `points` at T: unused for start points + uses - points days. */
  const withPoints = (u: TestUser, points: number, opts: Parameters<typeof seedAged>[2] = {}) =>
    seedAged(u, 60 - points, opts);
  it.each([
    {
      label: 'active with 42 points',
      setup: (u: TestUser) => withPoints(u, 42),
      note: 'expires in 42 days',
    },
    {
      label: 'active with 1 point',
      setup: (u: TestUser) => withPoints(u, 1),
      note: 'expires in 1 day',
    },
    {
      label: 'pending with 0 points',
      setup: (u: TestUser) => withPoints(u, 0, { state: 'pending' }),
      note: 'expires today',
    },
    {
      label: 'active with -2 points',
      setup: (u: TestUser) => withPoints(u, -2),
      note: 'expires today',
    },
    {
      label: 'pinned with -3 points',
      setup: (u: TestUser) => withPoints(u, -3, { pinned: true }),
      note: 'pinned: never expires, -3 points',
    },
    {
      label: 'in a workspace with 12 points',
      setup: (u: TestUser) => withPoints(u, 12, { member: true }),
      note: 'in a workspace: never expires, 12 points',
    },
    {
      label: 'expired on 2027-03-01 with remove_days 179, pinned',
      setup: async (u: TestUser) => {
        await env.DB.prepare('UPDATE users SET remove_days = 179 WHERE id = ?').bind(u.id).run();
        const id = await seedAged(u, 200, { state: 'expired', pinned: true });
        await env.DB.prepare(
          "UPDATE links SET expired_at = '2027-03-01T08:00:00.000Z' WHERE id = ?",
        )
          .bind(id)
          .run();
        return id;
      },
      note: 'expired on 2027-03-01, removed on 2027-08-27',
    },
    {
      label: 'archived on 2027-03-01, in a workspace',
      setup: async (u: TestUser) => {
        const id = await seedAged(u, 400, { state: 'archived', member: true });
        await env.DB.prepare(
          "UPDATE links SET archived_at = '2027-03-01T08:00:00.000Z' WHERE id = ?",
        )
          .bind(id)
          .run();
        return id;
      },
      note: 'archived on 2027-03-01: kept until deleted',
      fields: { points: null, removal_at: null, archived_at: '2027-03-01T08:00:00.000Z' },
    },
  ])('is said for a link $label', async ({ setup, note, fields }) => {
    setNow(T);
    const user = await signIn();
    const id = await setup(user);
    const link = (await api('GET', `/api/v1/links/${id}`, await as(user))).json;
    expect(link.decay_note).toBe(note);
    expect(link).toMatchObject(fields ?? {});
  });
});

/** Runs the Worker's scheduled handler as the hourly Cron Trigger would. */
async function runScheduled(): Promise<void> {
  const ctx = createExecutionContext();
  await worker.scheduled?.(createScheduledController({ cron: '0 * * * *' }), env, ctx);
  await waitOnExecutionContext(ctx);
}

async function linkRow(id: string) {
  return env.DB.prepare('SELECT state, expired_at FROM links WHERE id = ?')
    .bind(id)
    .first<{ state: string; expired_at: string | null }>();
}

/** Seeds one expired link, expired `days` before T, with optional pin and workspace. */
async function seedExpired(
  user: TestUser,
  days: number,
  opts: { pinned?: boolean; member?: boolean } = {},
) {
  const id = await seedAged(user, 400, { ...opts, state: 'expired' });
  await env.DB.prepare('UPDATE links SET expired_at = ? WHERE id = ?')
    .bind(new Date(T - days * DAY).toISOString(), id)
    .run();
  return id;
}

describe('expiry by decay', () => {
  it.each([
    { state: 'active', uses: 0, unused: 60, opts: {}, expected: 'expired' },
    { state: 'active', uses: 0, unused: 59, opts: {}, expected: 'active' },
    { state: 'active', uses: 10, unused: 70, opts: {}, expected: 'expired' },
    { state: 'active', uses: 10, unused: 69, opts: {}, expected: 'active' },
    { state: 'pending', uses: 0, unused: 60, opts: {}, expected: 'expired' },
    { state: 'unreachable', uses: 0, unused: 61, opts: {}, expected: 'expired' },
    { state: 'active', uses: 0, unused: 400, opts: { pinned: true }, expected: 'active' },
    { state: 'active', uses: 0, unused: 400, opts: { member: true }, expected: 'active' },
    { state: 'archived', uses: 0, unused: 400, opts: {}, expected: 'archived' },
  ])(
    'leaves a link $state with $uses uses, unused $unused days, $opts $expected',
    async ({ state, uses, unused, opts, expected }) => {
      setNow(T);
      const user = await signIn();
      const id = await seedAged(user, unused, { ...opts, state });
      await env.DB.prepare('UPDATE links SET use_count = ? WHERE id = ?').bind(uses, id).run();
      await evaluateDecay(env, user.id);
      const link = (await api('GET', `/api/v1/links/${id}`, await as(user))).json;
      expect(link.state).toBe(expected);
      expect(link.expired_at).toBe(expected === 'expired' ? new Date(T).toISOString() : null);
      // A link kept from expiry still loses its points; an archived link has none.
      expect(link.points).toBe(expected === 'archived' ? null : 60 + uses - unused);
    },
  );

  it('ignores how many days a link was used on: there is no stickiness', async () => {
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: 'https://sticky.example/', state: 'active' }]);
    await useAt(
      user,
      id,
      [0, 1, 2, 3, 4, 5, 5].map((d, i) => T - (77 - d) * DAY + i * 1000),
    );
    setNow(T);
    await evaluateDecay(env, user.id);
    expect(await linkRow(id)).toEqual({ state: 'expired', expired_at: new Date(T).toISOString() });
  });

  it('applies each user’s own start points', async () => {
    setNow(T);
    const user = await signIn();
    await api(
      'PUT',
      '/api/v1/settings/decay',
      await as(user, { body: { start_points: 7, remove_days: 7 } }),
    );
    const expiring = await seedAged(user, 7);
    const kept = await seedAged(user, 6);
    const other = await signIn('other@example.test', 'Other');
    const othersLink = await seedAged(other, 7);
    await evaluateDecay(env, user.id);
    await evaluateDecay(env, other.id);
    expect((await linkRow(expiring))?.state).toBe('expired');
    expect((await linkRow(kept))?.state).toBe('active');
    expect((await linkRow(othersLink))?.state).toBe('active');
  });
});

describe('removal by decay', () => {
  it('deletes a link expired remove_days ago with everything it had, and keeps one a day short', async () => {
    setNow(T);
    const user = await signIn();
    const gone = await seedExpired(user, 180);
    const kept = await seedExpired(user, 179);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO link_uses (link_id, user_id, at) VALUES (?, ?, ?)').bind(
        gone,
        user.id,
        '2026-01-01T00:00:00.000Z',
      ),
      env.DB.prepare('INSERT INTO link_texts (link_id, user_id, text) VALUES (?, ?, ?)').bind(
        gone,
        user.id,
        'text',
      ),
      env.DB.prepare(
        "INSERT INTO link_events (link_id, user_id, kind, at, outcome) VALUES (?, ?, 'fetch', ?, 'ok')",
      ).bind(gone, user.id, '2026-01-01T00:00:00.000Z'),
      env.DB.prepare(
        'INSERT INTO link_passages (vector_id, link_id, user_id, version, position, text) VALUES (?, ?, ?, 1, 0, ?)',
      ).bind(`${gone}-0`, gone, user.id, 'a passage'),
      env.DB.prepare("INSERT INTO tags (id, user_id, name) VALUES ('t-gone', ?, 'gone')").bind(
        user.id,
      ),
      env.DB.prepare(
        "INSERT INTO link_tags (link_id, tag_id, position) VALUES (?, 't-gone', 0)",
      ).bind(gone),
    ]);
    for (const table of ['link_events', 'link_passages', 'link_tags']) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE link_id = ?`)
        .bind(gone)
        .first<{ n: number }>();
      expect(row?.n, table).toBe(1);
    }
    for (const id of [gone, kept])
      await env.SNAPSHOTS.put(`u/${user.id}/l/${id}/snapshot`, '<html>stored</html>');
    await evaluateDecay(env, user.id);
    expect((await api('GET', `/api/v1/links/${gone}`, await as(user))).status).toBe(404);
    expect((await env.SNAPSHOTS.list({ prefix: `u/${user.id}/l/${gone}/` })).objects).toEqual([]);
    for (const table of [
      'links',
      'link_uses',
      'link_texts',
      'link_passages',
      'link_events',
      'link_tags',
      'workspace_links',
    ]) {
      const column = table === 'links' ? 'id' : 'link_id';
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
        .bind(gone)
        .first<{ n: number }>();
      expect(row?.n, table).toBe(0);
    }
    expect((await linkRow(kept))?.state).toBe('expired');
    expect((await env.SNAPSHOTS.list({ prefix: `u/${user.id}/l/${kept}/` })).objects).toHaveLength(
      1,
    );
  });

  it.each([
    { label: 'pinned', opts: { pinned: true } },
    { label: 'in a workspace', opts: { member: true } },
  ])('keeps an expired link $label however long ago it expired', async ({ opts }) => {
    setNow(T);
    const user = await signIn();
    const id = await seedExpired(user, 400, opts);
    await evaluateDecay(env, user.id);
    const r = await api('GET', `/api/v1/links/${id}`, await as(user));
    expect(r.status).toBe(200);
    expect(r.json.state).toBe('expired');
  });

  it('dates an expired link’s removal remove_days after it expired, and no other link’s', async () => {
    setNow(T);
    const user = await signIn();
    const expired = await seedExpired(user, 10);
    const active = await seedAged(user, 10);
    const read = async (id: string) =>
      (await api('GET', `/api/v1/links/${id}`, await as(user))).json.removal_at;
    expect(await read(expired)).toBe(new Date(T - 10 * DAY + 180 * DAY).toISOString());
    expect(await read(active)).toBeNull();
    await api(
      'PUT',
      '/api/v1/settings/decay',
      await as(user, { body: { start_points: 60, remove_days: 30 } }),
    );
    expect(await read(expired)).toBe(new Date(T - 10 * DAY + 30 * DAY).toISOString());
  });
});

describe('one evaluation', () => {
  it('leaves every link in the state the rules give, and a second run changes nothing', async () => {
    setNow(T);
    const user = await signIn();
    const config = fc.record({
      state: fc.constantFrom('pending', 'active', 'unreachable', 'expired', 'archived'),
      uses: fc.integer({ min: 0, max: 50 }),
      unused: fc.integer({ min: 0, max: 1000 }),
      expiredDays: fc.integer({ min: 0, max: 400 }),
      pinned: fc.boolean(),
      member: fc.boolean(),
      dead: fc.boolean(),
    });
    const settings = fc.record({
      start: fc.integer({ min: 7, max: 3650 }),
      remove: fc.integer({ min: 7, max: 3650 }),
    });
    await fc.assert(
      fc.asyncProperty(
        fc.array(config, { minLength: 1, maxLength: 5 }),
        settings,
        async (links, s) => {
          await env.DB.prepare('DELETE FROM links WHERE user_id = ?').bind(user.id).run();
          await env.DB.prepare('UPDATE users SET start_points = ?, remove_days = ? WHERE id = ?')
            .bind(s.start, s.remove, user.id)
            .run();
          const ids: string[] = [];
          for (const l of links) {
            const id = await seedAged(user, l.unused, {
              state: l.state,
              pinned: l.pinned,
              member: l.member,
            });
            await env.DB.prepare(
              'UPDATE links SET use_count = ?, expired_at = ?, dead_since = ? WHERE id = ?',
            )
              .bind(
                l.uses,
                l.state === 'expired' ? new Date(T - l.expiredDays * DAY).toISOString() : null,
                l.dead ? new Date(T - DAY).toISOString() : null,
                id,
              )
              .run();
            ids.push(id);
          }
          await evaluateDecay(env, user.id);
          const after = await Promise.all(ids.map((id) => linkRow(id)));
          links.forEach((l, i) => {
            const kept = l.pinned || l.member;
            let expected: string | null;
            if (l.state === 'archived') expected = 'archived';
            else if (l.state === 'expired')
              expected = !kept && l.expiredDays >= s.remove ? null : 'expired';
            else if (!kept && s.start + l.uses - l.unused <= 0) expected = 'expired';
            else expected = l.state;
            expect(after[i]?.state ?? null).toBe(expected);
          });
          await evaluateDecay(env, user.id);
          expect(await Promise.all(ids.map((id) => linkRow(id)))).toEqual(after);
        },
      ),
      { numRuns: 40 },
    );
  });

  it('leaves a link boosted after selection as the boost left it', async () => {
    setNow(T);
    const user = await signIn();
    const id = await seedAged(user, 60);
    const auth = await as(user);
    decayHooks.afterSelect = async () => {
      await api('GET', `/api/v1/links/${id}/open`, auth);
    };
    try {
      await evaluateDecay(env, user.id);
    } finally {
      decayHooks.afterSelect = undefined;
    }
    expect(await linkRow(id)).toEqual({ state: 'active', expired_at: null });
    const link = (await api('GET', `/api/v1/links/${id}`, auth)).json;
    expect(link.last_used_at).toBe(new Date(T).toISOString());
    const stream = (await api('GET', '/api/v1/links', auth)).json.items.map(
      (l: { id: string }) => l.id,
    );
    expect(stream).toContain(id);
  });
});

describe('the hourly run', () => {
  it('leaves a user whose evaluation fails as it was and evaluates them at the next run', async () => {
    setNow(T);
    const a = await signIn('a@example.test', 'A');
    const b = await signIn('b@example.test', 'B');
    const aLink = await seedAged(a, 60);
    const bLink = await seedAged(b, 60);
    decayHooks.afterSelect = async (userId) => {
      if (userId === a.id) throw new Error('evaluation failed');
    };
    try {
      await runScheduled();
    } finally {
      decayHooks.afterSelect = undefined;
    }
    expect(await linkRow(aLink)).toEqual({ state: 'active', expired_at: null });
    expect((await linkRow(bLink))?.state).toBe('expired');
    const lastDecay = await env.DB.prepare('SELECT last_decay_at FROM users WHERE id = ?')
      .bind(a.id)
      .first<{ last_decay_at: string | null }>();
    expect(lastDecay?.last_decay_at).toBeNull();
    setNow(T + 3_600_000);
    await runScheduled();
    expect((await linkRow(aLink))?.state).toBe('expired');
  });

  it('evaluates exactly the users not evaluated in the last 20 hours', async () => {
    setNow(T);
    const users = [
      await signIn('u19@example.test', 'U19'),
      await signIn('u20@example.test', 'U20'),
      await signIn('never@example.test', 'Never'),
    ];
    const linksOf = await Promise.all(users.map((u) => seedAged(u, 130)));
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET last_decay_at = ? WHERE id = ?').bind(
        new Date(T - 19 * 3_600_000).toISOString(),
        users[0]!.id,
      ),
      env.DB.prepare('UPDATE users SET last_decay_at = ? WHERE id = ?').bind(
        new Date(T - 20 * 3_600_000).toISOString(),
        users[1]!.id,
      ),
    ]);
    await runScheduled();
    expect(await Promise.all(linksOf.map(async (id) => (await linkRow(id))?.state))).toEqual([
      'active',
      'expired',
      'expired',
    ]);
    const times = await Promise.all(
      users.map(
        async (u) =>
          (
            await env.DB.prepare('SELECT last_decay_at FROM users WHERE id = ?')
              .bind(u.id)
              .first<{ last_decay_at: string }>()
          )?.last_decay_at,
      ),
    );
    expect(times).toEqual([
      new Date(T - 19 * 3_600_000).toISOString(),
      new Date(T).toISOString(),
      new Date(T).toISOString(),
    ]);
  });
});

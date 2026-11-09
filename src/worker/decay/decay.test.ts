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

const DEFAULTS = { dormant_days: 60, archive_days: 120, remove_days: 180 };

function thresholds(user: TestUser) {
  return api('GET', '/api/v1/settings/decay', { as: user.session });
}

function save(user: TestUser, body: unknown) {
  return api('PUT', '/api/v1/settings/decay', { as: user.session, body });
}

describe('the decay thresholds', () => {
  it('are 60, 120 and 180 days for a user who never changed them', async () => {
    const r = await thresholds(await signIn());
    expect(r.status).toBe(200);
    expect(r.json).toEqual(DEFAULTS);
  });

  it('are stored per user', async () => {
    const user = await signIn();
    const other = await signIn('other@example.test', 'Other');
    const r = await save(user, { dormant_days: 7, archive_days: 14, remove_days: 7 });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ dormant_days: 7, archive_days: 14, remove_days: 7 });
    expect((await thresholds(user)).json).toEqual({
      dormant_days: 7,
      archive_days: 14,
      remove_days: 7,
    });
    expect((await thresholds(other)).json).toEqual(DEFAULTS);
    expect(
      (await save(user, { dormant_days: 7, archive_days: 3650, remove_days: 3650 })).status,
    ).toBe(200);
  });

  it.each([
    {
      body: { dormant_days: 60, archive_days: 120 },
      error: 'invalid_threshold',
      field: 'remove_days',
    },
    {
      body: { dormant_days: 6, archive_days: 120, remove_days: 180 },
      error: 'invalid_threshold',
      field: 'dormant_days',
    },
    {
      body: { dormant_days: 60, archive_days: 3651, remove_days: 180 },
      error: 'invalid_threshold',
      field: 'archive_days',
    },
    {
      body: { dormant_days: 60, archive_days: 120, remove_days: 7.5 },
      error: 'invalid_threshold',
      field: 'remove_days',
    },
    {
      body: { dormant_days: '60', archive_days: 120, remove_days: 180 },
      error: 'invalid_threshold',
      field: 'dormant_days',
    },
    {
      body: { dormant_days: 120, archive_days: 120, remove_days: 180 },
      error: 'invalid_thresholds',
      field: 'dormant_days',
    },
  ])('refuses $body', async ({ body, error, field }) => {
    const user = await signIn();
    await save(user, { dormant_days: 30, archive_days: 90, remove_days: 30 });
    const r = await save(user, body);
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error, field, message: expect.any(String) });
    if (error === 'invalid_thresholds') {
      expect(r.json.message).toBe('the dormant threshold must be below the archive threshold');
    }
    expect((await thresholds(user)).json).toEqual({
      dormant_days: 30,
      archive_days: 90,
      remove_days: 30,
    });
  });
});

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

describe('dormancy', () => {
  it.each([
    { label: 'active, unused 59 days', days: 59, opts: {}, expected: 'active' },
    { label: 'active, unused 60 days', days: 60, opts: {}, expected: 'dormant' },
    { label: 'pinned, unused 61 days', days: 61, opts: { pinned: true }, expected: 'dormant' },
    {
      label: 'in a workspace, unused 200 days',
      days: 200,
      opts: { member: true },
      expected: 'dormant',
    },
    { label: 'pending, unused 61 days', days: 61, opts: { state: 'pending' }, expected: 'pending' },
    {
      label: 'unreachable, unused 61 days',
      days: 61,
      opts: { state: 'unreachable' },
      expected: 'unreachable',
    },
  ])('leaves a link $label $expected', async ({ days, opts, expected }) => {
    const user = await signIn();
    const id = await seedAged(user, days, opts);
    setNow(T);
    await evaluateDecay(env, user.id);
    expect(await stateOf(id)).toBe(expected);
    if (expected === 'dormant') {
      const stream = await api('GET', '/api/v1/links', await as(user));
      expect(stream.json.items.map((l: { id: string }) => l.id)).toContain(id);
    }
  });

  it.each([
    {
      label: 'an open',
      boost: async (u: TestUser, id: string) => api('GET', `/api/v1/links/${id}/open`, await as(u)),
    },
    {
      label: 'adding it again',
      boost: async (u: TestUser) =>
        api('POST', '/api/v1/links', await as(u, { body: { url: 'https://again.example/' } })),
    },
    {
      label: 'pasting it again',
      boost: async (u: TestUser) =>
        api(
          'POST',
          '/api/v1/links/batch',
          await as(u, { body: { urls: ['https://again.example/'] } }),
        ),
    },
  ])('ends when the link is boosted by $label', async ({ boost }) => {
    const user = await signIn();
    const id = await seedAged(user, 70, { state: 'dormant', url: 'https://again.example' });
    setNow(T);
    await boost(user, id);
    expect((await api('GET', `/api/v1/links/${id}`, await as(user))).json.state).toBe('active');
  });
});

describe('stickiness', () => {
  const midnight = Date.parse('2027-01-10T00:00:00.000Z');
  it.each([
    {
      label: '5 uses on 5 days',
      times: [0, 1, 2, 3, 4].map((d) => midnight + d * DAY + 3_600_000),
      sticky: true,
    },
    {
      label: '10 uses on 4 days',
      times: Array.from({ length: 10 }, (_, i) => midnight + (i % 4) * DAY + i * 60_000),
      sticky: false,
    },
    {
      label: '4 uses on 4 days',
      times: [0, 1, 2, 3].map((d) => midnight + d * DAY),
      sticky: false,
    },
    {
      label: '5 uses just around midnight on 5 UTC days',
      times: [
        midnight - 60_000,
        midnight + 60_000,
        midnight + 2 * DAY - 60_000,
        midnight + 2 * DAY + 60_000,
        midnight + 4 * DAY - 60_000,
      ],
      sticky: true,
    },
  ])('needs at least 5 uses on 5 UTC days: $label', async ({ times, sticky }) => {
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: 'https://sticky.example/', state: 'active' }]);
    await useAt(user, id, times);
    await env.DB.prepare('UPDATE links SET last_used_at = ? WHERE id = ?')
      .bind(new Date(T - 400 * DAY).toISOString(), id)
      .run();
    setNow(T);
    await evaluateDecay(env, user.id);
    const link = (await api('GET', `/api/v1/links/${id}`, await as(user))).json;
    expect(link.state).toBe(sticky ? 'active' : 'archived');
  });

  it('brings a sticky dormant link back to active', async () => {
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: 'https://sticky.example/', state: 'active' }]);
    await useAt(
      user,
      id,
      [0, 1, 2, 3, 4].map((d) => T - (100 - d) * DAY),
    );
    await env.DB.prepare("UPDATE links SET state = 'dormant' WHERE id = ?").bind(id).run();
    setNow(T);
    await evaluateDecay(env, user.id);
    expect(await stateOf(id)).toBe('active');
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
      expect('archived_at' in link).toBe(false);
    },
  );
});

describe('why a link is in its state', () => {
  it.each([
    { label: 'unused 3 days', setup: (u: TestUser) => seedAged(u, 3), note: 'unused for 3 days' },
    {
      label: 'dormant, unused 63 days',
      setup: (u: TestUser) => seedAged(u, 63, { state: 'dormant' }),
      note: 'unused for 2 months',
    },
    {
      label: 'sticky with 7 uses on 6 days',
      setup: async (u: TestUser) => {
        const id = await seedAged(u, 0);
        await useAt(
          u,
          id,
          [1, 2, 3, 4, 5, 6, 6].map((d, i) => T - d * DAY + i * 1000),
        );
        return id;
      },
      note: 'sticky: 7 uses on 6 days, never archived',
    },
    {
      label: 'pinned, unused 90 days',
      setup: (u: TestUser) => seedAged(u, 90, { pinned: true }),
      note: 'pinned: never archived, unused for 3 months',
    },
    {
      label: 'in a workspace, unused 10 days',
      setup: (u: TestUser) => seedAged(u, 10, { member: true }),
      note: 'in a workspace: never archived, unused for 10 days',
    },
    {
      label: 'archived on 2027-03-01',
      setup: async (u: TestUser) => {
        const id = await seedAged(u, 200, { state: 'archived' });
        await env.DB.prepare(
          "UPDATE links SET archived_at = '2027-03-01T08:00:00.000Z' WHERE id = ?",
        )
          .bind(id)
          .run();
        return id;
      },
      note: 'archived on 2027-03-01, removed on 2027-08-28',
    },
  ])('is said for a link $label', async ({ setup, note }) => {
    const user = await signIn();
    const id = await setup(user);
    setNow(T);
    const link = (await api('GET', `/api/v1/links/${id}`, await as(user))).json;
    expect(link.decay_note).toBe(note);
    for (const field of [
      'points',
      'expired_at',
      'removal_at',
      'dead_since',
      'last_checked_at',
      'last_check_result',
    ]) {
      expect(field in link).toBe(true);
    }
  });
});

/** Runs the Worker's scheduled handler as the hourly Cron Trigger would. */
async function runScheduled(): Promise<void> {
  const ctx = createExecutionContext();
  await worker.scheduled?.(createScheduledController({ cron: '0 * * * *' }), env, ctx);
  await waitOnExecutionContext(ctx);
}

async function linkRow(id: string) {
  return env.DB.prepare('SELECT state, archived_at FROM links WHERE id = ?')
    .bind(id)
    .first<{ state: string; archived_at: string | null }>();
}

describe('archiving by decay', () => {
  it.each([
    { label: 'active, unused 120 days', days: 120, opts: {}, expected: 'archived' },
    {
      label: 'dormant, unused 130 days',
      days: 130,
      opts: { state: 'dormant' },
      expected: 'archived',
    },
    {
      label: 'unreachable, unused 125 days',
      days: 125,
      opts: { state: 'unreachable' },
      expected: 'archived',
    },
    {
      label: 'pending, unused 119 days',
      days: 119,
      opts: { state: 'pending' },
      expected: 'pending',
    },
    {
      label: 'pinned dormant, unused 400 days',
      days: 400,
      opts: { state: 'dormant', pinned: true },
      expected: 'dormant',
    },
    {
      label: 'dormant in a workspace, unused 400 days',
      days: 400,
      opts: { state: 'dormant', member: true },
      expected: 'dormant',
    },
    { label: 'dead, unused 120 days', days: 120, opts: { dead: true }, expected: 'archived' },
    { label: 'dead, unused 30 days', days: 30, opts: { dead: true }, expected: 'active' },
  ])('leaves a link $label $expected', async ({ days, opts, expected }) => {
    setNow(T);
    const user = await signIn();
    const id = await seedAged(user, days, opts);
    if ('dead' in opts)
      await env.DB.prepare('UPDATE links SET dead_since = ? WHERE id = ?')
        .bind(new Date(T - 30 * DAY).toISOString(), id)
        .run();
    await evaluateDecay(env, user.id);
    const link = (await api('GET', `/api/v1/links/${id}`, await as(user))).json;
    expect(link.state).toBe(expected);
    const inStream = (await api('GET', '/api/v1/links?limit=100', await as(user))).json.items.some(
      (l: { id: string }) => l.id === id,
    );
    const inArchive =
      (await api('GET', '/api/v1/archive', await as(user))).json.items?.some(
        (l: { id: string }) => l.id === id,
      ) ?? false;
    if (expected === 'archived') {
      expect((await linkRow(id))?.archived_at).toBe(new Date(T).toISOString());
      expect(link.removal_at).toBe(new Date(T + 180 * DAY).toISOString());
      expect([inStream, inArchive]).toEqual([false, true]);
    } else {
      expect((await linkRow(id))?.archived_at).toBeNull();
      expect(inStream).toBe(true);
    }
  });

  it('applies each user’s own thresholds', async () => {
    setNow(T);
    const user = await signIn();
    await api(
      'PUT',
      '/api/v1/settings/decay',
      await as(user, { body: { dormant_days: 7, archive_days: 14, remove_days: 7 } }),
    );
    const dormant = await seedAged(user, 8);
    const archived = await seedAged(user, 15);
    const old = await seedAged(user, 400, { state: 'archived' });
    await env.DB.prepare('UPDATE links SET archived_at = ? WHERE id = ?')
      .bind(new Date(T - 8 * DAY).toISOString(), old)
      .run();
    const other = await signIn('other@example.test', 'Other');
    const othersLink = await seedAged(other, 15);
    await evaluateDecay(env, user.id);
    await evaluateDecay(env, other.id);
    expect((await linkRow(dormant))?.state).toBe('dormant');
    expect((await linkRow(archived))?.state).toBe('archived');
    expect(await linkRow(old)).toBeNull();
    expect((await linkRow(othersLink))?.state).toBe('active');
  });
});

describe('removal by decay', () => {
  it('deletes a link archived remove_days ago with everything it had, and keeps one a day short', async () => {
    setNow(T);
    const user = await signIn();
    const gone = await seedAged(user, 400, { state: 'archived', member: true });
    const kept = await seedAged(user, 400, { state: 'archived' });
    await env.DB.batch([
      env.DB.prepare('UPDATE links SET archived_at = ? WHERE id = ?').bind(
        new Date(T - 180 * DAY).toISOString(),
        gone,
      ),
      env.DB.prepare('UPDATE links SET archived_at = ? WHERE id = ?').bind(
        new Date(T - 179 * DAY).toISOString(),
        kept,
      ),
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
    ]);
    for (const id of [gone, kept])
      await env.SNAPSHOTS.put(`u/${user.id}/l/${id}/snapshot`, '<html>stored</html>');
    await evaluateDecay(env, user.id);
    expect((await api('GET', `/api/v1/links/${gone}`, await as(user))).status).toBe(404);
    expect((await env.SNAPSHOTS.list({ prefix: `u/${user.id}/l/${gone}/` })).objects).toEqual([]);
    for (const table of [
      'links',
      'link_uses',
      'link_texts',
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
    expect((await linkRow(kept))?.state).toBe('archived');
    expect((await env.SNAPSHOTS.list({ prefix: `u/${user.id}/l/${kept}/` })).objects).toHaveLength(
      1,
    );
    const archive = (await api('GET', '/api/v1/archive', await as(user))).json.items.map(
      (l: { id: string }) => l.id,
    );
    expect(archive).toEqual([kept]);
  });
});

describe('one evaluation', () => {
  it('leaves every link in the state the rules give, and a second run changes nothing', async () => {
    setNow(T);
    const user = await signIn();
    const config = fc.record({
      state: fc.constantFrom('pending', 'active', 'unreachable', 'dormant', 'archived'),
      unused: fc.integer({ min: 0, max: 1000 }),
      archivedDays: fc.integer({ min: 0, max: 400 }),
      sticky: fc.boolean(),
      pinned: fc.boolean(),
      member: fc.boolean(),
      dead: fc.boolean(),
    });
    const thresholds = fc
      .tuple(
        fc.integer({ min: 7, max: 3649 }),
        fc.integer({ min: 1, max: 3643 }),
        fc.integer({ min: 7, max: 3650 }),
      )
      .map(([dormant, gap, remove]) => ({
        dormant,
        archive: Math.min(3650, dormant + gap),
        remove,
      }));
    await fc.assert(
      fc.asyncProperty(
        fc.array(config, { minLength: 1, maxLength: 5 }),
        thresholds,
        async (links, t) => {
          await env.DB.prepare('DELETE FROM links WHERE user_id = ?').bind(user.id).run();
          await env.DB.prepare(
            'UPDATE users SET dormant_days = ?, archive_days = ?, remove_days = ? WHERE id = ?',
          )
            .bind(t.dormant, t.archive, t.remove, user.id)
            .run();
          const ids: string[] = [];
          for (const l of links) {
            const id = await seedAged(user, l.unused, {
              state: l.state,
              pinned: l.pinned && l.state !== 'archived',
              member: l.member,
            });
            const statements = [
              env.DB.prepare('UPDATE links SET archived_at = ?, dead_since = ? WHERE id = ?').bind(
                l.state === 'archived' ? new Date(T - l.archivedDays * DAY).toISOString() : null,
                l.dead ? new Date(T - DAY).toISOString() : null,
                id,
              ),
            ];
            if (l.sticky) {
              for (let d = 0; d < 5; d++) {
                statements.push(
                  env.DB.prepare(
                    'INSERT INTO link_uses (link_id, user_id, at) VALUES (?, ?, ?)',
                  ).bind(id, user.id, new Date(T - (l.unused + d) * DAY).toISOString()),
                );
              }
            }
            await env.DB.batch(statements);
            ids.push(id);
          }
          await evaluateDecay(env, user.id);
          const after = await Promise.all(ids.map((id) => linkRow(id)));
          links.forEach((l, i) => {
            const pinned = l.pinned && l.state !== 'archived';
            let expected: string | null;
            if (l.state === 'archived') expected = l.archivedDays >= t.remove ? null : 'archived';
            else if (l.unused >= t.archive && !l.sticky && !pinned && !l.member)
              expected = 'archived';
            else if (l.state === 'dormant' && l.sticky) expected = 'active';
            else if (l.state === 'active' && l.unused >= t.dormant && !l.sticky)
              expected = 'dormant';
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
    const id = await seedAged(user, 130);
    const auth = await as(user);
    decayHooks.afterSelect = async () => {
      await api('GET', `/api/v1/links/${id}/open`, auth);
    };
    try {
      await evaluateDecay(env, user.id);
    } finally {
      decayHooks.afterSelect = undefined;
    }
    expect(await linkRow(id)).toEqual({ state: 'active', archived_at: null });
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
    const aLink = await seedAged(a, 130);
    const bLink = await seedAged(b, 130);
    decayHooks.afterSelect = async (userId) => {
      if (userId === a.id) throw new Error('evaluation failed');
    };
    try {
      await runScheduled();
    } finally {
      decayHooks.afterSelect = undefined;
    }
    expect((await linkRow(aLink))?.state).toBe('active');
    expect((await linkRow(bLink))?.state).toBe('archived');
    setNow(T + 3_600_000);
    await runScheduled();
    expect((await linkRow(aLink))?.state).toBe('archived');
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
      'archived',
      'archived',
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

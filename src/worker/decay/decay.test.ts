import { describe, expect, it } from 'vitest';
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
import { evaluateDecay } from './decay';

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
    expect(link.sticky).toBe(sticky);
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
      'sticky',
      'archived_at',
      'removal_at',
      'dead_since',
      'last_checked_at',
      'last_check_result',
    ]) {
      expect(field in link).toBe(true);
    }
  });
});

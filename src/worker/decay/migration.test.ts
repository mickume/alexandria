import { applyD1Migrations } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { api, emptySchema, env, seedLinks, setNow, signIn } from '../test/helpers';
import { pointsAt } from './note';

const DAY = 86_400_000;

describe('carrying a library over to points and expiry', () => {
  it('makes archived links expired on their archive date, dormant ones active, and keeps each user’s thresholds', async () => {
    await emptySchema();
    await applyD1Migrations(
      env.DB,
      env.TEST_MIGRATIONS.filter((m) => m.name < '0012'),
    );
    const T = Date.parse('2027-03-01T08:00:00.000Z');
    setNow(T);
    const user = await signIn();
    await env.DB.prepare('UPDATE users SET dormant_days = 45, remove_days = 90 WHERE id = ?')
      .bind(user.id)
      .run();
    const [archived = '', dormant = '', active = '', pending = ''] = await seedLinks(user, [
      { url: 'https://archived.example/', state: 'archived' },
      { url: 'https://dormant.example/', state: 'dormant' },
      { url: 'https://active.example/', state: 'active' },
      { url: 'https://pending.example/', state: 'pending' },
    ]);
    await env.DB.prepare('UPDATE links SET archived_at = ? WHERE id = ?')
      .bind(new Date(T).toISOString(), archived)
      .run();

    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

    setNow(T + DAY);
    const read = async (id: string) =>
      (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
    const was = await read(archived);
    expect([was.state, was.expired_at, was.removal_at]).toEqual([
      'expired',
      new Date(T).toISOString(),
      new Date(T + 90 * DAY).toISOString(),
    ]);
    expect((await read(dormant)).state).toBe('active');
    expect((await read(active)).state).toBe('active');
    expect((await read(pending)).state).toBe('pending');
    const settings = await api('GET', '/api/v1/settings/decay', { as: user.session });
    expect(settings.json).toEqual({ start_points: 45, remove_days: 90 });
  });
});

describe('carrying a library over to the decay start', () => {
  it('starts every link’s decay at its last use, so no link’s points change, and gives every user a use boost of 50', async () => {
    await emptySchema();
    await applyD1Migrations(
      env.DB,
      env.TEST_MIGRATIONS.filter((m) => m.name < '0019'),
    );
    const T = Date.parse('2027-03-01T08:00:00.000Z');
    setNow(T);
    const user = await signIn();
    const other = await signIn('other@example.test', 'Other');
    await env.DB.prepare('UPDATE users SET start_points = 45 WHERE id = ?').bind(other.id).run();
    const rows = [
      { owner: user, state: 'active', useCount: 4, days: 3.5 },
      { owner: user, state: 'pending', useCount: 0, days: 0.2 },
      { owner: user, state: 'unreachable', useCount: 2, days: 59 },
      { owner: user, state: 'expired', useCount: 1, days: 80 },
      { owner: user, state: 'archived', useCount: 7, days: 300 },
      { owner: other, state: 'active', useCount: 9, days: 50 },
    ].map((r, i) => ({
      ...r,
      url: `https://carried-${i}.example/`,
      lastUsedAt: new Date(T - r.days * DAY).toISOString(),
    }));
    const ids: string[] = [];
    for (const r of rows) ids.push(...(await seedLinks(r.owner, [r])));

    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

    for (const [i, r] of rows.entries()) {
      const link = (await api('GET', `/api/v1/links/${ids[i]}`, { as: r.owner.session })).json;
      const start = r.owner === other ? 45 : 60;
      expect(link.decay_from).toBe(r.lastUsedAt);
      expect(link.state).toBe(r.state);
      expect(link.points).toBe(
        r.state === 'archived' ? null : pointsAt(start, r.useCount, r.lastUsedAt, T),
      );
    }
    const boosts = await env.DB.prepare('SELECT use_boost FROM users ORDER BY id').all();
    expect(boosts.results).toEqual([{ use_boost: 50 }, { use_boost: 50 }]);
  });
});

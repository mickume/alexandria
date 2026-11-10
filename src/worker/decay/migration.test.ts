import { applyD1Migrations } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { api, emptySchema, env, seedLinks, setNow, signIn } from '../test/helpers';

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

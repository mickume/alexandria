import { applyD1Migrations } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { api, env, seedLinks, setNow, signIn } from '../test/helpers';

const DAY = 86_400_000;

/** Empties the database of every trigger, view and table, so the migrations can be applied from the start. */
async function emptySchema(): Promise<void> {
  const objects = await env.DB.prepare(
    `SELECT type, name FROM sqlite_master
     WHERE type IN ('trigger', 'view', 'table') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
       -- A full-text index's shadow tables go with the index itself.
       AND (type <> 'table' OR sql NOT LIKE 'CREATE TABLE ''%')
     ORDER BY CASE type WHEN 'trigger' THEN 0 WHEN 'view' THEN 1 ELSE 2 END, rowid DESC`,
  ).all<{ type: string; name: string }>();
  await env.DB.batch([
    env.DB.prepare('PRAGMA defer_foreign_keys = on'),
    ...objects.results.map((o) => env.DB.prepare(`DROP ${o.type.toUpperCase()} "${o.name}"`)),
  ]);
}

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

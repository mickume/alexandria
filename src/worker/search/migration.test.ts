import { applyD1Migrations } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { api, emptySchema, env, seedLinks, signIn, type TestUser } from '../test/helpers';

/** Gives the user a topic named `name` and files the link `linkId` under it. */
async function fileUnder(user: TestUser, linkId: string, name: string): Promise<void> {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO topics (id, user_id, name) VALUES (?, ?, ?)').bind(
      id,
      user.id,
      name,
    ),
    env.DB.prepare('UPDATE links SET topic_id = ? WHERE id = ?').bind(id, linkId),
  ]);
}

describe('carrying topics over to the tree', () => {
  it('makes every topic top-level, frees > by renaming, and merges a renamed topic into a namesake', async () => {
    await emptySchema();
    await applyD1Migrations(
      env.DB,
      env.TEST_MIGRATIONS.filter((m) => m.name < '0014'),
    );
    const user = await signIn();
    const [rust = '', cicd = '', spaced = '', clash = '', namesake = '', edited = ''] =
      await seedLinks(user, [
        { url: 'https://rust.example/' },
        { url: 'https://cicd.example/' },
        { url: 'https://spaced.example/' },
        { url: 'https://clash.example/' },
        { url: 'https://namesake.example/' },
        { url: 'https://edited.example/' },
      ]);
    await fileUnder(user, rust, 'Rust');
    await fileUnder(user, cicd, 'CI>CD');
    await fileUnder(user, spaced, 'A > B');
    await fileUnder(user, clash, 'C>D');
    await fileUnder(user, namesake, 'c-d');

    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

    const topics = await env.DB.prepare(
      'SELECT name, parent_id FROM topics WHERE user_id = ? ORDER BY name COLLATE NOCASE',
    )
      .bind(user.id)
      .all<{ name: string; parent_id: string | null }>();
    expect(topics.results).toEqual([
      { name: 'A - B', parent_id: null },
      { name: 'c-d', parent_id: null },
      { name: 'CI-CD', parent_id: null },
      { name: 'Rust', parent_id: null },
    ]);
    const topicOf = async (id: string) =>
      (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json.topic;
    expect(await topicOf(rust)).toBe('Rust');
    expect(await topicOf(cicd)).toBe('CI-CD');
    expect(await topicOf(spaced)).toBe('A - B');
    expect(await topicOf(clash)).toBe('c-d');
    expect(await topicOf(namesake)).toBe('c-d');
    const aliases = await env.DB.prepare(
      `SELECT a.name, t.name AS survivor FROM topic_aliases a JOIN topics t ON t.id = a.topic_id
       WHERE a.user_id = ? ORDER BY a.name`,
    )
      .bind(user.id)
      .all<{ name: string; survivor: string }>();
    expect(aliases.results).toEqual([
      { name: 'A > B', survivor: 'A - B' },
      { name: 'C>D', survivor: 'c-d' },
      { name: 'CI>CD', survivor: 'CI-CD' },
    ]);

    const r = await api('PATCH', `/api/v1/links/${edited}`, {
      as: user.session,
      body: { topic: 'ci-cd' },
    });
    expect(r.status).toBe(200);
    expect(r.json.topic).toBe('CI-CD');
  });
});

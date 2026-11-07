import { describe, expect, it } from 'vitest';
import { api, env, seedLinks, signIn, type TestUser } from '../test/helpers';
import { listVocabulary } from '../enrich/vocabulary';

async function patch(user: TestUser, id: string, body: Record<string, unknown>) {
  const r = await api('PATCH', `/api/v1/links/${id}`, { as: user.session, body });
  expect(r.status).toBe(200);
}

const routes = [
  { route: '/api/v1/topics', label: (name: string) => ({ topic: name }) },
  { route: '/api/v1/tags', label: (name: string) => ({ tags: [name] }) },
];

describe('the topics and tags lists', () => {
  it.each(routes)(
    '$route lists each with its count and newest link, newest first',
    async ({ route, label }) => {
      const user = await signIn();
      const other = await signIn('other@example.test');
      const [l1, l2, l3, l4] = await seedLinks(user, [
        { url: 'https://one.example/', addedAt: '2026-01-01T00:00:00.000Z' },
        { url: 'https://two.example/', addedAt: '2026-01-02T00:00:00.000Z', state: 'archived' },
        { url: 'https://three.example/', addedAt: '2026-01-03T00:00:00.000Z' },
        { url: 'https://four.example/', addedAt: '2026-01-04T00:00:00.000Z' },
      ]);
      for (const id of [l1, l2, l3]) await patch(user, id!, label('infra'));
      await patch(user, l4!, label('cooking'));
      const [theirs] = await seedLinks(other, [{ url: 'https://theirs.example/' }]);
      await patch(other, theirs!, label('secret'));

      const r = await api('GET', route, { as: user.session });
      expect(r.status).toBe(200);
      expect(
        r.json.items.map(({ id, ...rest }: { id: string }) => (expect(id).toBeTruthy(), rest)),
      ).toEqual([
        { name: 'cooking', count: 1, newest_added_at: '2026-01-04T00:00:00.000Z' },
        { name: 'infra', count: 3, newest_added_at: '2026-01-03T00:00:00.000Z' },
      ]);
      expect(r.json.next_cursor).toBeNull();
    },
  );

  it.each(routes)('$route pages with the cursor', async ({ route, label }) => {
    const user = await signIn();
    const ids = await seedLinks(
      user,
      Array.from({ length: 5 }, (_, i) => ({
        url: `https://l${i}.example/`,
        addedAt: `2026-01-0${i + 1}T00:00:00.000Z`,
      })),
    );
    for (const [i, id] of ids.entries()) await patch(user, id, label(`name${i}`));
    const names: string[] = [];
    let cursor: string | null = null;
    do {
      const r: { json: { items: { name: string }[]; next_cursor: string | null } } = await api(
        'GET',
        `${route}?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { as: user.session },
      );
      names.push(...r.json.items.map((i) => i.name));
      cursor = r.json.next_cursor;
    } while (cursor);
    expect(names.map((n) => n.toLowerCase())).toEqual([
      'name4',
      'name3',
      'name2',
      'name1',
      'name0',
    ]);
    const bad = await api('GET', `${route}?cursor=forged`, { as: user.session });
    expect(bad.json.error).toBe('invalid_cursor');
  });

  describe('a topic or tag whose last link loses it is gone', () => {
    it.each([
      {
        write: "editing the only link's tags away",
        route: '/api/v1/tags',
        kind: 'tags' as const,
        setup: { tags: ['solo'] },
        act: (u: TestUser, id: string) => patch(u, id, { tags: [] }),
      },
      {
        write: 'deleting the only link tagged',
        route: '/api/v1/tags',
        kind: 'tags' as const,
        setup: { tags: ['solo'] },
        act: async (u: TestUser, id: string) => {
          await api('DELETE', `/api/v1/links/${id}`, { as: u.session });
        },
      },
      {
        write: "editing the only link's topic away",
        route: '/api/v1/topics',
        kind: 'topics' as const,
        setup: { topic: 'Solo' },
        act: (u: TestUser, id: string) => patch(u, id, { topic: 'Other' }),
      },
      {
        write: 'deleting the only link with the topic',
        route: '/api/v1/topics',
        kind: 'topics' as const,
        setup: { topic: 'Solo' },
        act: async (u: TestUser, id: string) => {
          await api('DELETE', `/api/v1/links/${id}`, { as: u.session });
        },
      },
      {
        write: 'decay removing the only link with the tag',
        route: '/api/v1/tags',
        kind: 'tags' as const,
        setup: { tags: ['solo'] },
        act: async (u: TestUser, id: string) => {
          await env.DB.prepare(
            "UPDATE links SET state = 'archived', archived_at = '2020-01-01T00:00:00.000Z' WHERE id = ?",
          )
            .bind(id)
            .run();
          const { runScheduled } = await import('../decay/cron');
          await runScheduled(env);
          expect(
            await env.DB.prepare('SELECT id FROM links WHERE id = ?').bind(id).first(),
          ).toBeNull();
        },
      },
    ])('$write', async ({ route, kind, setup, act }) => {
      const user = await signIn();
      const [keep, only] = await seedLinks(user, [
        { url: 'https://keep.example/' },
        { url: 'https://only.example/' },
      ]);
      await patch(user, keep!, kind === 'tags' ? { tags: ['kept'] } : { topic: 'Kept' });
      await patch(user, only!, setup);
      await act(user, only!);
      const names = async () =>
        (await api('GET', route, { as: user.session })).json.items.map((i: { name: string }) =>
          i.name.toLowerCase(),
        );
      expect(await names()).not.toContain('solo');
      expect(await names()).toContain('kept');
      const vocabulary = await listVocabulary(env.DB, user.id);
      expect(vocabulary[kind].map((n) => n.toLowerCase())).not.toContain('solo');
      expect(vocabulary[kind].map((n) => n.toLowerCase())).toContain('kept');
    });

    it('keeps a tag that an edit keeps', async () => {
      const user = await signIn();
      const [only] = await seedLinks(user, [{ url: 'https://only.example/' }]);
      await patch(user, only!, { tags: ['solo', 'b'] });
      await patch(user, only!, { tags: ['b', 'solo', 'c'] });
      const link = await api('GET', `/api/v1/links/${only}`, { as: user.session });
      expect(link.json.tags).toEqual(['b', 'solo', 'c']);
    });
  });
});

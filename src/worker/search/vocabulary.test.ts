import { describe, expect, it } from 'vitest';
import { api, env, placeTopic, seedLinks, setNow, signIn, type TestUser } from '../test/helpers';
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
  it.each(routes.filter((r) => r.route === '/api/v1/tags'))(
    '$route lists each with its count and newest link, newest first',
    async ({ route, label }) => {
      const user = await signIn();
      const other = await signIn('other@example.test');
      const [l1, l2, l3, l4] = await seedLinks(user, [
        { url: 'https://one.example/', addedAt: '2026-01-01T00:00:00.000Z' },
        { url: 'https://two.example/', addedAt: '2026-01-02T00:00:00.000Z', state: 'expired' },
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

  it('/api/v1/topics lists every topic with its parent, its own and its subtree counts, newest link first', async () => {
    const user = await signIn();
    const other = await signIn('other@example.test');
    const [a, c1, c2, d] = await seedLinks(user, [
      { url: 'https://a.example/', addedAt: '2026-01-01T00:00:00.000Z', state: 'expired' },
      { url: 'https://c1.example/', addedAt: '2026-01-03T00:00:00.000Z' },
      { url: 'https://c2.example/', addedAt: '2026-01-05T00:00:00.000Z' },
      { url: 'https://d.example/', addedAt: '2026-01-04T00:00:00.000Z' },
    ]);
    await patch(user, a!, { topic: 'A' });
    await patch(user, c1!, { topic: 'B' });
    await patch(user, c2!, { topic: 'C' });
    await patch(user, d!, { topic: 'D' });
    await placeTopic(user, 'B', 'A');
    await placeTopic(user, 'C', 'B');
    await patch(user, c1!, { topic: 'C' });
    const [theirs] = await seedLinks(other, [{ url: 'https://theirs.example/' }]);
    await patch(other, theirs!, { topic: 'Secret' });

    const r = await api('GET', '/api/v1/topics', { as: user.session });
    expect(r.status).toBe(200);
    const items = r.json.items as {
      id: string;
      name: string;
      parent_id: string | null;
      newest_added_at: string;
    }[];
    const id = (name: string) => items.find((i) => i.name === name)!.id;
    const newest = '2026-01-05T00:00:00.000Z';
    expect(Object.fromEntries(items.map(({ name, ...rest }) => [name, rest]))).toEqual({
      A: { id: id('A'), parent_id: null, count: 1, subtree_count: 3, newest_added_at: newest },
      B: { id: id('B'), parent_id: id('A'), count: 0, subtree_count: 2, newest_added_at: newest },
      C: { id: id('C'), parent_id: id('B'), count: 2, subtree_count: 2, newest_added_at: newest },
      D: {
        id: id('D'),
        parent_id: null,
        count: 1,
        subtree_count: 1,
        newest_added_at: '2026-01-04T00:00:00.000Z',
      },
    });
    const order = [...items].sort(
      (x, y) =>
        y.newest_added_at.localeCompare(x.newest_added_at) ||
        (y.id < x.id ? -1 : y.id > x.id ? 1 : 0),
    );
    expect(items.map((i) => i.name)).toEqual(order.map((i) => i.name));
    expect(r.json.next_cursor).toBeNull();
  });

  it('/api/v1/topics keeps and lists a topic that has lost its links but has a child', async () => {
    const user = await signIn();
    const [onA, onB] = await seedLinks(user, [
      { url: 'https://a.example/' },
      { url: 'https://b.example/' },
    ]);
    await patch(user, onA!, { topic: 'A' });
    await patch(user, onB!, { topic: 'B' });
    await placeTopic(user, 'B', 'A');
    await patch(user, onA!, { topic: 'Other' });
    const items = (await api('GET', '/api/v1/topics', { as: user.session })).json.items as {
      id: string;
      name: string;
      parent_id: string | null;
      count: number;
      subtree_count: number;
    }[];
    const a = items.find((i) => i.name === 'A')!;
    expect(a).toMatchObject({ count: 0, subtree_count: 1, parent_id: null });
    expect(items.find((i) => i.name === 'B')!.parent_id).toBe(a.id);
  });

  it('/api/v1/topics pages a tree with the cursor, every topic once', async () => {
    const user = await signIn();
    const ids = await seedLinks(
      user,
      Array.from({ length: 4 }, (_, i) => ({
        url: `https://t${i}.example/`,
        addedAt: `2026-01-0${i + 1}T00:00:00.000Z`,
      })),
    );
    for (const [i, id] of ids.entries()) await patch(user, id, { topic: `T${i}` });
    // T4 holds no link of its own: it shares its newest link with its only child, T3.
    const [lift] = await seedLinks(user, [{ url: 'https://lift.example/' }]);
    await patch(user, lift!, { topic: 'T4' });
    await placeTopic(user, 'T3', 'T4');
    await api('DELETE', `/api/v1/links/${lift}`, { as: user.session });
    const seen: { name: string; newest_added_at: string; id: string }[] = [];
    let cursor: string | null = null;
    do {
      const r: {
        json: {
          items: { name: string; newest_added_at: string; id: string }[];
          next_cursor: string | null;
        };
      } = await api(
        'GET',
        `/api/v1/topics?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { as: user.session },
      );
      seen.push(...r.json.items);
      cursor = r.json.next_cursor;
    } while (cursor);
    expect(seen.map((t) => t.name).sort()).toEqual(['T0', 'T1', 'T2', 'T3', 'T4']);
    const order = [...seen].sort(
      (x, y) =>
        y.newest_added_at.localeCompare(x.newest_added_at) ||
        (y.id < x.id ? -1 : y.id > x.id ? 1 : 0),
    );
    expect(seen.map((t) => t.name)).toEqual(order.map((t) => t.name));
    const bad = await api('GET', '/api/v1/topics?cursor=forged', { as: user.session });
    expect(bad.json.error).toBe('invalid_cursor');
  });

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
            "UPDATE links SET state = 'expired', expired_at = '2020-01-01T00:00:00.000Z' WHERE id = ?",
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
      expect(vocabulary[kind].map((e) => e.name.toLowerCase())).not.toContain('solo');
      expect(vocabulary[kind].map((e) => e.name.toLowerCase())).toContain('kept');
    });

    describe('and so is each parent it leaves with no link and no child', () => {
      const writes = [
        {
          write: "editing the link's topic away",
          act: (u: TestUser, id: string) => patch(u, id, { topic: 'Other' }),
        },
        {
          write: 'deleting the link',
          act: async (u: TestUser, id: string) => {
            await api('DELETE', `/api/v1/links/${id}`, { as: u.session });
          },
        },
        {
          write: 'decay removing the link',
          act: async (_u: TestUser, id: string) => {
            await env.DB.prepare(
              "UPDATE links SET state = 'expired', expired_at = '2020-01-01T00:00:00.000Z' WHERE id = ?",
            )
              .bind(id)
              .run();
            const { runScheduled } = await import('../decay/cron');
            await runScheduled(env);
          },
        },
      ];
      const trees = [
        { tree: 'only C has a link', extra: {}, left: [] },
        { tree: 'A has a link of its own', extra: { A: true }, left: ['A'] },
        { tree: 'B has a second child D with a link', extra: { D: true }, left: ['A', 'B', 'D'] },
      ];
      it.each(writes.flatMap((w) => trees.map((t) => ({ ...w, ...t }))))(
        '$write when $tree',
        async ({ act, extra, left }) => {
          const user = await signIn();
          const [onC, onA, onD] = await seedLinks(user, [
            { url: 'https://c.example/' },
            { url: 'https://a.example/' },
            { url: 'https://d.example/' },
          ]);
          // Each topic is created by a link, placed, and the placing links moved on.
          await patch(user, onC!, { topic: 'C' });
          await patch(user, onA!, { topic: 'A' });
          await patch(user, onD!, { topic: 'B' });
          await placeTopic(user, 'B', 'A');
          await placeTopic(user, 'C', 'B');
          if ('D' in extra) {
            await patch(user, onD!, { topic: 'D' });
            await placeTopic(user, 'D', 'B');
          } else {
            await api('DELETE', `/api/v1/links/${onD}`, { as: user.session });
          }
          if (!('A' in extra)) await api('DELETE', `/api/v1/links/${onA}`, { as: user.session });
          expect(await topicNames(user)).toEqual(['A', 'B', 'C', ...('D' in extra ? ['D'] : [])]);

          await act(user, onC!);
          expect((await topicNames(user)).filter((n) => n !== 'Other')).toEqual(left);
        },
      );
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

/** The name of the parent of the user's topic `name`, or null at the top level. */
async function parentOf(user: TestUser, name: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT p.name FROM topics t LEFT JOIN topics p ON p.id = t.parent_id
     WHERE t.user_id = ? AND t.name = ?`,
  )
    .bind(user.id, name)
    .first<{ name: string | null }>();
  return row!.name;
}

/** The names of the user's topics, in order. */
async function topicNames(user: TestUser): Promise<string[]> {
  const rows = await env.DB.prepare('SELECT name FROM topics WHERE user_id = ? ORDER BY name')
    .bind(user.id)
    .all<{ name: string }>();
  return rows.results.map((r) => r.name);
}

/** The user's topic or tag named `name`, by its id. */
async function idOf(user: TestUser, kind: 'topics' | 'tags', name: string): Promise<string> {
  const row = await env.DB.prepare(`SELECT id FROM ${kind} WHERE user_id = ? AND name = ?`)
    .bind(user.id, name)
    .first<{ id: string }>();
  return row!.id;
}

async function aliases(user: TestUser, kind: 'topic' | 'tag'): Promise<[string, string][]> {
  const rows = await env.DB.prepare(
    `SELECT a.name, v.name AS survivor FROM ${kind}_aliases a JOIN ${kind}s v ON v.id = a.${kind}_id
     WHERE a.user_id = ? ORDER BY a.name`,
  )
    .bind(user.id)
    .all<{ name: string; survivor: string }>();
  return rows.results.map((r) => [r.name, r.survivor]);
}

async function linkLabels(user: TestUser, id: string) {
  const r = await api('GET', `/api/v1/links/${id}`, { as: user.session });
  return { tags: r.json.tags as string[], topic: r.json.topic as string | null };
}

describe('renaming a topic or tag', () => {
  it.each([
    { kind: 'topics' as const, from: 'Infra', to: 'Infrastructure', edit: { topic: 'Infra' } },
    { kind: 'tags' as const, from: 'js', to: 'javascript', edit: { tags: ['js'] } },
  ])('renames $kind and keeps the old name as an alias', async ({ kind, from, to, edit }) => {
    const user = await signIn();
    const [l1, l2] = await seedLinks(user, [
      { url: 'https://one.example/' },
      { url: 'https://two.example/' },
    ]);
    await patch(user, l1!, edit);
    await patch(user, l2!, edit);
    const id = await idOf(user, kind, from);
    const r = await api('PATCH', `/api/v1/${kind}/${id}`, { as: user.session, body: { name: to } });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ id, name: to, count: 2 });
    const labels = await linkLabels(user, l1!);
    expect(kind === 'topics' ? labels.topic : labels.tags).toEqual(kind === 'topics' ? to : [to]);
    expect(await aliases(user, kind === 'topics' ? 'topic' : 'tag')).toEqual([[from, to]]);
  });

  it('refuses a name another topic or tag has, changing nothing', async () => {
    const user = await signIn();
    const [l1, l2] = await seedLinks(user, [
      { url: 'https://one.example/' },
      { url: 'https://two.example/' },
    ]);
    await patch(user, l1!, { tags: ['js'], topic: 'A' });
    await patch(user, l2!, { tags: ['javascript'], topic: 'B' });
    const tag = await api('PATCH', `/api/v1/tags/${await idOf(user, 'tags', 'js')}`, {
      as: user.session,
      body: { name: 'JavaScript' },
    });
    expect(tag.status).toBe(409);
    expect(tag.json.error).toBe('name_taken');
    expect(tag.json.message).toContain('merge');
    const topic = await api('PATCH', `/api/v1/topics/${await idOf(user, 'topics', 'A')}`, {
      as: user.session,
      body: { name: 'b' },
    });
    expect(topic.status).toBe(409);
    expect(topic.json.error).toBe('name_taken');
    expect(await linkLabels(user, l1!)).toEqual({ tags: ['js'], topic: 'A' });
    expect(await linkLabels(user, l2!)).toEqual({ tags: ['javascript'], topic: 'B' });
    expect(await aliases(user, 'tag')).toEqual([]);
    const same = await api('PATCH', `/api/v1/tags/${await idOf(user, 'tags', 'js')}`, {
      as: user.session,
      body: { name: 'js' },
    });
    expect(same.status).toBe(200);
    expect(await aliases(user, 'tag')).toEqual([]);

    // A child elsewhere in the tree holds its name as firmly as a top-level topic.
    const [l3, l4] = await seedLinks(user, [
      { url: 'https://three.example/' },
      { url: 'https://four.example/' },
    ]);
    await patch(user, l3!, { topic: 'Rust' });
    await patch(user, l4!, { topic: 'Languages' });
    await placeTopic(user, 'Rust', 'Languages');
    const child = await api('PATCH', `/api/v1/topics/${await idOf(user, 'topics', 'A')}`, {
      as: user.session,
      body: { name: 'rust' },
    });
    expect(child.status).toBe(409);
    expect(child.json.error).toBe('name_taken');
    expect(await linkLabels(user, l1!)).toEqual({ tags: ['js'], topic: 'A' });
    expect(await parentOf(user, 'Rust')).toBe('Languages');
  });

  it.each([
    ['tags', undefined],
    ['tags', ''],
    ['tags', 'two words'],
    ['tags', 'Under_score'],
    ['tags', 'x'.repeat(51)],
    ['tags', '-lead'],
    ['tags', 42],
    ['topics', undefined],
    ['topics', '   '],
    ['topics', 'x'.repeat(101)],
    ['topics', 'CI>CD'],
    ['topics', 'A > B'],
  ] as const)('refuses the %s name %j', async (kind, name) => {
    const user = await signIn();
    const [l1] = await seedLinks(user, [{ url: 'https://one.example/' }]);
    await patch(user, l1!, { tags: ['before'], topic: 'Before' });
    const id = await idOf(user, kind, kind === 'tags' ? 'before' : 'Before');
    const r = await api('PATCH', `/api/v1/${kind}/${id}`, {
      as: user.session,
      body: name === undefined ? {} : { name },
    });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: 'invalid_name', field: 'name' });
    if (kind === 'topics') {
      expect(r.json.message).toBe('a topic name of 1 to 100 characters, without >');
    }
    expect(await linkLabels(user, l1!)).toEqual({ tags: ['before'], topic: 'Before' });
  });

  it('stores a tag name lower-cased and accepts a topic of 100 characters', async () => {
    const user = await signIn();
    const [l1] = await seedLinks(user, [{ url: 'https://one.example/' }]);
    await patch(user, l1!, { tags: ['before'], topic: 'Before' });
    const tag = await api('PATCH', `/api/v1/tags/${await idOf(user, 'tags', 'before')}`, {
      as: user.session,
      body: { name: 'Web-Dev' },
    });
    expect(tag.json.name).toBe('web-dev');
    const long = 'x'.repeat(100);
    const topic = await api('PATCH', `/api/v1/topics/${await idOf(user, 'topics', 'Before')}`, {
      as: user.session,
      body: { name: `  ${long}  ` },
    });
    expect(topic.status).toBe(200);
    expect(topic.json.name).toBe(long);
  });

  it("answers 404 for another user's topic or tag", async () => {
    const user = await signIn();
    const other = await signIn('other@example.test');
    const [theirs] = await seedLinks(other, [{ url: 'https://one.example/' }]);
    await patch(other, theirs!, { tags: ['secret'] });
    const r = await api('PATCH', `/api/v1/tags/${await idOf(other, 'tags', 'secret')}`, {
      as: user.session,
      body: { name: 'mine' },
    });
    expect(r.status).toBe(404);
    expect((await linkLabels(other, theirs!)).tags).toEqual(['secret']);
  });
});

describe('merging topics and tags', () => {
  it('moves every link of a tag to the survivor without repeating it', async () => {
    const user = await signIn();
    const [l1, l2, l3] = await seedLinks(user, [
      { url: 'https://one.example/' },
      { url: 'https://two.example/' },
      { url: 'https://three.example/' },
    ]);
    await patch(user, l1!, { tags: ['js'] });
    await patch(user, l2!, { tags: ['js', 'javascript'] });
    await patch(user, l3!, { tags: ['javascript'] });
    const js = await idOf(user, 'tags', 'js');
    const javascript = await idOf(user, 'tags', 'javascript');
    const r = await api('POST', `/api/v1/tags/${js}/merge`, {
      as: user.session,
      body: { into: javascript },
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ id: javascript, name: 'javascript', count: 3 });
    for (const id of [l1, l2, l3])
      expect((await linkLabels(user, id!)).tags).toEqual(['javascript']);
    const listed = await api('GET', '/api/v1/tags', { as: user.session });
    expect(listed.json.items.map((i: { name: string }) => i.name)).toEqual(['javascript']);
    expect(await aliases(user, 'tag')).toEqual([['js', 'javascript']]);
  });

  it('gives every link of a topic the survivor, and carries its aliases over', async () => {
    const user = await signIn();
    const [l1, l2, l3] = await seedLinks(user, [
      { url: 'https://one.example/' },
      { url: 'https://two.example/' },
      { url: 'https://three.example/' },
    ]);
    await patch(user, l1!, { topic: 'Ops' });
    await patch(user, l2!, { topic: 'Ops' });
    await patch(user, l3!, { topic: 'Infrastructure' });
    await api('PATCH', `/api/v1/topics/${await idOf(user, 'topics', 'Ops')}`, {
      as: user.session,
      body: { name: 'Infra' },
    });
    const infra = await idOf(user, 'topics', 'Infra');
    const survivor = await idOf(user, 'topics', 'Infrastructure');
    const r = await api('POST', `/api/v1/topics/${infra}/merge`, {
      as: user.session,
      body: { into: survivor },
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ id: survivor, name: 'Infrastructure', count: 3 });
    for (const id of [l1, l2, l3])
      expect((await linkLabels(user, id!)).topic).toBe('Infrastructure');
    expect(await aliases(user, 'topic')).toEqual([
      ['Infra', 'Infrastructure'],
      ['Ops', 'Infrastructure'],
    ]);
  });

  describe.each(['tags', 'topics'] as const)('refuses a bad merge of %s', (kind) => {
    async function setup() {
      const user = await signIn();
      const other = await signIn('other@example.test');
      const [l1, l2] = await seedLinks(user, [
        { url: 'https://one.example/' },
        { url: 'https://two.example/' },
      ]);
      const [theirs] = await seedLinks(other, [{ url: 'https://theirs.example/' }]);
      const label = (name: string) => (kind === 'tags' ? { tags: [name] } : { topic: name });
      await patch(user, l1!, label('first'));
      await patch(user, l2!, label('second'));
      await patch(other, theirs!, label('theirs'));
      return {
        user,
        links: [l1!, l2!],
        first: await idOf(user, kind, 'first'),
        second: await idOf(user, kind, 'second'),
        theirs: await idOf(other, kind, 'theirs'),
      };
    }

    it.each([
      { case: 'into absent', body: () => ({}), status: 400, error: 'invalid_merge' },
      {
        case: 'into the source',
        body: (s: { first: string }) => ({ into: s.first }),
        status: 400,
        error: 'invalid_merge',
      },
      {
        case: "into another user's",
        body: (s: { theirs: string }) => ({ into: s.theirs }),
        status: 404,
        error: 'not_found',
      },
      {
        case: 'into nothing',
        body: () => ({ into: 'no-such-id' }),
        status: 404,
        error: 'not_found',
      },
    ])('$case', async ({ body, status, error }) => {
      const s = await setup();
      const r = await api('POST', `/api/v1/${kind}/${s.first}/merge`, {
        as: s.user.session,
        body: body(s as never),
      });
      expect(r.status).toBe(status);
      expect(r.json.error).toBe(error);
      if (status === 400) expect(r.json.field).toBe('into');
      const labels = await Promise.all(s.links.map((id) => linkLabels(s.user, id)));
      expect(labels.map((l) => (kind === 'tags' ? l.tags[0] : l.topic))).toEqual([
        'first',
        'second',
      ]);
    });

    it("from another user's", async () => {
      const s = await setup();
      const r = await api('POST', `/api/v1/${kind}/${s.theirs}/merge`, {
        as: s.user.session,
        body: { into: s.first },
      });
      expect(r.status).toBe(404);
      expect(r.json.error).toBe('not_found');
    });
  });
});

/** The user's topic tree as listed: each topic's name with its parent's name. */
async function tree(user: TestUser): Promise<Record<string, string | null>> {
  const items = (await api('GET', '/api/v1/topics', { as: user.session })).json.items as {
    id: string;
    name: string;
    parent_id: string | null;
  }[];
  const names = new Map(items.map((i) => [i.id, i.name]));
  return Object.fromEntries(
    items.map((i) => [i.name, i.parent_id === null ? null : (names.get(i.parent_id) ?? '?')]),
  );
}

describe('moving a topic', () => {
  const T0 = Date.parse('2026-05-01T00:00:00.000Z');

  /** Languages > Rust > Async, Programming > Tools and Systems, each topic with one link. */
  async function library() {
    setNow(T0);
    const user = await signIn();
    const paths = [
      'Languages',
      'Languages > Rust',
      'Languages > Rust > Async',
      'Programming',
      'Programming > Tools',
      'Systems',
    ];
    const ids = await seedLinks(
      user,
      paths.map((_, i) => ({ url: `https://l${i}.example/` })),
    );
    for (const [i, topic] of paths.entries()) await patch(user, ids[i]!, { topic });
    const links = Object.fromEntries(paths.map((p, i) => [p.split(' > ').at(-1)!, ids[i]!]));
    return { user, links };
  }

  async function move(user: TestUser, topic: string, parent: string | null) {
    return api('POST', `/api/v1/topics/${await idOf(user, 'topics', topic)}/move`, {
      as: user.session,
      body: { parent: parent === null ? null : await idOf(user, 'topics', parent) },
    });
  }

  const before = {
    Languages: null,
    Rust: 'Languages',
    Async: 'Rust',
    Programming: null,
    Tools: 'Programming',
    Systems: null,
  };

  it.each([
    { topic: 'Systems', parent: 'Programming', changes: { Systems: 'Programming' } },
    { topic: 'Rust', parent: null, changes: { Rust: null } },
    { topic: 'Async', parent: 'Programming', changes: { Async: 'Programming' } },
    { topic: 'Rust', parent: 'Systems', changes: { Rust: 'Systems' } },
  ])(
    'moves $topic under $parent with everything beneath it',
    async ({ topic, parent, changes }) => {
      const { user } = await library();
      const r = await move(user, topic, parent);
      expect(r.status).toBe(200);
      const listed = (await api('GET', '/api/v1/topics', { as: user.session })).json.items.find(
        (i: { name: string }) => i.name === topic,
      );
      expect(r.json).toEqual({
        id: listed.id,
        name: topic,
        parent_id: listed.parent_id,
        count: listed.count,
        subtree_count: listed.subtree_count,
      });
      expect(await tree(user)).toEqual({ ...before, ...changes });
    },
  );

  it.each([
    { topic: 'Languages', parent: 'Programming', status: 409, error: 'too_deep' },
    { topic: 'Programming', parent: 'Rust', status: 409, error: 'too_deep' },
    { topic: 'Languages', parent: 'Async', status: 409, error: 'invalid_move' },
    { topic: 'Rust', parent: 'Rust', status: 409, error: 'invalid_move' },
    { topic: 'Rust', body: {}, status: 400, error: 'invalid_move', field: 'parent' },
    { topic: 'Rust', body: { parent: 42 }, status: 400, error: 'invalid_move', field: 'parent' },
    { topic: 'Rust', body: { parent: '' }, status: 400, error: 'invalid_move', field: 'parent' },
    { topic: 'Rust', parent: 'Theirs', status: 404, error: 'not_found' },
    { topic: 'Theirs', parent: 'Rust', status: 404, error: 'not_found' },
    { topic: 'unknown', parent: 'Rust', status: 404, error: 'not_found' },
  ] as {
    topic: string;
    parent?: string;
    body?: Record<string, unknown>;
    status: number;
    error: string;
    field?: string;
  }[])(
    'refuses to move $topic under $parent: $error',
    async ({ topic, parent, body, status, error, field }) => {
      const { user } = await library();
      const other = await signIn('other@example.test');
      const [theirs] = await seedLinks(other, [{ url: 'https://theirs.example/' }]);
      await patch(other, theirs!, { topic: 'Theirs' });
      const idOfAny = async (name: string) =>
        name === 'unknown'
          ? 'unknown'
          : name === 'Theirs'
            ? idOf(other, 'topics', 'Theirs')
            : idOf(user, 'topics', name);
      const links = async () =>
        (await api('GET', '/api/v1/links', { as: user.session })).json.items.map(
          (l: { id: string; updated_at: string }) => [l.id, l.updated_at],
        );
      const was = await links();
      setNow(T0 + 60_000);
      const r = await api('POST', `/api/v1/topics/${await idOfAny(topic)}/move`, {
        as: user.session,
        body: body ?? { parent: await idOfAny(parent!) },
      });
      expect(r.status).toBe(status);
      const messages: Record<string, string> = {
        too_deep: 'topics are at most three levels deep',
        invalid_move: 'a topic cannot move under itself',
      };
      expect(r.json).toEqual(
        status === 404
          ? { error }
          : field
            ? { error, field, message: expect.any(String) }
            : { error, message: messages[error] },
      );
      expect(await tree(user)).toEqual(before);
      expect(await links()).toEqual(was);
    },
  );

  it.each([
    { topic: 'Rust', parent: 'Languages' },
    { topic: 'Programming', parent: null },
  ])('changes nothing when moving $topic under the parent it has', async ({ topic, parent }) => {
    const { user } = await library();
    const updated = async () =>
      (await api('GET', '/api/v1/links', { as: user.session })).json.items.map(
        (l: { id: string; updated_at: string }) => [l.id, l.updated_at],
      );
    const was = await updated();
    setNow(T0 + 60_000);
    const r = await move(user, topic, parent);
    expect(r.status).toBe(200);
    expect(r.json.parent_id).toBe(parent === null ? null : await idOf(user, 'topics', parent));
    expect(await updated()).toEqual(was);
    expect(await tree(user)).toEqual(before);
  });

  it('deletes the former parent, and its parent, when the move leaves them with nothing', async () => {
    const user = await signIn();
    const [c, d, holder] = await seedLinks(user, [
      { url: 'https://c.example/' },
      { url: 'https://d.example/' },
      { url: 'https://holder.example/' },
    ]);
    await patch(user, holder!, { topic: 'A > B' });
    await patch(user, c!, { topic: 'A > B > C' });
    await api('DELETE', `/api/v1/links/${holder}`, { as: user.session });
    await patch(user, d!, { topic: 'D' });
    expect(await tree(user)).toEqual({ A: null, B: 'A', C: 'B', D: null });
    const r = await move(user, 'C', 'D');
    expect(r.status).toBe(200);
    expect(await tree(user)).toEqual({ C: 'D', D: null });
  });

  it('marks the links beneath the moved topic changed, and only those', async () => {
    const { user, links } = await library();
    const since = new Date(T0 + 1).toISOString();
    setNow(T0 + 60_000);
    expect((await move(user, 'Rust', 'Programming')).status).toBe(200);
    const changed = await api('GET', `/api/v1/links?changed_since=${since}`, {
      as: user.session,
    });
    expect(changed.json.items.map((l: { id: string }) => l.id).sort()).toEqual(
      [links.Rust, links.Async].sort(),
    );
    const async = changed.json.items.find((l: { id: string }) => l.id === links.Async);
    expect(async.topic_path).toEqual(['Programming', 'Rust', 'Async']);
  });
});

describe('merging and renaming topics in the tree', () => {
  const T0 = Date.parse('2026-06-01T00:00:00.000Z');

  /** A user with one link under each of these topic paths, by the last name. */
  async function library(paths: string[]) {
    setNow(T0);
    const user = await signIn();
    const ids = await seedLinks(
      user,
      paths.map((_, i) => ({ url: `https://m${i}.example/` })),
    );
    for (const [i, topic] of paths.entries()) await patch(user, ids[i]!, { topic });
    return {
      user,
      links: Object.fromEntries(paths.map((p, i) => [p.split(' > ').at(-1)!, ids[i]!])),
    };
  }

  async function merge(user: TestUser, from: string, into: string) {
    return api('POST', `/api/v1/topics/${await idOf(user, 'topics', from)}/merge`, {
      as: user.session,
      body: { into: await idOf(user, 'topics', into) },
    });
  }

  it('gives the survivor the source’s children, with theirs beneath them', async () => {
    const { user } = await library([
      'Rustlang',
      'Rustlang > Async',
      'Rustlang > Async > Tokio',
      'Rust',
    ]);
    const r = await merge(user, 'Rustlang', 'Rust');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ id: await idOf(user, 'topics', 'Rust'), name: 'Rust', count: 2 });
    expect(await tree(user)).toEqual({ Rust: null, Async: 'Rust', Tokio: 'Async' });
    expect(await aliases(user, 'topic')).toEqual([['Rustlang', 'Rust']]);
  });

  it.each([
    {
      from: 'Rust',
      into: 'Linters',
      error: 'too_deep',
      message: 'topics are at most three levels deep',
    },
    {
      from: 'Languages',
      into: 'Async',
      error: 'invalid_merge',
      message: 'a topic cannot merge into a topic beneath it',
    },
    {
      from: 'Languages',
      into: 'Rust',
      error: 'invalid_merge',
      message: 'a topic cannot merge into a topic beneath it',
    },
  ])('refuses to merge $from into $into: $error', async ({ from, into, error, message }) => {
    const { user, links } = await library([
      'Languages',
      'Languages > Rust',
      'Languages > Rust > Async',
      'Programming',
      'Programming > Tools',
      'Programming > Tools > Linters',
    ]);
    const was = await tree(user);
    const r = await merge(user, from, into);
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error, message });
    expect(await tree(user)).toEqual(was);
    for (const [name, id] of Object.entries(links)) {
      expect((await linkLabels(user, id)).topic).toBe(name);
    }
  });

  it('deletes the source’s former parent when the merge leaves it with nothing', async () => {
    const user = await signIn();
    const [b, c, holder] = await seedLinks(user, [
      { url: 'https://b.example/' },
      { url: 'https://c.example/' },
      { url: 'https://holder.example/' },
    ]);
    await patch(user, holder!, { topic: 'A' });
    await patch(user, b!, { topic: 'A > B' });
    await patch(user, holder!, { topic: 'C' });
    await patch(user, c!, { topic: 'C' });
    expect(await tree(user)).toEqual({ A: null, B: 'A', C: null });
    expect((await merge(user, 'B', 'C')).status).toBe(200);
    expect(await tree(user)).toEqual({ C: null });
  });

  it('keeps a renamed topic where it is, with its children', async () => {
    const { user } = await library(['Languages', 'Languages > Rust', 'Languages > Rust > Async']);
    const r = await api('PATCH', `/api/v1/topics/${await idOf(user, 'topics', 'Rust')}`, {
      as: user.session,
      body: { name: 'Rust language' },
    });
    expect(r.status).toBe(200);
    expect(await tree(user)).toEqual({
      Languages: null,
      'Rust language': 'Languages',
      Async: 'Rust language',
    });
  });

  it('marks the links beneath the source changed, and only those', async () => {
    const { user, links } = await library(['Rustlang', 'Rustlang > Async', 'Rust']);
    const since = new Date(T0 + 1).toISOString();
    setNow(T0 + 60_000);
    expect((await merge(user, 'Rustlang', 'Rust')).status).toBe(200);
    const changed = await api('GET', `/api/v1/links?changed_since=${since}`, { as: user.session });
    expect(changed.json.items.map((l: { id: string }) => l.id).sort()).toEqual(
      [links.Rustlang, links.Async].sort(),
    );
    const moved = changed.json.items.find((l: { id: string }) => l.id === links.Async);
    expect(moved.topic_path).toEqual(['Rust', 'Async']);
  });
});

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

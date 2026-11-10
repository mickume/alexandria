import { describe, expect, it } from 'vitest';
import { FakeAi } from '../test/ai';
import { FakeOrigin } from '../test/origin';
import {
  addAndFetch,
  api,
  count,
  deliverEnrichments,
  deliverFetches,
  env,
  placeTopic,
  recordEnrichQueue,
  recordFetchQueue,
  seedLinks,
  signIn,
  type TestUser,
} from '../test/helpers';
import { blogArticle } from '../fetcher/fixtures/pages';

const URL = 'https://edit.example/page';

function patch(user: TestUser, id: string, body: unknown) {
  return api('PATCH', `/api/v1/links/${id}`, { as: user.session, body });
}

async function get(user: TestUser, id: string) {
  return (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
}

describe('editing a link', () => {
  it('stores the given fields and remembers them as edited', async () => {
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: URL, state: 'active' }]);
    const r = await patch(user, id, { tags: ['Reading List', 'rust'], topic: 'Programming' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      tags: ['reading-list', 'rust'],
      topic: 'Programming',
      edited_fields: ['tags', 'topic'],
    });
    const r2 = await patch(user, id, { title: 'My title' });
    expect(r2.json).toMatchObject({ title: 'My title', edited_fields: ['tags', 'topic', 'title'] });
  });

  it.each([
    { body: { title: '' }, error: 'invalid_title', field: 'title' },
    { body: { title: 'x'.repeat(501) }, error: 'invalid_title', field: 'title' },
    { body: { summary: 's'.repeat(2001) }, error: 'invalid_summary', field: 'summary' },
    { body: { tags: 'rust' }, error: 'invalid_tags', field: 'tags' },
    {
      body: { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) },
      error: 'invalid_tags',
      field: 'tags',
    },
    { body: { tags: ['++'] }, error: 'invalid_tags', field: 'tags' },
    { body: { topic: '' }, error: 'invalid_topic', field: 'topic' },
    { body: { topic: 't'.repeat(101) }, error: 'invalid_topic', field: 'topic' },
    { body: { title: 'ok', topic: '' }, error: 'invalid_topic', field: 'topic' },
    { body: { topic: 'A > B > C > D' }, error: 'invalid_topic', field: 'topic' },
    { body: { topic: 'A > > B' }, error: 'invalid_topic', field: 'topic' },
    { body: { topic: 'A >' }, error: 'invalid_topic', field: 'topic' },
    { body: { topic: '> A' }, error: 'invalid_topic', field: 'topic' },
    { body: { topic: `A > ${'t'.repeat(101)}` }, error: 'invalid_topic', field: 'topic' },
  ])('refuses $body whole', async ({ body, error, field }) => {
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: URL, state: 'active' }]);
    const before = await get(user, id);
    const r = await patch(user, id, body);
    expect(r.status).toBe(400);
    expect(r.json).toEqual({
      error,
      field,
      message:
        error === 'invalid_topic'
          ? 'a topic or a path of up to three topics separated by >, each 1 to 100 characters'
          : expect.any(String),
    });
    expect(await get(user, id)).toEqual(before);
    expect(await count('topics', 'user_id = ?', user.id)).toBe(0);
  });

  it.each([
    {
      label: 'an existing tag written differently',
      existing: { tag: 'web-dev' },
      edit: { tags: ['Web Dev'] },
      stored: { tags: ['web-dev'] },
      created: 0,
    },
    {
      label: 'an existing topic in capitals',
      existing: { topic: 'Programming' },
      edit: { topic: 'PROGRAMMING' },
      stored: { topic: 'Programming' },
      created: 0,
    },
    {
      label: 'a new tag',
      existing: {},
      edit: { tags: ['zig'] },
      stored: { tags: ['zig'] },
      created: 1,
    },
    {
      label: 'a plural of an existing tag, taken as typed',
      existing: { tag: 'library' },
      edit: { tags: ['libraries'] },
      stored: { tags: ['libraries'] },
      created: 1,
    },
  ])('reuses the vocabulary for $label', async ({ existing, edit, stored, created }) => {
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: URL, state: 'active' }]);
    if (existing.tag)
      await env.DB.prepare('INSERT INTO tags (id, user_id, name) VALUES (?, ?, ?)')
        .bind('t1', user.id, existing.tag)
        .run();
    if (existing.topic)
      await env.DB.prepare('INSERT INTO topics (id, user_id, name) VALUES (?, ?, ?)')
        .bind('p1', user.id, existing.topic)
        .run();
    const before =
      (await count('tags', 'user_id = ?', user.id)) +
      (await count('topics', 'user_id = ?', user.id));
    const r = await patch(user, id, edit);
    expect(r.json).toMatchObject(stored);
    const after =
      (await count('tags', 'user_id = ?', user.id)) +
      (await count('topics', 'user_id = ?', user.id));
    expect(after - before).toBe(created);
  });
});

describe('a typed topic path', () => {
  it.each([
    { topic: 'Gardening', path: ['Gardening'] },
    { topic: 'software ENGINEERING', path: ['Software engineering'] },
    { topic: 'Software engineering > Unit tests', path: ['Software engineering', 'Unit tests'] },
    { topic: 'Hobbies > Woodwork > Joinery', path: ['Hobbies', 'Woodwork', 'Joinery'] },
    { topic: 'SE > Mocks', path: ['Software engineering', 'Mocks'] },
    { topic: 'Testings', path: ['Testings'] },
    { topic: '  Software engineering>Testing  ', path: ['Software engineering', 'Testing'] },
    { topic: 'Cooking > Testing', path: ['Software engineering', 'Testing'] },
    {
      topic: 'Cooking > Testing > Mutation',
      path: ['Software engineering', 'Testing', 'Mutation'],
    },
    { topic: 'Fuzzing > Corpus', path: ['Software engineering', 'Testing', 'Corpus'] },
    { topic: 'Brand new > Testing', path: ['Software engineering', 'Testing'] },
    { topic: 'New one > New two > Testing', path: ['Software engineering', 'Testing'] },
    {
      topic: 'Fuzzing > Corpus > Seeds',
      path: ['Software engineering', 'Testing', 'Seeds'],
    },
  ])('files the link under $topic as $path', async ({ topic, path }) => {
    const user = await signIn();
    const [se = '', testing = '', fuzzing = '', cooking = '', id = ''] = await seedLinks(user, [
      { url: 'https://se.example/' },
      { url: 'https://testing.example/' },
      { url: 'https://fuzzing.example/' },
      { url: 'https://cooking.example/' },
      { url: URL },
    ]);
    await patch(user, se, { topic: 'Software engineering' });
    await patch(user, testing, { topic: 'Testing' });
    await patch(user, fuzzing, { topic: 'Fuzzing' });
    await patch(user, cooking, { topic: 'Cooking' });
    await placeTopic(user, 'Testing', 'Software engineering');
    await placeTopic(user, 'Fuzzing', 'Testing');
    await env.DB.prepare(
      `INSERT INTO topic_aliases (user_id, name, topic_id)
       SELECT user_id, 'SE', id FROM topics WHERE user_id = ? AND name = 'Software engineering'`,
    )
      .bind(user.id)
      .run();

    const r = await patch(user, id, { topic });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      topic: path.at(-1),
      topic_path: path,
      edited_fields: ['topic'],
    });
    const names = await env.DB.prepare(
      'SELECT lower(name) AS name, COUNT(*) AS n FROM topics WHERE user_id = ? GROUP BY lower(name) HAVING n > 1',
    )
      .bind(user.id)
      .all();
    expect(names.results).toEqual([]);
    const empty = await env.DB.prepare(
      `SELECT name FROM topics t WHERE user_id = ?
         AND NOT EXISTS (SELECT 1 FROM links WHERE topic_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM topics k WHERE k.parent_id = t.id)`,
    )
      .bind(user.id)
      .all();
    expect(empty.results).toEqual([]);
    expect((await get(user, fuzzing)).topic_path).toEqual([
      'Software engineering',
      'Testing',
      'Fuzzing',
    ]);
  });
});

describe('an edited field', () => {
  const owner = {
    title: 'Owner title',
    summary: 'Owner summary.',
    tags: ['owner-tag'],
    topic: 'Owner topic',
  };
  const second = {
    summary: 'Second summary.',
    tags: ['new-one', 'new-two', 'new-three'],
    topic: 'Second topic > Deeper',
  };

  it.each(
    (['title', 'summary', 'tags', 'topic'] as const).flatMap((field) =>
      (['a refresh', 'a re-run'] as const).map((op) => ({ field, op })),
    ),
  )('keeps the owner’s $field through $op, while the rest updates', async ({ field, op }) => {
    const origin = new FakeOrigin().page(URL, blogArticle);
    const ai = new FakeAi();
    const user = await signIn();
    await api('PUT', '/api/v1/settings/ai', {
      as: user.session,
      body: { provider: 'anthropic', api_key: 'sk-ant-abcd1234' },
    });
    const first = recordEnrichQueue();
    const { id } = await addAndFetch(user, URL);
    await deliverEnrichments(first.map((m) => m.body));
    expect((await patch(user, id, { [field]: owner[field] })).status).toBe(200);

    const changedPage = blogArticle.replace('Why We Keep Links\n     Forever', 'A Changed Title');
    origin.page(URL, changedPage);
    ai.answer(second);
    const enrich = recordEnrichQueue();
    if (op === 'a refresh') {
      const fetches = recordFetchQueue();
      await api('POST', `/api/v1/links/${id}/refresh`, { as: user.session });
      await deliverFetches(fetches.map((m) => m.body));
    } else {
      await api('POST', `/api/v1/links/${id}/enrich`, { as: user.session });
    }
    await deliverEnrichments(enrich.map((m) => m.body));

    const l = await get(user, id);
    expect(l[field]).toEqual(owner[field]);
    for (const other of ['summary', 'tags'] as const) {
      if (other !== field) expect(l[other]).toEqual(second[other]);
    }
    if (field !== 'topic') {
      expect(l.topic).toBe('Deeper');
      expect(l.topic_path).toEqual(['Second topic', 'Deeper']);
    }
    if (field !== 'title') {
      expect(l.title).toBe(op === 'a refresh' ? 'A Changed Title' : 'Why We Keep Links Forever');
    }
  });
});

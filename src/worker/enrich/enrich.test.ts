import { describe, expect, it } from 'vitest';
import { FakeAi } from '../test/ai';
import { FakeOrigin } from '../test/origin';
import {
  addAndFetch,
  api,
  count,
  deliverEnrichments,
  env,
  recordEnrichQueue,
  rejectAiKey,
  seedLinks,
  setNow,
  signIn,
  type TestUser,
  useAi,
} from '../test/helpers';
import { blogArticle, longArticle } from '../fetcher/fixtures/pages';
import { scannedPdf } from '../fetcher/fixtures/pdfs';
import { buildPrompt, normalizeResult } from './enrich';
import { keyRejection, REJECTION_RETRY_MS } from './keys';
import { RESULT_SCHEMA, setProviderTimeout } from './providers';
import { RESUME_PER_MINUTE, resumeEnrichment } from './resume';

const ARTICLE = 'https://news.example/enrich-me';

async function link(user: TestUser, id: string) {
  return (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
}

/** Adds and fetches `url`, then delivers the enrichment messages the fetch sent. */
async function addFetchAndEnrich(user: TestUser, url: string) {
  const enrich = recordEnrichQueue();
  const fetched = await addAndFetch(user, url);
  const sent = [...enrich];
  if (sent.length) await deliverEnrichments(sent.map((m) => m.body));
  return { ...fetched, enrichMessages: sent };
}

async function storedTags(id: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    'SELECT t.name FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = ? ORDER BY lt.position',
  )
    .bind(id)
    .all<{ name: string }>();
  return rows.results.map((r) => r.name);
}

async function topicOf(id: string): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT tp.name FROM links l LEFT JOIN topics tp ON tp.id = l.topic_id WHERE l.id = ?',
  )
    .bind(id)
    .first<{ name: string | null }>();
  return row?.name ?? null;
}

describe('enriching a fetched link', () => {
  it('stores the summary, tags and topic the provider returns', async () => {
    new FakeOrigin().page(ARTICLE, blogArticle);
    new FakeAi().answer({
      summary: 'A short summary.',
      tags: ['cloudflare', 'queues', 'workers'],
      topic: 'web development',
    });
    const user = await signIn();
    useAi();
    const { id, enrichMessages } = await addFetchAndEnrich(user, ARTICLE);
    expect(enrichMessages.map((m) => m.body)).toEqual([
      { user_id: user.id, link_id: id, attempt: 1 },
    ]);
    const row = await env.DB.prepare(
      'SELECT summary, enrichment_status, enriched_at FROM links WHERE id = ?',
    )
      .bind(id)
      .first<{ summary: string; enrichment_status: string; enriched_at: string | null }>();
    expect(row).toMatchObject({ summary: 'A short summary.', enrichment_status: 'enriched' });
    expect(row?.enriched_at).toEqual(expect.any(String));
    expect(await storedTags(id)).toEqual(['cloudflare', 'queues', 'workers']);
    expect(await topicOf(id)).toBe('web development');
  });

  it.each([
    { label: 'a long article', page: longArticle(30_000), empty: false },
    {
      label: 'a page without readable text',
      page: '<html><head><title>Thin Page</title><meta name="description" content="Only a description."></head><body><p>x</p></body></html>',
      empty: true,
    },
  ])('sends the provider only what it needs for $label', async ({ page, empty }) => {
    new FakeOrigin().page(ARTICLE, page);
    const ai = new FakeAi();
    const user = await signIn('owner@example.test', 'Ada Owner');
    useAi();
    const { id } = await addFetchAndEnrich(user, ARTICLE);
    const [request] = ai.enrichments;
    const body = JSON.stringify(request!.body);
    if (empty) {
      expect(body).toContain('Thin Page');
      expect(body).toContain('Only a description.');
    } else {
      const text = (await env.DB.prepare('SELECT text FROM link_texts WHERE link_id = ?')
        .bind(id)
        .first<{ text: string }>())!.text;
      expect(text.length).toBeGreaterThan(20_000);
      expect(body).toContain(JSON.stringify(text.slice(0, 20_000)).slice(1, -1));
      expect(body).not.toContain(JSON.stringify(text.slice(0, 20_001)).slice(1, -1));
    }
    for (const secret of ['<html', 'owner@example.test', 'Ada Owner', user.id]) {
      expect(body).not.toContain(secret);
    }
    expect(request!.headers.get('Cookie')).toBeNull();
  });

  it.each([
    {
      label: 'an existing tag written differently',
      existing: { tags: ['web-dev'] },
      answer: { tags: ['Web Dev', 'two', 'three'] },
      tags: ['web-dev', 'two', 'three'],
      newTags: 2,
    },
    {
      label: 'an existing topic in another case',
      existing: { topic: 'Programming' },
      answer: { topic: 'programming' },
      topic: 'Programming',
    },
    {
      label: 'a new tag',
      existing: {},
      answer: { tags: ['rust'] },
      tags: ['rust'],
      newTags: 1,
    },
    {
      label: 'an existing tag in the plural',
      existing: { tags: ['library', 'cache'] },
      answer: { tags: ['libraries', 'caches'] },
      tags: ['library', 'cache'],
      newTags: 0,
    },
    {
      label: 'an existing tag in the singular and without its hyphen',
      existing: { tags: ['design-patterns'] },
      answer: { tags: ['design-pattern', 'designpatterns', 'go'] },
      tags: ['design-patterns', 'go'],
      newTags: 1,
    },
    {
      label: 'two new variants of one name',
      existing: {},
      answer: { tags: ['box', 'boxes'] },
      tags: ['box'],
      newTags: 1,
    },
    {
      label: 'a name that only looks like a plural',
      existing: { tags: ['window'] },
      answer: { tags: ['windows'] },
      tags: ['windows'],
      newTags: 1,
    },
    {
      label: 'an existing topic in the singular',
      existing: { topic: 'Databases' },
      answer: { topic: 'database' },
      topic: 'Databases',
    },
  ])('reuses the vocabulary for $label', async ({ existing, answer, tags, topic, newTags }) => {
    const user = await signIn();
    if (existing.tags) {
      for (const name of existing.tags) {
        await env.DB.prepare('INSERT INTO tags (id, user_id, name) VALUES (?, ?, ?)')
          .bind(crypto.randomUUID(), user.id, name)
          .run();
      }
    }
    if (existing.topic) {
      await env.DB.prepare('INSERT INTO topics (id, user_id, name) VALUES (?, ?, ?)')
        .bind(crypto.randomUUID(), user.id, existing.topic)
        .run();
    }
    const tagsBefore = await count('tags', 'user_id = ?', user.id);
    const topicsBefore = await count('topics', 'user_id = ?', user.id);
    new FakeOrigin().page(ARTICLE, blogArticle);
    new FakeAi().answer({
      summary: 'S.',
      tags: ['one', 'two', 'three'],
      topic: 'general',
      ...answer,
    });
    useAi();
    const { id } = await addFetchAndEnrich(user, ARTICLE);
    if (tags) expect(await storedTags(id)).toEqual(tags);
    if (topic) {
      expect(await topicOf(id)).toBe(topic);
      expect(await count('topics', 'user_id = ?', user.id)).toBe(topicsBefore);
    }
    if (newTags !== undefined) {
      expect(await count('tags', 'user_id = ?', user.id)).toBe(tagsBefore + newTags);
    }
  });

  it.each([
    { topic: 'Software engineering > Unit tests', path: ['Software engineering', 'Unit tests'] },
    { topic: 'software engineering', path: ['Software engineering'] },
    { topic: 'SE > Mocks', path: ['Software engineering', 'Mocks'] },
    { topic: 'Database > Indexes', path: ['Databases', 'Indexes'] },
    { topic: 'Quality > Testing', path: ['Software engineering', 'Testing'] },
    { topic: 'Programming>Rust', path: ['Programming', 'Rust'] },
    { topic: 'Gardening > Tools > Shears > Blades', path: ['Gardening', 'Tools', 'Blades'] },
    { topic: 'Fuzzing > Corpus', path: ['Software engineering', 'Testing', 'Corpus'] },
  ])('files the link under the returned path $topic', async ({ topic, path }) => {
    const user = await signIn();
    const [se = '', testing = '', fuzzing = '', databases = ''] = await seedLinks(user, [
      { url: 'https://se.example/' },
      { url: 'https://testing.example/' },
      { url: 'https://fuzzing.example/' },
      { url: 'https://databases.example/' },
    ]);
    const edit = (id: string, t: string) =>
      api('PATCH', `/api/v1/links/${id}`, { as: user.session, body: { topic: t } });
    await edit(se, 'Software engineering');
    await edit(testing, 'Software engineering > Testing');
    await edit(fuzzing, 'Software engineering > Testing > Fuzzing');
    await edit(databases, 'Databases');
    await env.DB.prepare(
      `INSERT INTO topic_aliases (user_id, name, topic_id)
       SELECT user_id, 'SE', id FROM topics WHERE user_id = ? AND name = 'Software engineering'`,
    )
      .bind(user.id)
      .run();
    new FakeOrigin().page(ARTICLE, blogArticle);
    new FakeAi().answer({ summary: 'S.', tags: ['one', 'two', 'three'], topic });
    useAi();
    const { id } = await addFetchAndEnrich(user, ARTICLE);

    expect(await link(user, id)).toMatchObject({ topic: path.at(-1), topic_path: path });
    expect((await link(user, fuzzing)).topic_path).toEqual([
      'Software engineering',
      'Testing',
      'Fuzzing',
    ]);
    expect(await count('topics', "user_id = ? AND name LIKE '%>%'", user.id)).toBe(0);
    expect(
      await count(
        'topics',
        `user_id = ? AND NOT EXISTS (SELECT 1 FROM links WHERE topic_id = topics.id)
         AND NOT EXISTS (SELECT 1 FROM topics k WHERE k.parent_id = topics.id)`,
        user.id,
      ),
    ).toBe(0);
  });

  it('lists the 300 most used tags in the request', async () => {
    const user = await signIn();
    const statements: D1PreparedStatement[] = [];
    for (let i = 0; i < 400; i++) {
      statements.push(
        env.DB.prepare('INSERT INTO tags (id, user_id, name) VALUES (?, ?, ?)').bind(
          `t${i}`,
          user.id,
          `tag-${String(i).padStart(3, '0')}`,
        ),
      );
    }
    await env.DB.batch(statements);
    // The 300 tags t100..t399 are each used once; t0..t99 are unused.
    const seed = await env.DB.prepare(
      "INSERT INTO links (id, user_id, url, original_url, host, title, added_at, last_used_at, updated_at) VALUES ('seed', ?, 'https://seed.example/', 'https://seed.example/', 'seed.example', 'seed', '2026-01-01', '2026-01-01', '2026-01-01')",
    )
      .bind(user.id)
      .run();
    expect(seed.success).toBe(true);
    const uses: D1PreparedStatement[] = [];
    for (let i = 100; i < 400; i++) {
      uses.push(
        env.DB.prepare('INSERT INTO link_tags (link_id, tag_id, position) VALUES (?, ?, ?)').bind(
          'seed',
          `t${i}`,
          i,
        ),
      );
    }
    await env.DB.batch(uses);
    new FakeOrigin().page(ARTICLE, blogArticle);
    const ai = new FakeAi();
    useAi();
    await addFetchAndEnrich(user, ARTICLE);
    const body = JSON.stringify(ai.enrichments[0]!.body);
    for (let i = 0; i < 400; i++) {
      const name = `tag-${String(i).padStart(3, '0')}`;
      expect(body.includes(name), name).toBe(i >= 100);
    }
    expect(body).toContain('tag-100 (1)');
    expect(body).toContain('Reuse an existing tag when one fits, preferring the more used ones');
  });

  it('lists the 100 topics with the newest links as paths, without counts', async () => {
    const user = await signIn();
    const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString();
    const ids = await seedLinks(
      user,
      Array.from({ length: 104 }, (_, i) => ({ url: `https://t${i}.example/`, addedAt: day(i) })),
    );
    const statements: D1PreparedStatement[] = [];
    for (let i = 0; i < 103; i++) {
      const topic = `T${String(i).padStart(3, '0')}`;
      statements.push(
        env.DB.prepare('INSERT INTO topics (id, user_id, name) VALUES (?, ?, ?)').bind(
          topic,
          user.id,
          topic,
        ),
        env.DB.prepare('UPDATE links SET topic_id = ? WHERE id = ?').bind(topic, ids[i]),
      );
    }
    // The newest link of all is filed under a child: its parent ranks with it.
    statements.push(
      env.DB.prepare('INSERT INTO topics (id, user_id, name) VALUES (?, ?, ?)').bind(
        'se',
        user.id,
        'Software engineering',
      ),
      env.DB.prepare('INSERT INTO topics (id, user_id, name, parent_id) VALUES (?, ?, ?, ?)').bind(
        'testing',
        user.id,
        'Testing',
        'se',
      ),
      env.DB.prepare('UPDATE links SET topic_id = ? WHERE id = ?').bind('testing', ids[103]),
    );
    await env.DB.batch(statements);
    new FakeOrigin().page(ARTICLE, blogArticle);
    const ai = new FakeAi();
    useAi();
    await addFetchAndEnrich(user, ARTICLE);
    const body = JSON.stringify(ai.enrichments[0]!.body);
    expect(body).toContain('\\nSoftware engineering > Testing\\n');
    expect(body).toContain('\\nSoftware engineering\\n');
    for (let i = 0; i < 103; i++) {
      const topic = `T${String(i).padStart(3, '0')}`;
      expect(body.includes(`\\n${topic}\\n`), topic).toBe(i >= 5);
    }
    expect(body).not.toMatch(/(T\d{3}|Testing|Software engineering) \(\d+\)/);
  });

  it.each([
    {
      label: 'an image',
      url: 'https://img.example/cat.png',
      serve: (o: FakeOrigin, u: string) => o.page(u, 'png', 'image/png'),
    },
    {
      label: 'a scanned PDF',
      url: 'https://papers.example/scan.pdf',
      serve: (o: FakeOrigin, u: string) => o.page(u, scannedPdf(), 'application/pdf'),
    },
    {
      label: 'a PDF too large to store',
      url: 'https://papers.example/huge.pdf',
      serve: (o: FakeOrigin, u: string) =>
        o.stream(u, 51 * 1024 * 1024, 'application/pdf', { contentLength: true }),
    },
  ])('skips $label', async ({ url, serve }) => {
    serve(new FakeOrigin(), url);
    const ai = new FakeAi();
    const user = await signIn();
    useAi();
    const { id, enrichMessages } = await addFetchAndEnrich(user, url);
    expect(
      (await env.DB.prepare('SELECT enrichment_status FROM links WHERE id = ?').bind(id).first())
        ?.enrichment_status,
    ).toBe('skipped');
    expect(enrichMessages).toEqual([]);
    expect(ai.enrichments).toEqual([]);
  });

  it.each([
    { provider: 'anthropic' as const, key: 'sk-ant-deployment', model: undefined },
    { provider: 'openrouter' as const, key: 'sk-or-deployment', model: 'mistral/mb' },
  ])('calls $provider with the deployment’s key and model', async ({ provider, key, model }) => {
    new FakeOrigin().page(ARTICLE, blogArticle);
    const ai = new FakeAi();
    useAi({ provider, key, model });
    await addFetchAndEnrich(await signIn(), ARTICLE);
    const [request] = ai.enrichments;
    expect(request!.provider).toBe(provider);
    expect(request!.headers.get('x-api-key') ?? request!.headers.get('Authorization')).toContain(
      key,
    );
    expect(request!.body.model).toBe(model ?? 'claude-opus-5-5');
  });

  it('leaves enriched links alone when the provider, model or key changes', async () => {
    new FakeOrigin().page(ARTICLE, blogArticle);
    new FakeAi();
    const user = await signIn();
    useAi();
    const { id } = await addFetchAndEnrich(user, ARTICLE);
    const before = await env.DB.prepare(
      'SELECT summary, topic_id, enriched_at FROM links WHERE id = ?',
    )
      .bind(id)
      .first();
    const tags = await storedTags(id);
    const sent = recordEnrichQueue();
    useAi({ provider: 'openrouter', key: 'sk-or-other', model: 'other/model' });
    expect(await resumeEnrichment(env)).toBe(0);
    expect(sent).toEqual([]);
    expect(
      await env.DB.prepare('SELECT summary, topic_id, enriched_at FROM links WHERE id = ?')
        .bind(id)
        .first(),
    ).toEqual(before);
    expect(await storedTags(id)).toEqual(tags);
  });
});

describe('the enrichment request', () => {
  const prompt = buildPrompt({
    title: 'A page',
    host: 'page.example',
    text: 'Some text.',
    description: null,
    topics: ['Software engineering', 'Software engineering > Testing'],
    tags: [
      { name: 'rust', count: 3 },
      { name: 'wasm', count: 1 },
    ],
  });

  it('asks for the most specific topic that fits, as a path of up to three names', () => {
    expect(prompt).toContain(
      'topic: the path of the one topic the page belongs to: one to three names from the most general to the most specific, separated by " > "',
    );
    expect(prompt).toContain(
      'File the page under the most specific topic that fits, existing or new, and put a new topic under the existing topic it belongs to.',
    );
    expect(prompt).toContain(
      'Existing topics:\nSoftware engineering\nSoftware engineering > Testing\n',
    );
    expect(prompt.match(/preferring the more used/g)).toHaveLength(1);
    expect(prompt).toContain('Reuse an existing tag when one fits, preferring the more used ones');
    expect(prompt).toContain('Existing tags: rust (3), wasm (1)');
  });

  it('describes the result’s topic as a path', () => {
    expect(RESULT_SCHEMA.properties.topic.description).toBe(
      'The path of the one topic the page belongs to: one to three names from the most general to the most specific, separated by " > ".',
    );
  });
});

describe('enrichment after renames and merges', () => {
  /** Two links: one tagged js with topic Infra, one tagged javascript with topic Infrastructure. */
  async function vocabularyWithTwoNames(user: TestUser) {
    const [a, b] = await seedLinks(user, [
      { url: 'https://a.example/' },
      { url: 'https://b.example/' },
    ]);
    const edit = (id: string, body: unknown) =>
      api('PATCH', `/api/v1/links/${id}`, { as: user.session, body });
    await edit(a!, { tags: ['js'], topic: 'Infra' });
    await edit(b!, { tags: ['javascript'], topic: 'Infrastructure' });
    const id = async (table: string, name: string) =>
      (await env.DB.prepare(`SELECT id FROM ${table} WHERE user_id = ? AND name = ?`)
        .bind(user.id, name)
        .first<{ id: string }>())!.id;
    return { id };
  }

  it('offers the provider only the current names', async () => {
    const user = await signIn();
    const { id } = await vocabularyWithTwoNames(user);
    await api('POST', `/api/v1/tags/${await id('tags', 'js')}/merge`, {
      as: user.session,
      body: { into: await id('tags', 'javascript') },
    });
    await api('PATCH', `/api/v1/topics/${await id('topics', 'Infra')}`, {
      as: user.session,
      body: { name: 'Operations' },
    });
    new FakeOrigin().page(ARTICLE, blogArticle);
    const ai = new FakeAi();
    useAi();
    await addFetchAndEnrich(user, ARTICLE);
    const body = JSON.stringify(ai.enrichments[0]!.body);
    // Each tag with the number of links that carry it (the merge moved js's
    // link); each topic as its path, without a count.
    expect(body).toContain('javascript (2)');
    expect(body).toContain('\\nInfrastructure\\n');
    expect(body).toContain('\\nOperations\\n');
    expect(body).not.toContain('Infrastructure (1)');
    expect(body).not.toMatch(/\bjs\b/);
    expect(body).not.toMatch(/\bInfra\b/);
  });

  it('stores the survivor for a tag or topic the provider names by an alias', async () => {
    const user = await signIn();
    const { id } = await vocabularyWithTwoNames(user);
    await api('POST', `/api/v1/tags/${await id('tags', 'js')}/merge`, {
      as: user.session,
      body: { into: await id('tags', 'javascript') },
    });
    await api('POST', `/api/v1/topics/${await id('topics', 'Infra')}/merge`, {
      as: user.session,
      body: { into: await id('topics', 'Infrastructure') },
    });
    new FakeOrigin().page(ARTICLE, blogArticle);
    new FakeAi().answer({ summary: 'S.', tags: ['JS', 'react', 'javascript'], topic: 'infra' });
    useAi();
    const { id: linkId } = await addFetchAndEnrich(user, ARTICLE);
    expect(await storedTags(linkId)).toEqual(['javascript', 'react']);
    expect(await topicOf(linkId)).toBe('Infrastructure');
    expect(await count('tags', "user_id = ? AND name = 'js'", user.id)).toBe(0);
    expect(await count('topics', "user_id = ? AND name = 'Infra' COLLATE NOCASE", user.id)).toBe(0);
  });
});

describe('a provider’s result', () => {
  it.each([
    {
      label: 'tags with case, spaces, symbols and repeats',
      input: {
        summary: 'S.',
        topic: 'T',
        tags: ['Rust', 'rust', 'Web Assembly', 'C++', '', 'a', 'b', 'c', 'd', 'e', 'f'],
      },
      tags: ['rust', 'web-assembly', 'c', 'a', 'b'],
    },
    {
      label: 'a single tag',
      input: { summary: 'S.', topic: 'T', tags: ['rust'] },
      tags: ['rust'],
    },
    {
      label: 'a summary of 75 words',
      input: {
        summary: Array.from({ length: 75 }, (_, i) => `w${i}`).join(' '),
        topic: 'T',
        tags: ['a', 'b', 'c'],
      },
      summary: Array.from({ length: 60 }, (_, i) => `w${i}`).join(' '),
    },
    {
      label: 'a summary of 60 words',
      input: {
        summary: Array.from({ length: 60 }, (_, i) => `w${i}`).join(' '),
        topic: 'T',
        tags: ['a', 'b', 'c'],
      },
      summary: Array.from({ length: 60 }, (_, i) => `w${i}`).join(' '),
    },
  ])('is normalised: $label', ({ input, tags, summary }) => {
    const r = normalizeResult(input);
    expect(r).not.toBeNull();
    if (tags) expect(r!.tags).toEqual(tags);
    if (summary) expect(r!.summary).toBe(summary);
  });
});

describe('a link without a key', () => {
  it('is fetched and stored but not enriched', async () => {
    new FakeOrigin().page(ARTICLE, blogArticle);
    const ai = new FakeAi();
    const user = await signIn();
    const { id, enrichMessages } = await addFetchAndEnrich(user, ARTICLE);
    const l = await link(user, id);
    expect(l.state).toBe('active');
    expect(l.content_kind).toBe('html');
    const row = await env.DB.prepare('SELECT enrichment_status, summary FROM links WHERE id = ?')
      .bind(id)
      .first();
    expect(row).toEqual({ enrichment_status: 'no_key', summary: null });
    expect(await storedTags(id)).toEqual([]);
    expect(enrichMessages).toEqual([]);
    expect(ai.enrichments).toEqual([]);
  });
});

describe('an enriched link as the API shows it', () => {
  it('carries its summary, tags, topic, status, reason and edited fields everywhere', async () => {
    new FakeOrigin().page(ARTICLE, blogArticle);
    new FakeAi().answer({
      summary: 'A short summary.',
      tags: ['alpha', 'beta', 'gamma'],
      topic: 'Letters',
    });
    const user = await signIn();
    useAi();
    const { id } = await addFetchAndEnrich(user, ARTICLE);
    const expected = {
      summary: 'A short summary.',
      tags: ['alpha', 'beta', 'gamma'],
      topic: 'Letters',
      enrichment_status: 'enriched',
      enrichment_reason: null,
      edited_fields: [],
    };
    const stream = await api('GET', '/api/v1/links', { as: user.session });
    expect(stream.json.items.find((l: { id: string }) => l.id === id)).toMatchObject(expected);
    expect(await link(user, id)).toMatchObject(expected);
    const changes = await api('GET', '/api/v1/links?changed_since=2000-01-01T00:00:00.000Z', {
      as: user.session,
    });
    expect(changes.json.items.find((l: { id: string }) => l.id === id)).toMatchObject(expected);
  });
});

describe('enriching all unenriched links', () => {
  it('schedules every waiting link through the throttle', async () => {
    const user = await signIn();
    const states = [
      ...Array.from({ length: 25 }, () => 'no_key'),
      'failed',
      'failed',
      'enriched',
      'skipped',
    ];
    const ids = await seedLinks(
      user,
      states.map((_, i) => ({ url: `https://e${i}.example/`, state: 'active' })),
    );
    await env.DB.batch(
      ids.map((id, i) =>
        env.DB.prepare('UPDATE links SET enrichment_status = ? WHERE id = ?').bind(states[i], id),
      ),
    );
    new FakeAi();
    useAi();
    setNow('2026-11-02T09:00:00.000Z');
    const sent = recordEnrichQueue();
    const r = await api('POST', '/api/v1/links/enrich-unenriched', { as: user.session });
    expect(r.status).toBe(202);
    expect(r.json).toEqual({ queued: 27 });
    expect(sent.map((m) => m.delaySeconds)).toEqual(Array.from({ length: 27 }, (_, i) => 3 * i));
    expect(new Set(sent.map((m) => m.body.link_id))).toEqual(new Set(ids.slice(0, 27)));
    const statuses = await env.DB.prepare(
      'SELECT id, enrichment_status FROM links WHERE user_id = ?',
    )
      .bind(user.id)
      .all<{ id: string; enrichment_status: string }>();
    const byId = new Map(statuses.results.map((s) => [s.id, s.enrichment_status]));
    for (const id of ids.slice(0, 27)) expect(byId.get(id)).toBe('queued');
    expect(byId.get(ids[27]!)).toBe('enriched');
    expect(byId.get(ids[28]!)).toBe('skipped');
  });

  it.each(['no key', 'a rejected key'])('is refused with %s', async (label) => {
    const user = await signIn();
    if (label === 'a rejected key') {
      useAi();
      await rejectAiKey();
    }
    const sent = recordEnrichQueue();
    const r = await api('POST', '/api/v1/links/enrich-unenriched', { as: user.session });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: 'no_ai_key', message: 'this deployment has no AI key' });
    expect(sent).toEqual([]);
  });
});

describe('a failed enrichment', () => {
  /** A fetched, queued link and its first enrichment message, with a verified key. */
  async function queuedLink(ai: FakeAi) {
    new FakeOrigin().page(ARTICLE, blogArticle);
    const user = await signIn();
    useAi();
    const enrich = recordEnrichQueue();
    const { id } = await addAndFetch(user, ARTICLE);
    void ai;
    return { user, id, message: enrich[0]!.body };
  }

  it.each([
    {
      label: 'a server error',
      make: (ai: FakeAi) => ai.status(500, 'internal error', { testsToo: false }),
    },
    {
      label: 'a rate limit',
      make: (ai: FakeAi) =>
        ai.status(429, 'rate limited', { testsToo: false, headers: { 'retry-after': '30' } }),
    },
    { label: 'a refusal', make: (ai: FakeAi) => ai.refusal() },
    { label: 'no answer in time', make: (ai: FakeAi) => ai.stall() },
    {
      label: 'a result without tags',
      make: (ai: FakeAi) => ai.answer({ summary: 'S.', tags: ['++', ''], topic: 'T' }),
      unusable: true,
    },
    {
      label: 'a topic path with an empty name',
      make: (ai: FakeAi) => ai.answer({ summary: 'S.', tags: ['a', 'b'], topic: 'A >  > B' }),
      unusable: true,
    },
    {
      label: 'a topic path ending in >',
      make: (ai: FakeAi) => ai.answer({ summary: 'S.', tags: ['a', 'b'], topic: 'A >' }),
      unusable: true,
    },
    {
      label: 'a topic name over 100 characters',
      make: (ai: FakeAi) =>
        ai.answer({ summary: 'S.', tags: ['a', 'b'], topic: `A > ${'x'.repeat(101)}` }),
      unusable: true,
    },
  ] as { label: string; make: (ai: FakeAi) => void; unusable?: boolean }[])(
    'after $label keeps the link usable, marks it failed and retries once in 10 minutes',
    async ({ make, unusable }) => {
      const ai = new FakeAi();
      const { user, id, message } = await queuedLink(ai);
      make(ai);
      setProviderTimeout(200);
      try {
        const sent = recordEnrichQueue();
        await deliverEnrichments([message]);
        const l = await link(user, id);
        expect(l).toMatchObject({
          state: 'active',
          title: 'Why We Keep Links Forever',
          enrichment_status: 'failed',
          summary: null,
          tags: [],
        });
        expect(l.enrichment_reason).toEqual(expect.any(String));
        if (unusable) {
          expect(l.enrichment_reason).toBe('the result was not usable');
          expect(l.topic).toBeNull();
          expect(await count('topics', 'user_id = ?', user.id)).toBe(0);
        }
        expect(sent).toEqual([{ body: { ...message, attempt: 2 }, delaySeconds: 600 }]);

        const again = recordEnrichQueue();
        await deliverEnrichments([sent[0]!.body]);
        expect((await link(user, id)).enrichment_status).toBe('failed');
        expect(again).toEqual([]);
      } finally {
        setProviderTimeout(null);
      }
    },
  );
});

describe('re-running an enrichment', () => {
  it('sends one message at once, outside the throttle, and enriches the link', async () => {
    new FakeOrigin().page(ARTICLE, blogArticle);
    const ai = new FakeAi();
    const user = await signIn();
    useAi();
    const { id } = await addAndFetch(user, ARTICLE);
    await env.DB.prepare(
      "UPDATE links SET enrichment_status = 'failed', enrichment_reason = 'internal error' WHERE id = ?",
    )
      .bind(id)
      .run();
    const sent = recordEnrichQueue();
    const r = await api('POST', `/api/v1/links/${id}/enrich`, { as: user.session });
    expect(r.status).toBe(202);
    expect(r.json).toEqual({ status: 'queued' });
    expect(sent).toEqual([
      { body: { user_id: user.id, link_id: id, manual: true }, delaySeconds: undefined },
    ]);
    await deliverEnrichments([sent[0]!.body]);
    expect((await link(user, id)).enrichment_status).toBe('enriched');
    expect(ai.enrichments.length).toBeGreaterThan(0);
  });

  it.each([
    { label: 'no key', setup: 'nokey', error: 'no_ai_key' },
    { label: 'a pending link', setup: 'pending', error: 'nothing_to_enrich' },
    { label: 'an unreachable link', setup: 'unreachable', error: 'nothing_to_enrich' },
    { label: 'a skipped PDF', setup: 'skipped', error: 'nothing_to_enrich' },
  ])('is refused for $label', async ({ setup, error }) => {
    new FakeAi();
    const user = await signIn();
    if (setup !== 'nokey') useAi();
    const [id] = await seedLinks(user, [
      {
        url: 'https://refused.example/',
        state: setup === 'unreachable' ? 'unreachable' : setup === 'pending' ? 'pending' : 'active',
      },
    ]);
    if (setup === 'skipped')
      await env.DB.prepare("UPDATE links SET enrichment_status = 'skipped' WHERE id = ?")
        .bind(id)
        .run();
    const sent = recordEnrichQueue();
    const r = await api('POST', `/api/v1/links/${id}/enrich`, { as: user.session });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe(error);
    expect(typeof r.json.message).toBe('string');
    expect(sent).toEqual([]);
  });
});

describe('a key the provider starts rejecting', () => {
  it.each([
    { status: 401, message: 'invalid x-api-key' },
    { status: 402, message: 'insufficient credits' },
    { status: 403, message: 'permission denied' },
  ])(
    'is marked rejected on a $status, and the link waits for a key',
    async ({ status, message }) => {
      new FakeOrigin().page(ARTICLE, blogArticle);
      const ai = new FakeAi();
      const user = await signIn();
      useAi();
      const enrich = recordEnrichQueue();
      const { id } = await addAndFetch(user, ARTICLE);
      ai.status(status, message, { testsToo: false });
      const sent = recordEnrichQueue();
      await deliverEnrichments([enrich[0]!.body]);
      expect(await keyRejection(env.DB, 'ai', env.AI_API_KEY!)).toBe(message);
      expect((await link(user, id)).enrichment_status).toBe('waiting_for_key');
      expect(sent).toEqual([]);
    },
  );

  it('leaves every link reaching enrichment waiting, without calling the provider', async () => {
    new FakeOrigin()
      .page('https://w1.example/', blogArticle)
      .page('https://w2.example/', blogArticle);
    const ai = new FakeAi();
    const user = await signIn();
    useAi();
    await rejectAiKey('no credit');
    const before = ai.requests.length;
    const one = await addFetchAndEnrich(user, 'https://w1.example/');
    const two = await addFetchAndEnrich(user, 'https://w2.example/');
    // A message already queued before the rejection reaches the worker too.
    await deliverEnrichments([{ user_id: user.id, link_id: one.id, attempt: 1 }]);
    for (const id of [one.id, two.id])
      expect((await link(user, id)).enrichment_status).toBe('waiting_for_key');
    expect(ai.requests.length).toBe(before);
  });

  it.each(['a new key', 'an hour gone by'])(
    'is lifted by %s, and the waiting links are queued again',
    async (lift) => {
      new FakeOrigin()
        .page('https://waiting.example/', blogArticle)
        .page('https://fresh.example/', blogArticle);
      new FakeAi();
      const T = Date.parse('2026-11-20T09:00:00.000Z');
      setNow(T);
      const user = await signIn();
      useAi();
      await rejectAiKey('no credit');
      const waiting = await addFetchAndEnrich(user, 'https://waiting.example/');
      expect(await resumeEnrichment(env)).toBe(0);
      if (lift === 'a new key') useAi({ key: 'sk-ant-newkey9999' });
      else setNow(T + REJECTION_RETRY_MS);
      const fresh = await addFetchAndEnrich(user, 'https://fresh.example/');
      expect((await link(user, fresh.id)).enrichment_status).toBe('enriched');
      const sent = recordEnrichQueue();
      expect(await resumeEnrichment(env)).toBe(1);
      expect(sent.map((m) => m.body.link_id)).toEqual([waiting.id]);
      expect((await link(user, waiting.id)).enrichment_status).toBe('queued');
      await deliverEnrichments(sent.map((m) => m.body));
      expect((await link(user, waiting.id)).enrichment_status).toBe('enriched');
    },
  );
});

describe('resuming the links that wait for a key', () => {
  /** Seeds `n` links of `user` in `status`, the first waiting longest. */
  async function waitingLinks(user: TestUser, n: number, status: string, prefix: string) {
    const ids = await seedLinks(
      user,
      Array.from({ length: n }, (_, i) => ({ url: `https://${prefix}${i}.example/` })),
    );
    for (const [i, id] of ids.entries()) {
      await env.DB.prepare('UPDATE links SET enrichment_status = ?, updated_at = ? WHERE id = ?')
        .bind(status, new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(), id)
        .run();
    }
    return ids;
  }

  it('queues nothing while the deployment has no usable key', async () => {
    const user = await signIn();
    await waitingLinks(user, 2, 'no_key', 'n');
    const sent = recordEnrichQueue();
    expect(await resumeEnrichment(env)).toBe(0);
    useAi();
    await rejectAiKey();
    expect(await resumeEnrichment(env)).toBe(0);
    expect(sent).toEqual([]);
  });

  it('queues 20 a minute across the owners, the longest waiting first, leaving failed links and deleted accounts', async () => {
    useAi();
    const a = await signIn('a@example.test', 'A');
    const b = await signIn('b@example.test', 'B');
    const gone = await signIn('gone@example.test', 'Gone');
    const waitingA = await waitingLinks(a, 15, 'no_key', 'a');
    const waitingB = await waitingLinks(b, 10, 'waiting_for_key', 'b');
    const [failed] = await waitingLinks(a, 1, 'failed', 'f');
    await waitingLinks(gone, 3, 'no_key', 'g');
    await env.DB.prepare('UPDATE users SET deletion_requested_at = ? WHERE id = ?')
      .bind('2026-11-01T00:00:00.000Z', gone.id)
      .run();
    const sent = recordEnrichQueue();
    expect(await resumeEnrichment(env)).toBe(RESUME_PER_MINUTE);
    const queued = new Set(sent.map((m) => m.body.link_id));
    expect(queued.size).toBe(RESUME_PER_MINUTE);
    const first = a.id < b.id ? waitingA : waitingB;
    const second = a.id < b.id ? waitingB : waitingA;
    for (const id of [...first, ...second.slice(0, RESUME_PER_MINUTE - first.length)])
      expect(queued.has(id)).toBe(true);
    expect(queued.has(failed!)).toBe(false);
    expect(await resumeEnrichment(env)).toBe(25 - RESUME_PER_MINUTE);
    expect(await resumeEnrichment(env)).toBe(0);
  });
});

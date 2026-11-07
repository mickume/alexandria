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
  seedLinks,
  setNow,
  signIn,
  type TestUser,
} from '../test/helpers';
import { blogArticle, longArticle } from '../fetcher/fixtures/pages';
import { scannedPdf } from '../fetcher/fixtures/pdfs';
import { normalizeResult } from './enrich';
import { setProviderTimeout } from './providers';

const ARTICLE = 'https://news.example/enrich-me';

async function saveKey(
  user: TestUser,
  body: Record<string, unknown> = { provider: 'anthropic', api_key: 'sk-ant-abcd1234' },
) {
  const r = await api('PUT', '/api/v1/settings/ai', { as: user.session, body });
  expect(r.status).toBe(200);
}

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
    await saveKey(user);
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
    await saveKey(user);
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
      answer: { tags: ['rust', 'two', 'three'] },
      tags: ['rust', 'two', 'three'],
    },
  ])('reuses the vocabulary for $label', async ({ existing, answer, tags, topic }) => {
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
    await saveKey(user);
    const { id } = await addFetchAndEnrich(user, ARTICLE);
    if (tags) expect(await storedTags(id)).toEqual(tags);
    if (topic) {
      expect(await topicOf(id)).toBe(topic);
      expect(await count('topics', 'user_id = ?', user.id)).toBe(topicsBefore);
    }
    if (existing.tags) expect(await count('tags', 'user_id = ?', user.id)).toBe(tagsBefore + 2);
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
    await saveKey(user);
    await addFetchAndEnrich(user, ARTICLE);
    const body = JSON.stringify(ai.enrichments[0]!.body);
    for (let i = 0; i < 400; i++) {
      const name = `tag-${String(i).padStart(3, '0')}`;
      expect(body.includes(name), name).toBe(i >= 100);
    }
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
    await saveKey(user);
    const { id, enrichMessages } = await addFetchAndEnrich(user, url);
    expect(
      (await env.DB.prepare('SELECT enrichment_status FROM links WHERE id = ?').bind(id).first())
        ?.enrichment_status,
    ).toBe('skipped');
    expect(enrichMessages).toEqual([]);
    expect(ai.enrichments).toEqual([]);
  });

  it('calls each provider only with its own user’s key and model', async () => {
    new FakeOrigin()
      .page('https://a-news.example/', blogArticle)
      .page('https://b-news.example/', blogArticle);
    const ai = new FakeAi();
    const a = await signIn('a@example.test', 'A');
    const b = await signIn('b@example.test', 'B');
    await saveKey(a, { provider: 'anthropic', api_key: 'sk-ant-key-of-a' });
    await saveKey(b, { provider: 'openrouter', api_key: 'sk-or-key-of-b', model: 'mistral/mb' });
    await addFetchAndEnrich(a, 'https://a-news.example/');
    await addFetchAndEnrich(b, 'https://b-news.example/');
    const auth = (r: (typeof ai.requests)[number]) =>
      r.headers.get('x-api-key') ?? r.headers.get('Authorization') ?? '';
    const [ra, rb] = ai.enrichments;
    expect(ra!.provider).toBe('anthropic');
    expect(auth(ra!)).toContain('sk-ant-key-of-a');
    expect(rb!.provider).toBe('openrouter');
    expect(auth(rb!)).toContain('sk-or-key-of-b');
    expect(rb!.body.model).toBe('mistral/mb');
  });

  it('leaves enriched links alone when the provider, model or key changes', async () => {
    new FakeOrigin().page(ARTICLE, blogArticle);
    new FakeAi();
    const user = await signIn();
    await saveKey(user);
    const { id } = await addFetchAndEnrich(user, ARTICLE);
    const before = await env.DB.prepare(
      'SELECT summary, topic_id, enriched_at FROM links WHERE id = ?',
    )
      .bind(id)
      .first();
    const tags = await storedTags(id);
    const sent = recordEnrichQueue();
    await saveKey(user, { provider: 'openrouter', api_key: 'sk-or-other', model: 'other/model' });
    expect(sent).toEqual([]);
    expect(
      await env.DB.prepare('SELECT summary, topic_id, enriched_at FROM links WHERE id = ?')
        .bind(id)
        .first(),
    ).toEqual(before);
    expect(await storedTags(id)).toEqual(tags);
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
      tags: ['rust', 'web-assembly', 'c', 'a', 'b', 'd', 'e', 'f'],
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
    expect(l.has_snapshot).toBe(true);
    const row = await env.DB.prepare('SELECT enrichment_status, summary FROM links WHERE id = ?')
      .bind(id)
      .first();
    expect(row).toEqual({ enrichment_status: 'no_key', summary: null });
    expect(await storedTags(id)).toEqual([]);
    expect(enrichMessages).toEqual([]);
    expect(ai.enrichments).toEqual([]);
  });

  it('is not enriched once the key is removed', async () => {
    new FakeOrigin().page(ARTICLE, blogArticle);
    const ai = new FakeAi();
    const user = await signIn();
    await saveKey(user);
    await api('DELETE', '/api/v1/settings/ai', { as: user.session });
    const { id } = await addFetchAndEnrich(user, ARTICLE);
    expect(
      (await env.DB.prepare('SELECT enrichment_status FROM links WHERE id = ?').bind(id).first())
        ?.enrichment_status,
    ).toBe('no_key');
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
    await saveKey(user);
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
    await saveKey(user);
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
      new FakeAi();
      await saveKey(user);
      await env.DB.prepare("UPDATE users SET ai_key_status = 'rejected' WHERE id = ?")
        .bind(user.id)
        .run();
    }
    const sent = recordEnrichQueue();
    const r = await api('POST', '/api/v1/links/enrich-unenriched', { as: user.session });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: 'no_ai_key', message: 'add an AI key in settings' });
    expect(sent).toEqual([]);
  });
});

describe('a failed enrichment', () => {
  /** A fetched, queued link and its first enrichment message, with a verified key. */
  async function queuedLink(ai: FakeAi) {
    new FakeOrigin().page(ARTICLE, blogArticle);
    const user = await signIn();
    await saveKey(user);
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
      label: 'a result with 2 tags',
      make: (ai: FakeAi) => ai.answer({ summary: 'S.', tags: ['a', 'b'], topic: 'T' }),
    },
  ])(
    'after $label keeps the link usable, marks it failed and retries once in 10 minutes',
    async ({ make }) => {
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
    await saveKey(user);
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
    if (setup !== 'nokey') await saveKey(user);
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

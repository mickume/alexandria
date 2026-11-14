import { afterEach, describe, expect, it } from 'vitest';
import { FakeAi } from '../test/ai';
import { api, count, deliverIndexing, env, signIn, type TestUser } from '../test/helpers';
import { ARTICLES, meaning, seedArticle, type Article } from '../test/meaning';
import { markKeyRejected } from '../enrich/keys';
import { setProviderTimeout } from '../enrich/providers';

/** Saves a key the fake provider accepts, for Anthropic or OpenRouter. */
async function saveKey(
  user: TestUser,
  provider: 'anthropic' | 'openrouter' = 'anthropic',
  model?: string,
) {
  const r = await api('PUT', '/api/v1/settings/ai', {
    as: user.session,
    body: {
      provider,
      api_key: provider === 'anthropic' ? 'sk-ant-abcd1234' : 'sk-or-abcd1234',
      ...(model ? { model } : {}),
    },
  });
  expect(r.status).toBe(200);
}

/** One server-sent event of an answer. */
interface AnswerEvent {
  event: string;
  data: Record<string, unknown>;
}

/** The events of a server-sent events body. */
function events(text: string): AnswerEvent[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      const lines = block.split('\n');
      const name = lines.find((l) => l.startsWith('event: '))!.slice('event: '.length);
      const data = lines.find((l) => l.startsWith('data: '))!.slice('data: '.length);
      return { event: name, data: JSON.parse(data) };
    });
}

/** Seeds and indexes the articles; their ids in order. */
async function indexed(user: TestUser, articles: Article[]): Promise<string[]> {
  const ids: string[] = [];
  for (const article of articles) ids.push(await seedArticle(user, article));
  const r = await deliverIndexing(ids.map((link_id) => ({ user_id: user.id, link_id })));
  expect(r.retried).toEqual([]);
  return ids;
}

/** The text of the question a provider was sent: the user's message. */
function promptOf(body: Record<string, unknown>): string {
  const messages = body.messages as { role: string; content: string }[];
  return messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');
}

const QUESTION = 'how do I schedule background work on cloudflare';

/** POST /api/v1/ask as the user. */
function ask(user: TestUser, body: unknown) {
  return api('POST', '/api/v1/ask', { as: user.session, body });
}

describe('a question that is refused before the answer streams', () => {
  const noWord = {
    status: 400,
    json: {
      error: 'invalid_question',
      field: 'question',
      message: 'ask with at least one word',
    },
  };

  it.each([
    { name: 'no question', body: {}, ...noWord },
    { name: 'a question that is not text', body: { question: 3 }, ...noWord },
    { name: 'an empty question', body: { question: '' }, ...noWord },
    { name: 'a blank question', body: { question: '   ' }, ...noWord },
    { name: 'a question of filters only', body: { question: 'tag:infra' }, ...noWord },
    {
      name: 'a question of 501 characters',
      body: { question: 'x'.repeat(501) },
      status: 400,
      json: {
        error: 'question_too_long',
        field: 'question',
        message: 'a question of at most 500 characters',
      },
    },
    {
      name: 'a detailed flag that is not true or false',
      body: { question: 'alarms', detailed: 'yes' },
      status: 400,
      json: {
        error: 'invalid_detailed',
        field: 'detailed',
        message: 'detailed must be true or false',
      },
    },
    {
      name: 'a body that is not JSON',
      body: 'not json',
      status: 400,
      json: expect.objectContaining({ error: 'invalid_json' }),
    },
    {
      name: 'a question of exactly 500 characters (refused only for lacking a key)',
      body: { question: 'x'.repeat(500) },
      status: 409,
      json: { error: 'no_ai_key', message: 'add an AI key in settings' },
    },
  ])('answers $status for $name, calling no one', async ({ body, status, json }) => {
    const user = await signIn();
    const ai = new FakeAi();

    const r = await ask(user, body);

    expect(r.status).toBe(status);
    expect(r.json).toEqual(json);
    expect(ai.asks).toEqual([]);
    expect(meaning.calls).toEqual([]);
  });

  it.each([
    {
      name: 'no key is saved',
      arrange: async () => undefined,
      json: { error: 'no_ai_key', message: 'add an AI key in settings' },
    },
    {
      name: 'the saved key is marked rejected',
      arrange: async (user: TestUser) => {
        await saveKey(user);
        await markKeyRejected(env.DB, user.id, 'invalid x-api-key');
      },
      json: { error: 'ai_key_rejected', message: 'invalid x-api-key' },
    },
  ])(
    'answers 409 when $name, without calling the provider or the index',
    async ({ arrange, json }) => {
      const user = await signIn();
      const ai = new FakeAi();
      await arrange(user);
      meaning.calls.length = 0;

      const r = await ask(user, { question: 'how do I schedule background work?' });

      expect(r.status).toBe(409);
      expect(r.json).toEqual(json);
      expect(ai.asks).toEqual([]);
      expect(meaning.calls).toEqual([]);
    },
  );

  it('answers 409 and marks the key when the provider rejects it while rephrasing the question', async () => {
    const user = await signIn();
    const ai = new FakeAi().failPhrasings(401, 'invalid x-api-key');
    await saveKey(user);
    await indexed(user, [ARTICLES.alarms]);

    const r = await ask(user, { question: QUESTION });

    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: 'ai_key_rejected', message: 'invalid x-api-key' });
    expect(ai.asks).toEqual([]);
    expect((await api('GET', '/api/v1/settings/ai', { as: user.session })).json).toMatchObject({
      status: 'rejected',
      rejected_message: 'invalid x-api-key',
    });
  });
});

describe('the passages an answer is written from', () => {
  afterEach(() => setProviderTimeout(null));

  it.each([
    { name: 'the embedding fails', arrange: () => meaning.fail('embed'), meaning: 'unavailable' },
    { name: 'the index fails', arrange: () => meaning.fail('query'), meaning: 'unavailable' },
    { name: 'the reranker fails', arrange: () => meaning.fail('rerank'), meaning: 'unranked' },
  ])('are found by their words when $name, and the answer says so', async (the) => {
    const user = await signIn();
    const ai = new FakeAi();
    await saveKey(user);
    const [alarms] = await indexed(user, [ARTICLES.alarms, ARTICLES.tomatoes]);
    the.arrange();

    const r = await ask(user, { question: 'alarm schedule task' });

    expect(r.status).toBe(200);
    const [sources] = events(await r.response.text());
    expect(sources!.data.meaning).toBe(the.meaning);
    expect((sources!.data.sources as { link: { id: string } }[]).map((s) => s.link.id)).toEqual([
      alarms,
    ]);
    expect(ai.asks).toHaveLength(1);
  });

  it('are found with the question and the phrasings the provider writes of it', async () => {
    const user = await signIn();
    const ai = new FakeAi().phrase([
      'growing tomatoes',
      'x'.repeat(201),
      'Growing  Tomatoes',
      'compost for pots',
      'soil for a balcony',
      'a fourth phrasing',
    ]);
    await saveKey(user);
    const [tomatoes] = await indexed(user, [ARTICLES.tomatoes, ARTICLES.queues]);

    const question = 'what do I plant tag:none-such';
    const refused = events(await (await ask(user, { question })).response.text());
    // The question's filter applies to every phrasing.
    expect(refused[0]!.data.sources).toEqual([]);

    const sent = events(await (await ask(user, { question: 'what do I plant' })).response.text());

    expect(sent[0]!.data.queries).toEqual([
      'what do I plant',
      'growing tomatoes',
      'compost for pots',
      'soil for a balcony',
    ]);
    expect((sent[0]!.data.sources as { link: { id: string } }[]).map((s) => s.link.id)).toEqual([
      tomatoes,
    ]);
    expect(promptOf(ai.phrasings[0]!.body)).toContain('what do I plant');
    // Every phrasing is searched; the reranker reads the passages against the question as typed.
    expect(meaning.callsOf('embed').at(-1)!.texts).toEqual(sent[0]!.data.queries);
    expect(meaning.callsOf('rerank').at(-1)!.query).toBe('what do I plant');
  });

  it.each([
    { name: 'answers 503', arrange: (ai: FakeAi) => ai.failPhrasings(503, 'overloaded') },
    { name: 'answers something else', arrange: (ai: FakeAi) => ai.phrase('not a list') },
    {
      name: 'does not answer',
      arrange: (ai: FakeAi) => {
        setProviderTimeout(200);
        ai.stallPhrasings();
      },
    },
  ])('are found with the question as typed when the provider $name', async ({ arrange }) => {
    const user = await signIn();
    const ai = new FakeAi();
    arrange(ai);
    await saveKey(user);
    await indexed(user, [ARTICLES.alarms]);

    const sent = events(await (await ask(user, { question: QUESTION })).response.text());

    expect(sent[0]!.data.queries).toEqual([QUESTION]);
    expect(sent.map((e) => e.event)).toEqual(['sources', 'delta', 'delta', 'done']);
  });

  it('go to the provider with their neighbours, joined, under what is known of their link', async () => {
    const user = await signIn();
    const ai = new FakeAi();
    await saveKey(user);
    const filler = (n: number) => `Filler sentence number ${n} about nothing at all. `.repeat(28);
    await indexed(user, [
      {
        url: 'https://guide.example/long',
        title: 'A long guide',
        summary: 'Everything in one page.',
        topic: 'Platform > Guides',
        text: `${filler(1)}\n\n${filler(2)}\n\nThe error E1101 means the alarm was set twice. ${filler(3)}\n\n${filler(4)}\n\n${filler(5)}`,
      },
    ]);

    await (await ask(user, { question: 'E1101' })).response.text();

    const prompt = promptOf(ai.asks[0]!.body);
    expect(prompt).toContain(
      '[1] A long guide\nTopic: Platform > Guides\nHost: guide.example\nAdded: ',
    );
    expect(prompt).toContain('Summary: Everything in one page.');
    expect(prompt).toContain('E1101');
    // The passage before it and the one after it, each once, in the order of the page.
    expect(prompt.indexOf('number 2')).toBeLessThan(prompt.indexOf('E1101'));
    expect(prompt.indexOf('E1101')).toBeLessThan(prompt.indexOf('number 4'));
    expect(prompt).not.toContain('number 5');
    expect(prompt.split('The error E1101 means')).toHaveLength(2);
  });
});

describe('an answer to a question', () => {
  it('streams the sources, then the answer piece by piece, then done', async () => {
    const user = await signIn();
    const ai = new FakeAi().answerText(['Use an alarm ', '[1].']);
    await saveKey(user);
    await indexed(user, [ARTICLES.alarms]);

    const r = await ask(user, { question: QUESTION });

    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toMatch(/^text\/event-stream/);
    const sent = events(await r.response.text());
    expect(sent.map((e) => e.event)).toEqual(['sources', 'delta', 'delta', 'done']);
    expect(
      sent
        .filter((e) => e.event === 'delta')
        .map((e) => e.data.text)
        .join(''),
    ).toBe('Use an alarm [1].');
    expect(sent.at(-1)!.data).toEqual({});
    expect(ai.asks).toHaveLength(1);
  });

  it('numbers the sources from 1 in the order of their best passage, each passage headed by its number', async () => {
    const user = await signIn();
    const ai = new FakeAi();
    await saveKey(user);
    const [alarms, queues] = await indexed(user, [ARTICLES.alarms, ARTICLES.queues]);
    const stream = (await api('GET', '/api/v1/links', { as: user.session })).json.items;
    const passages = (
      await api('GET', `/api/v1/passages?q=${encodeURIComponent(QUESTION)}`, { as: user.session })
    ).json.items as { link_id: string }[];
    const order = [...new Set(passages.map((p) => p.link_id))];
    expect(order).toEqual([alarms, queues]);

    const sent = events(await (await ask(user, { question: QUESTION })).response.text());

    const sources = sent[0]!.data.sources as { n: number; link: { id: string } }[];
    expect(sources.map((s) => s.n)).toEqual([1, 2]);
    expect(sources.map((s) => s.link.id)).toEqual(order);
    for (const source of sources) {
      expect(source.link).toEqual(stream.find((l: { id: string }) => l.id === source.link.id));
    }
    const prompt = promptOf(ai.asks[0]!.body);
    expect(prompt.indexOf('[1] Durable Object alarms')).toBeGreaterThanOrEqual(0);
    expect(prompt.indexOf('[1] Durable Object alarms')).toBeLessThan(prompt.indexOf('alarm lets'));
    expect(prompt.indexOf('alarm lets')).toBeLessThan(
      prompt.indexOf('[2] Cloudflare Queues explained'),
    );
    expect(prompt.indexOf('[2] Cloudflare Queues explained')).toBeLessThan(
      prompt.indexOf('Queues deliver'),
    );
  });

  it.each([
    { provider: 'anthropic' as const, model: 'claude-test', key: 'sk-ant-abcd1234' },
    { provider: 'openrouter' as const, model: 'test/model', key: 'sk-or-abcd1234' },
  ])(
    'sends $provider at most 8 passages, 3 of one link, with the owner’s key and model',
    async ({ provider, model, key }) => {
      const user = await signIn();
      const ai = new FakeAi();
      await saveKey(user, provider, model);
      const big: Article = {
        url: 'https://big.example/',
        title: 'Scheduling notes',
        text: 'Schedule a task for later. '.repeat(330),
      };
      const others = Array.from({ length: 6 }, (_, i): Article => ({
        url: `https://other${i}.example/`,
        title: `Alarm ${i} worker`,
        text: null,
      }));
      await indexed(user, [big, ...others]);

      const r = await ask(user, { question: 'schedule a task' });
      const sent = events(await r.response.text());

      const [request] = ai.asks;
      expect(request!.body.model).toBe(model);
      expect(request!.headers.get('authorization')).toContain(key);
      // Each source is headed once; the big link’s 3 passages and 5 of the 6 others make the 8.
      const headings = promptOf(request!.body).match(/^\[\d+\] /gm) ?? [];
      expect(headings).toHaveLength(6);
      expect(new Set(headings).size).toBe(6);
      expect((sent[0]!.data.sources as unknown[]).length).toBe(6);
    },
  );

  it.each([
    { name: 'an ask', detailed: undefined, passages: 8, maxTokens: 1024, thorough: false },
    { name: 'a detailed ask', detailed: true, passages: 16, maxTokens: 4096, thorough: true },
  ])(
    'sends $name $passages passages and room for $maxTokens tokens',
    async ({ detailed, passages, maxTokens, thorough }) => {
      const user = await signIn();
      const ai = new FakeAi();
      await saveKey(user);
      const articles = Array.from({ length: 7 }, (_, i): Article => ({
        url: `https://notes${i}.example/`,
        title: `Scheduling notes ${i}`,
        text: 'Schedule a task for later. '.repeat(330),
      }));
      await indexed(user, articles);

      await (await ask(user, { question: 'schedule a task', detailed })).response.text();

      const [request] = ai.asks;
      // At most 3 passages of a link, so the passages come from at least a third as many sources.
      const sources = promptOf(request!.body).match(/^\[\d+\] /gm) ?? [];
      expect(sources.length).toBeGreaterThanOrEqual(Math.ceil(passages / 3));
      expect(sources.length).toBeLessThanOrEqual(Math.min(passages, articles.length));
      expect(request!.body.max_tokens).toBe(maxTokens);
      expect(String(request!.body.system).includes('detailed, thorough')).toBe(thorough);
      expect(String(request!.body.system)).toContain('Nothing in your library answers this.');
      expect(String(request!.body.system)).toContain('Do not use Markdown');
    },
  );

  it('reads the passages under the question’s filters', async () => {
    const user = await signIn();
    const ai = new FakeAi();
    await saveKey(user);
    const [tagged, , , archived] = await indexed(user, [
      { url: 'https://a.example/', title: 'Alarm tagged', text: null, tags: ['infra'] },
      { url: 'https://b.example/', title: 'Alarm plain', text: null },
      {
        url: 'https://c.example/',
        title: 'Alarm expired',
        text: null,
        tags: ['infra'],
        state: 'expired',
      },
      {
        url: 'https://d.example/',
        title: 'Alarm archived',
        text: null,
        tags: ['infra'],
        state: 'archived',
      },
    ]);

    const sent = events(
      await (await ask(user, { question: 'schedule a task tag:infra' })).response.text(),
    );

    expect(
      (sent[0]!.data.sources as { link: { id: string } }[]).map((s) => s.link.id).sort(),
    ).toEqual([tagged, archived].sort());
    expect(promptOf(ai.asks[0]!.body)).toContain('Alarm archived');
    expect(promptOf(ai.asks[0]!.body)).toContain('Alarm tagged');
    expect(promptOf(ai.asks[0]!.body)).not.toContain('Alarm plain');
    expect(promptOf(ai.asks[0]!.body)).not.toContain('Alarm expired');
    expect(promptOf(ai.asks[0]!.body)).not.toContain('tag:infra');
  });

  it('tells the provider to answer from the passages only, citing [n], or to say nothing answers', async () => {
    const user = await signIn();
    const ai = new FakeAi();
    await saveKey(user);
    await indexed(user, [ARTICLES.alarms]);

    await (await ask(user, { question: QUESTION })).response.text();

    const system = String(ai.asks[0]!.body.system);
    expect(system).toContain('only');
    expect(system).toContain('[n]');
    expect(system).toContain('Nothing in your library answers this.');
    expect(promptOf(ai.asks[0]!.body)).toContain(`Question: ${QUESTION}`);
  });

  it('records no use of any source and counts as one request', async () => {
    const user = await signIn();
    new FakeAi();
    await saveKey(user);
    await indexed(user, [ARTICLES.alarms]);
    const uses = async () =>
      (await env.DB.prepare('SELECT id, use_count, last_used_at FROM links ORDER BY id').all())
        .results;
    const requests = async () =>
      (await env.DB.prepare('SELECT SUM(count) AS n FROM rate_limits WHERE user_id = ?')
        .bind(user.id)
        .first<{ n: number }>())!.n;
    const before = {
      uses: await uses(),
      used: await count('link_uses'),
      requests: await requests(),
    };

    await (await ask(user, { question: QUESTION })).response.text();

    expect(await uses()).toEqual(before.uses);
    expect(await count('link_uses')).toBe(before.used);
    expect(await requests()).toBe(before.requests + 1);
  });

  it('sends the provider no passage of another user’s links, even from an index that mixes users', async () => {
    const a = await signIn('a@example.test', 'A');
    const b = await signIn('b@example.test', 'B');
    const ai = new FakeAi();
    await saveKey(a);
    const [aLink] = await indexed(a, [
      { ...ARTICLES.alarms, url: 'https://a.example/alarms', title: 'Alarms of A' },
    ]);
    await indexed(b, [
      { ...ARTICLES.alarms, url: 'https://b.example/alarms', title: 'Alarms of B' },
    ]);
    meaning.ignoreNamespaces = true;

    const sent = events(await (await ask(a, { question: QUESTION })).response.text());

    expect((sent[0]!.data.sources as { link: { id: string } }[]).map((s) => s.link.id)).toEqual([
      aLink,
    ]);
    expect(JSON.stringify(ai.asks[0]!.body)).not.toContain('Alarms of B');
  });

  it('answers that nothing answers, without calling the provider, when no passage is near enough', async () => {
    const user = await signIn();
    const ai = new FakeAi();
    await saveKey(user);
    await indexed(user, [ARTICLES.alarms]);

    const r = await ask(user, { question: 'quarterly tax return' });

    expect(r.status).toBe(200);
    expect(events(await r.response.text())).toEqual([
      {
        event: 'sources',
        data: { sources: [], queries: ['quarterly tax return'], meaning: 'used' },
      },
      { event: 'delta', data: { text: 'Nothing in your library answers this.' } },
      { event: 'done', data: {} },
    ]);
    expect(ai.asks).toEqual([]);
  });
});

describe('an answer the provider cannot finish', () => {
  afterEach(() => setProviderTimeout(null));

  const providers = [
    { provider: 'anthropic' as const, model: 'claude-test' },
    { provider: 'openrouter' as const, model: 'test/model' },
  ];

  /** A signed-in user with a key, an indexed article and a fake provider that is failed by `arrange`. */
  async function asked(
    provider: 'anthropic' | 'openrouter',
    model: string,
    arrange: (ai: FakeAi) => void,
  ) {
    const user = await signIn();
    const ai = new FakeAi();
    await saveKey(user, provider, model);
    await indexed(user, [ARTICLES.alarms]);
    arrange(ai);
    const sent = events(await (await ask(user, { question: QUESTION })).response.text());
    const settings = (await api('GET', '/api/v1/settings/ai', { as: user.session })).json;
    return { sent, settings };
  }

  it.each(providers.flatMap((p) => [401, 402, 403].map((status) => ({ ...p, status }))))(
    'ends with ai_key_rejected and marks the key when $provider answers $status',
    async ({ provider, model, status }) => {
      const { sent, settings } = await asked(provider, model, (ai) =>
        ai.status(status, 'invalid x-api-key', { testsToo: false }),
      );

      expect(sent.map((e) => e.event)).toEqual(['sources', 'error']);
      expect(sent[1]!.data).toEqual({ error: 'ai_key_rejected', message: 'invalid x-api-key' });
      expect(settings).toMatchObject({ status: 'rejected', rejected_message: 'invalid x-api-key' });
    },
  );

  it.each(
    providers.flatMap((p) => [
      { ...p, name: 'is unreachable', arrange: (ai: FakeAi) => ai.refuse(), deltas: 0 },
      {
        ...p,
        name: 'answers 503',
        arrange: (ai: FakeAi) => ai.status(503, 'overloaded', { testsToo: false }),
        deltas: 0,
      },
      {
        ...p,
        name: 'stalls after one piece',
        arrange: (ai: FakeAi) => {
          setProviderTimeout(200);
          ai.answerText(['Use '], { hang: true });
        },
        deltas: 1,
      },
    ]),
  )(
    'ends with provider_unavailable, keeping the key, when $provider $name',
    async ({ provider, model, arrange, deltas }) => {
      const { sent, settings } = await asked(provider, model, arrange);

      expect(sent.map((e) => e.event)).toEqual([
        'sources',
        ...Array<string>(deltas).fill('delta'),
        'error',
      ]);
      expect(sent.at(-1)!.data).toMatchObject({ error: 'provider_unavailable' });
      expect(typeof sent.at(-1)!.data.message).toBe('string');
      expect(settings.status).toBe('verified');
    },
  );

  it.each(
    providers.flatMap((p) => [
      {
        ...p,
        name: 'is rate limited',
        arrange: (ai: FakeAi) => ai.status(429, 'slow down', { testsToo: false }),
        message: 'rate limited: slow down',
      },
      {
        ...p,
        name: 'refuses the request',
        arrange: (ai: FakeAi) => ai.status(400, 'bad request', { testsToo: false }),
        message: 'bad request',
      },
      {
        ...p,
        name: 'declines to answer',
        arrange: (ai: FakeAi) => ai.refusal(),
        message: 'the model declined',
      },
    ]),
  )(
    'ends with provider_failed and the provider’s message when $provider $name',
    async ({ provider, model, arrange, message }) => {
      const { sent, settings } = await asked(provider, model, arrange);

      expect(sent.map((e) => e.event)).toEqual(['sources', 'error']);
      expect(sent[1]!.data).toEqual({ error: 'provider_failed', message });
      expect(settings.status).toBe('verified');
    },
  );
});

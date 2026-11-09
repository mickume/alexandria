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
      name: 'a refused filter',
      body: { question: 'alarms state:bogus' },
      status: 400,
      json: {
        error: 'invalid_filter',
        field: 'question',
        message: expect.stringContaining('state:bogus'),
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

  it.each([
    { name: 'the embedding fails', arrange: () => meaning.fail('embed') },
    { name: 'the index fails', arrange: () => meaning.fail('query') },
  ])('answers 503 when $name, without calling the provider', async ({ arrange }) => {
    const user = await signIn();
    const ai = new FakeAi();
    await saveKey(user);
    arrange();

    const r = await ask(user, { question: 'how do I schedule background work?' });

    expect(r.status).toBe(503);
    expect(r.json).toEqual({
      error: 'search_unavailable',
      message: 'search by meaning is unavailable, try again',
    });
    expect(ai.asks).toEqual([]);
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
      const headings = promptOf(request!.body).match(/^\[\d+\] /gm) ?? [];
      expect(headings).toHaveLength(8);
      const perSource = new Map<string, number>();
      for (const h of headings) perSource.set(h, (perSource.get(h) ?? 0) + 1);
      expect(Math.max(...perSource.values())).toBeLessThanOrEqual(3);
      // The big link’s 3 passages and 5 of the 6 others make the 8.
      expect((sent[0]!.data.sources as unknown[]).length).toBe(6);
    },
  );

  it('reads the passages under the question’s filters', async () => {
    const user = await signIn();
    const ai = new FakeAi();
    await saveKey(user);
    const [tagged] = await indexed(user, [
      { url: 'https://a.example/', title: 'Alarm tagged', text: null, tags: ['infra'] },
      { url: 'https://b.example/', title: 'Alarm plain', text: null },
    ]);

    const sent = events(
      await (await ask(user, { question: 'schedule a task tag:infra' })).response.text(),
    );

    expect((sent[0]!.data.sources as { link: { id: string } }[]).map((s) => s.link.id)).toEqual([
      tagged,
    ]);
    expect(promptOf(ai.asks[0]!.body)).toContain('Alarm tagged');
    expect(promptOf(ai.asks[0]!.body)).not.toContain('Alarm plain');
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
      { event: 'sources', data: { sources: [] } },
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

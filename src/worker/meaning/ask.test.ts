import { describe, expect, it } from 'vitest';
import { FakeAi } from '../test/ai';
import { api, env, signIn, type TestUser } from '../test/helpers';
import { meaning } from '../test/meaning';
import { markKeyRejected } from '../enrich/keys';

/** Saves an Anthropic key the fake provider accepts. */
async function saveKey(user: TestUser) {
  const r = await api('PUT', '/api/v1/settings/ai', {
    as: user.session,
    body: { provider: 'anthropic', api_key: 'sk-ant-abcd1234' },
  });
  expect(r.status).toBe(200);
}

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

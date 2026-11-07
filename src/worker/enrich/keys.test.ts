import { describe, expect, it } from 'vitest';
import { FakeAi } from '../test/ai';
import { api, env, seedLinks, signIn, type TestUser } from '../test/helpers';
import { setProviderTimeout } from './providers';
import { decryptKey } from './keys';

function settings(user: TestUser) {
  return api('GET', '/api/v1/settings/ai', { as: user.session });
}

function save(user: TestUser, body: Record<string, unknown>) {
  return api('PUT', '/api/v1/settings/ai', { as: user.session, body });
}

async function allStoredValues(): Promise<string[]> {
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  ).all<{ name: string }>();
  const values: string[] = [];
  for (const { name } of tables.results) {
    const rows = await env.DB.prepare(`SELECT * FROM ${name}`).all();
    for (const row of rows.results) values.push(...Object.values(row).map(String));
  }
  return values;
}

describe('saving an AI key', () => {
  it.each([
    {
      provider: 'anthropic',
      api_key: 'sk-ant-abcd1234',
      model: undefined,
      stored: 'claude-opus-5-5',
    },
    {
      provider: 'openrouter',
      api_key: 'sk-or-wxyz',
      model: 'meta/llama-4',
      stored: 'meta/llama-4',
    },
  ])(
    'stores a $provider key the provider accepts',
    async ({ provider, api_key, model, stored }) => {
      const ai = new FakeAi();
      const user = await signIn();
      const r = await save(user, { provider, api_key, ...(model ? { model } : {}) });
      expect(r.status).toBe(200);
      expect(r.json).toEqual({
        configured: true,
        provider,
        model: stored,
        key_last4: api_key.slice(-4),
        status: 'verified',
        rejected_message: null,
      });
      expect(ai.requests).toHaveLength(1);
      const [request] = ai.requests;
      expect(request!.provider).toBe(provider);
      expect(request!.body.model).toBe(stored);
      const auth = request!.headers.get('x-api-key') ?? request!.headers.get('Authorization');
      expect(auth).toContain(api_key);
    },
  );

  it.each(['no previous key', 'a previous verified key'])(
    'refuses a key the provider rejects, keeping %s',
    async (before) => {
      const ai = new FakeAi();
      const user = await signIn();
      if (before === 'a previous verified key') {
        expect(
          (await save(user, { provider: 'anthropic', api_key: 'sk-ant-good9999' })).status,
        ).toBe(200);
      }
      const earlier = (await settings(user)).json;
      ai.rejectKeys(401, 'invalid x-api-key');
      const r = await save(user, { provider: 'anthropic', api_key: 'sk-ant-bad00000' });
      expect(r.status).toBe(400);
      expect(r.json).toEqual({
        error: 'key_rejected',
        field: 'api_key',
        message: 'invalid x-api-key',
      });
      expect((await settings(user)).json).toEqual(earlier);
    },
  );

  it.each([
    {
      body: { provider: 'workers-ai', api_key: 'k' },
      error: 'invalid_provider',
      field: 'provider',
    },
    { body: { provider: 'anthropic', api_key: '' }, error: 'invalid_key', field: 'api_key' },
    { body: { provider: 'anthropic' }, error: 'invalid_key', field: 'api_key' },
    { body: { provider: 'openrouter', api_key: 'k' }, error: 'model_required', field: 'model' },
    {
      body: { provider: 'anthropic', api_key: 'k', model: 'm'.repeat(201) },
      error: 'invalid_model',
      field: 'model',
    },
  ])('refuses $body without calling a provider', async ({ body, error, field }) => {
    const ai = new FakeAi();
    const user = await signIn();
    const r = await save(user, body);
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error, field, message: expect.any(String) });
    expect(ai.requests).toEqual([]);
    expect((await settings(user)).json.configured).toBe(false);
  });

  it.each(['refusing connections', 'answering 529 overloaded', 'stalling past the timeout'])(
    'says the provider is unavailable when it is %s',
    async (how) => {
      const ai = new FakeAi();
      if (how === 'refusing connections') ai.refuse();
      else if (how === 'answering 529 overloaded') ai.status(529, 'overloaded');
      else ai.stall();
      setProviderTimeout(200);
      try {
        const user = await signIn();
        const r = await save(user, { provider: 'anthropic', api_key: 'sk-ant-abcd1234' });
        expect(r.status).toBe(502);
        expect(r.json).toEqual({ error: 'provider_unavailable', message: expect.any(String) });
        expect((await settings(user)).json.configured).toBe(false);
      } finally {
        setProviderTimeout(null);
      }
    },
  );
});

describe('reading the AI settings', () => {
  it('says there is no key, and how many links wait for one', async () => {
    const user = await signIn();
    const ids = await seedLinks(user, [{ url: 'https://a.example' }, { url: 'https://b.example' }]);
    for (const id of ids) {
      await env.DB.prepare("UPDATE links SET enrichment_status = 'no_key' WHERE id = ?")
        .bind(id)
        .run();
    }
    expect((await settings(user)).json).toEqual({ configured: false, unenriched_count: 2 });
  });

  it('shows a verified key by its last 4 characters', async () => {
    new FakeAi();
    const user = await signIn();
    await save(user, { provider: 'anthropic', api_key: 'sk-ant-abcd1234' });
    expect((await settings(user)).json).toEqual({
      configured: true,
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      key_last4: '1234',
      status: 'verified',
      rejected_message: null,
      unenriched_count: 0,
    });
  });

  it('shows a rejected key with the provider’s message', async () => {
    new FakeAi();
    const user = await signIn();
    await save(user, { provider: 'anthropic', api_key: 'sk-ant-abcd1234' });
    await env.DB.prepare(
      "UPDATE users SET ai_key_status = 'rejected', ai_key_rejected_message = 'credit balance too low' WHERE id = ?",
    )
      .bind(user.id)
      .run();
    expect((await settings(user)).json).toMatchObject({
      status: 'rejected',
      rejected_message: 'credit balance too low',
    });
  });
});

describe('removing the AI key', () => {
  it('forgets the provider, the model and the key', async () => {
    new FakeAi();
    const user = await signIn();
    await save(user, { provider: 'anthropic', api_key: 'sk-ant-abcd1234' });
    expect((await api('DELETE', '/api/v1/settings/ai', { as: user.session })).status).toBe(204);
    expect((await settings(user)).json).toEqual({ configured: false, unenriched_count: 0 });
    const row = await env.DB.prepare(
      'SELECT ai_provider, ai_model, ai_key_ciphertext, ai_key_iv, ai_key_last4 FROM users WHERE id = ?',
    )
      .bind(user.id)
      .first();
    expect(Object.values(row ?? {})).toEqual([null, null, null, null, null]);
  });
});

describe('a stored key', () => {
  it('is kept only encrypted, bound to its user', async () => {
    new FakeAi();
    const user = await signIn('owner@example.test');
    const other = await signIn('other@example.test', 'Other');
    const key = 'sk-ant-secret-abcd1234';
    await save(user, { provider: 'anthropic', api_key: key });
    for (const value of await allStoredValues()) {
      expect(value).not.toContain('sk-ant-secret');
    }
    const row = await env.DB.prepare('SELECT ai_key_ciphertext, ai_key_iv FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ ai_key_ciphertext: string; ai_key_iv: string }>();
    expect(await decryptKey(env, row!.ai_key_ciphertext, row!.ai_key_iv, user.id)).toBe(key);
    await expect(
      decryptKey(env, row!.ai_key_ciphertext, row!.ai_key_iv, other.id),
    ).rejects.toThrow();
  });
});

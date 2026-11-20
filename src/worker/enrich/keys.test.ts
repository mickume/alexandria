import { describe, expect, it } from 'vitest';
import { env, setNow } from '../test/helpers';
import { aiConfig, keyRejection, markKeyRejected, REJECTION_RETRY_MS } from './keys';

describe('the deployment’s AI configuration', () => {
  it.each([
    { label: 'no key', vars: {}, config: null },
    { label: 'a blank key', vars: { AI_API_KEY: '  ' }, config: null },
    {
      label: 'a key alone',
      vars: { AI_API_KEY: ' sk-ant-abcd1234 ' },
      config: { provider: 'anthropic', model: 'claude-opus-5-5', apiKey: 'sk-ant-abcd1234' },
    },
    {
      label: 'Anthropic with a model',
      vars: { AI_PROVIDER: 'Anthropic', AI_MODEL: 'claude-sonnet-5-5', AI_API_KEY: 'k' },
      config: { provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'k' },
    },
    {
      label: 'OpenRouter with a model',
      vars: { AI_PROVIDER: 'openrouter', AI_MODEL: 'meta/llama-4', AI_API_KEY: 'k' },
      config: { provider: 'openrouter', model: 'meta/llama-4', apiKey: 'k' },
    },
    {
      label: 'OpenRouter without a model',
      vars: { AI_PROVIDER: 'openrouter', AI_API_KEY: 'k' },
      config: null,
    },
    {
      label: 'another provider',
      vars: { AI_PROVIDER: 'workers-ai', AI_API_KEY: 'k' },
      config: null,
    },
  ])('reads $label', ({ vars, config }) => {
    expect(aiConfig({ ...env, ...vars })).toEqual(config);
  });
});

describe('a refused key', () => {
  const T = Date.parse('2026-11-20T09:00:00.000Z');

  it('stays refused for an hour, for that key only', async () => {
    setNow(T);
    await markKeyRejected(env.DB, 'ai', 'sk-ant-old', 'invalid x-api-key');
    expect(await keyRejection(env.DB, 'ai', 'sk-ant-old')).toBe('invalid x-api-key');
    expect(await keyRejection(env.DB, 'ai', 'sk-ant-new')).toBeNull();
    expect(await keyRejection(env.DB, 'firecrawl', 'sk-ant-old')).toBeNull();
    setNow(T + REJECTION_RETRY_MS - 1);
    expect(await keyRejection(env.DB, 'ai', 'sk-ant-old')).toBe('invalid x-api-key');
    setNow(T + REJECTION_RETRY_MS);
    expect(await keyRejection(env.DB, 'ai', 'sk-ant-old')).toBeNull();
  });

  it('is remembered by its fingerprint, never by the key itself', async () => {
    await markKeyRejected(env.DB, 'firecrawl', 'fc-secret-abcd1234', 'Unauthorized');
    const rows = await env.DB.prepare('SELECT * FROM key_rejections').all();
    expect(JSON.stringify(rows.results)).not.toContain('fc-secret');
    expect(rows.results).toEqual([
      expect.objectContaining({ service: 'firecrawl', message: 'Unauthorized' }),
    ]);
  });
});

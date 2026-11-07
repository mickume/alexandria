import { describe, expect, it } from 'vitest';
import { FakeAi } from '../test/ai';
import { env } from '../test/helpers';
import { enrichWith } from './providers';

const RESULT = { summary: 'About links.', tags: ['links', 'web', 'reading'], topic: 'reading' };

describe('asking a provider for an enrichment', () => {
  it.each([
    { provider: 'anthropic' as const, model: 'claude-opus-5-5' },
    { provider: 'openrouter' as const, model: 'meta/llama-4' },
  ])('reads the structured result from $provider', async ({ provider, model }) => {
    const ai = new FakeAi().answer(RESULT);
    const r = await enrichWith(env, { provider, apiKey: 'k-1234', model }, 'Summarise this page.');
    expect(r).toEqual({ ok: true, value: RESULT });
    const [request] = ai.requests;
    expect(request!.body.model).toBe(model);
    if (provider === 'anthropic') {
      expect(request!.body.tool_choice).toEqual({ type: 'tool', name: 'record_enrichment' });
    } else {
      expect((request!.body.response_format as { type: string }).type).toBe('json_schema');
    }
  });
});

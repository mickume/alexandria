import { afterEach, describe, expect, it } from 'vitest';
import { FakeAi } from '../test/ai';
import { env } from '../test/helpers';
import { enrichWith, RESULT_SCHEMA, setProviderTimeout, streamAnswer } from './providers';

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
      // Current models refuse a forced tool call: the schema goes through structured outputs.
      expect(request!.body.output_config).toEqual({
        format: { type: 'json_schema', schema: RESULT_SCHEMA },
      });
      expect(request!.body.tool_choice).toBeUndefined();
      expect(request!.body.tools).toBeUndefined();
    } else {
      expect((request!.body.response_format as { type: string }).type).toBe('json_schema');
    }
  });
});

describe('streaming an answer from a provider', () => {
  afterEach(() => setProviderTimeout(null));

  const providers = [
    { provider: 'anthropic' as const, model: 'claude-test', key: 'authorization' },
    { provider: 'openrouter' as const, model: 'test/model', key: 'authorization' },
  ];
  const request = {
    system: 'Answer from the passages.',
    prompt: '[1] A passage.\n\nQuestion: why?',
  };

  /** Streams an answer and returns the pieces handed on and what it came to. */
  async function ask(provider: 'anthropic' | 'openrouter', model: string) {
    const pieces: string[] = [];
    const outcome = await streamAnswer(
      env,
      { provider, apiKey: 'sk-test-1234', model },
      request,
      (text) => void pieces.push(text),
    );
    return { pieces, outcome };
  }

  it.each(providers)(
    'hands on each piece of text from $provider as it arrives, with the key, the model and the question',
    async ({ provider, model, key }) => {
      const ai = new FakeAi().answerText(['Use ', 'an alarm [1].']);

      const { pieces, outcome } = await ask(provider, model);

      expect(outcome).toEqual({ ok: true, value: undefined });
      expect(pieces).toEqual(['Use ', 'an alarm [1].']);
      const [sent] = ai.asks;
      expect(sent!.body.model).toBe(model);
      expect(sent!.body.stream).toBe(true);
      expect(sent!.headers.get(key)).toContain('sk-test-1234');
      expect(JSON.stringify(sent!.body)).toContain('Answer from the passages.');
      expect(JSON.stringify(sent!.body)).toContain('Question: why?');
    },
  );

  it.each(providers)(
    'sorts a failure of $provider as enrichment sorts it',
    async ({ provider, model }) => {
      const cases: [(ai: FakeAi) => void, object][] = [
        [
          (ai) => ai.status(401, 'invalid key'),
          { kind: 'rejected', status: 401, message: 'invalid key' },
        ],
        [
          (ai) => ai.status(402, 'no credit'),
          { kind: 'rejected', status: 402, message: 'no credit' },
        ],
        [
          (ai) => ai.status(403, 'forbidden'),
          { kind: 'rejected', status: 403, message: 'forbidden' },
        ],
        [(ai) => ai.status(503, 'overloaded'), { kind: 'unavailable', message: 'overloaded' }],
        [(ai) => ai.refuse(), { kind: 'unavailable', message: 'could not reach the provider' }],
        [
          (ai) => ai.status(429, 'slow down'),
          { kind: 'failed', message: 'rate limited: slow down' },
        ],
        [(ai) => ai.status(400, 'bad request'), { kind: 'failed', message: 'bad request' }],
        [(ai) => ai.refusal(), { kind: 'failed', message: 'the model declined' }],
      ];
      for (const [arrange, expected] of cases) {
        arrange(new FakeAi());

        const { pieces, outcome } = await ask(provider, model);

        expect(outcome).toEqual({ ok: false, ...expected });
        expect(pieces).toEqual([]);
      }
    },
  );

  it.each(providers)(
    'gives up on a stalled $provider after the time limit, keeping what arrived',
    async ({ provider, model }) => {
      setProviderTimeout(200);
      new FakeAi().answerText(['Use '], { hang: true });

      const { pieces, outcome } = await ask(provider, model);

      expect(pieces).toEqual(['Use ']);
      expect(outcome).toEqual({ ok: false, kind: 'unavailable', message: 'timed out' });
    },
  );
});

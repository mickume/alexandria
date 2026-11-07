import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env';
import type { Provider } from './keys';

/** How long a provider call may take before it is abandoned. */
export const PROVIDER_TIMEOUT_MS = 60_000;

let timeoutOverride: number | null = null;

/** Shortens the provider timeout, for tests; null restores the 60 seconds. */
export function setProviderTimeout(ms: number | null): void {
  timeoutOverride = ms;
}

function timeoutMs(): number {
  return timeoutOverride ?? PROVIDER_TIMEOUT_MS;
}

/** The provider and credentials one call runs with: always the user's own. */
export interface ProviderCall {
  provider: Provider;
  apiKey: string;
  model: string;
}

/** What a provider call came to. */
export type ProviderOutcome<T> =
  | { ok: true; value: T }
  /** The key was refused: HTTP 401, 402 or 403, with the provider's message. */
  | { ok: false; kind: 'rejected'; status: number; message: string }
  /** The provider could not be reached, answered 5xx, or did not answer in time. */
  | { ok: false; kind: 'unavailable'; message: string }
  /** Any other failure: a 4xx, a rate limit, a refusal, an unusable answer. */
  | { ok: false; kind: 'failed'; message: string };

/** The structured result asked of the model. */
export const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'What the page is about, in at most 60 words.' },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: '3 to 8 lower-case tags: single words or hyphenated phrases.',
    },
    topic: { type: 'string', description: 'The one topic the page belongs to.' },
  },
  required: ['summary', 'tags', 'topic'],
  additionalProperties: false,
} as const;

const TOOL_NAME = 'record_enrichment';

/** The provider's own message in an error body, if it carries one. */
function messageOf(body: unknown, fallback: string): string {
  if (typeof body === 'string') {
    try {
      return messageOf(JSON.parse(body), body || fallback);
    } catch {
      return body || fallback;
    }
  }
  if (body && typeof body === 'object') {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message) return message;
      return messageOf(error, fallback);
    }
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

/** Sorts a failed call by its HTTP status. */
function byStatus(status: number, message: string): ProviderOutcome<never> {
  if (status === 401 || status === 402 || status === 403) {
    return { ok: false, kind: 'rejected', status, message };
  }
  if (status >= 500) return { ok: false, kind: 'unavailable', message };
  if (status === 429) return { ok: false, kind: 'failed', message: `rate limited: ${message}` };
  return { ok: false, kind: 'failed', message };
}

/** Runs `call`, abandoning it after the provider timeout. */
async function withTimeout<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    return await Promise.race([
      call(controller.signal),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(new Error('timed out')), {
          once: true,
        }),
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function anthropic(env: Env, apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    baseURL: env.ANTHROPIC_BASE_URL,
    maxRetries: 0,
    timeout: timeoutMs(),
  });
}

/** An error answer of OpenRouter's HTTP API. */
class OpenRouterHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly body: string,
  ) {
    super(`OpenRouter answered ${statusCode}`);
  }
}

/**
 * One chat completion through OpenRouter's HTTP API
 * (POST {OPENROUTER_BASE_URL}/chat/completions), returning the first choice's
 * message content.
 */
async function openRouterChat(
  env: Env,
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<string | null> {
  const response = await fetch(`${env.OPENROUTER_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  if (!response.ok) throw new OpenRouterHttpError(response.status, text);
  const json = JSON.parse(text) as { choices?: { message?: { content?: unknown } }[] };
  const content = json.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : null;
}

/** Turns anything a client threw into an outcome. */
function fromError(err: unknown): ProviderOutcome<never> {
  if (err instanceof Anthropic.APIError && typeof err.status === 'number') {
    return byStatus(err.status, messageOf(err.error, err.message));
  }
  const status = (err as { statusCode?: unknown }).statusCode;
  if (typeof status === 'number') {
    return byStatus(status, messageOf((err as { body?: unknown }).body, String(err)));
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/timed? ?out|abort/i.test(message))
    return { ok: false, kind: 'unavailable', message: 'timed out' };
  return { ok: false, kind: 'unavailable', message: 'could not reach the provider' };
}

/** Sends one minimal completion with the user's key and model, to see whether the provider accepts them. */
export async function testKey(env: Env, call: ProviderCall): Promise<ProviderOutcome<void>> {
  const prompt = 'Reply with the single word: ok';
  try {
    await withTimeout(async (signal) => {
      if (call.provider === 'anthropic') {
        await anthropic(env, call.apiKey).messages.create(
          { model: call.model, max_tokens: 5, messages: [{ role: 'user', content: prompt }] },
          { signal },
        );
      } else {
        await openRouterChat(
          env,
          call.apiKey,
          { model: call.model, max_tokens: 5, messages: [{ role: 'user', content: prompt }] },
          signal,
        );
      }
    });
    return { ok: true, value: undefined };
  } catch (err) {
    return fromError(err);
  }
}

/**
 * Asks the user's provider for a structured {summary, tags, topic}: a forced
 * tool call through Anthropic's Messages API, a JSON-schema response format
 * through OpenRouter's chat completions. The value is the model's raw object.
 */
export async function enrichWith(
  env: Env,
  call: ProviderCall,
  prompt: string,
): Promise<ProviderOutcome<unknown>> {
  try {
    return await withTimeout(async (signal) => {
      if (call.provider === 'anthropic') {
        const message = await anthropic(env, call.apiKey).messages.create(
          {
            model: call.model,
            max_tokens: 1024,
            tools: [
              {
                name: TOOL_NAME,
                description: 'Record the summary, tags and topic of the page.',
                input_schema: RESULT_SCHEMA as unknown as Anthropic.Tool.InputSchema,
              },
            ],
            tool_choice: { type: 'tool', name: TOOL_NAME },
            messages: [{ role: 'user', content: prompt }],
          },
          { signal },
        );
        if (message.stop_reason === 'refusal') {
          return { ok: false, kind: 'failed', message: 'the model declined' } as const;
        }
        const block = message.content.find((b) => b.type === 'tool_use');
        if (!block || block.type !== 'tool_use') {
          return { ok: false, kind: 'failed', message: 'no structured result' } as const;
        }
        return { ok: true, value: block.input } as const;
      }
      const content = await openRouterChat(
        env,
        call.apiKey,
        {
          model: call.model,
          messages: [{ role: 'user', content: prompt }],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'enrichment', strict: true, schema: RESULT_SCHEMA },
          },
        },
        signal,
      );
      if (!content) {
        return { ok: false, kind: 'failed', message: 'the model declined' } as const;
      }
      try {
        return { ok: true, value: JSON.parse(content) as unknown } as const;
      } catch {
        return { ok: false, kind: 'failed', message: 'the answer is not JSON' } as const;
      }
    });
  } catch (err) {
    return fromError(err);
  }
}

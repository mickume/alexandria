import Anthropic from '@anthropic-ai/sdk';
import { now } from '../clock';
import type { Env } from '../env';
import { recordUsage, type Purpose } from '../stats/daily';
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
  /** The owner the call is made for: with it, the call's token usage is recorded. */
  userId?: string;
}

/** The tokens an answer reported. */
interface Tokens {
  input: number;
  output: number;
}

/** Anthropic's usage as tokens: the input with the prompt-cache tokens, and the output. */
function anthropicTokens(usage: Anthropic.Usage | undefined | null): Tokens | null {
  if (!usage) return null;
  return {
    input:
      usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0),
    output: usage.output_tokens,
  };
}

/** OpenRouter's usage as tokens. */
function openRouterTokens(usage: unknown): Tokens | null {
  const u = usage as { prompt_tokens?: unknown; completion_tokens?: unknown } | null | undefined;
  if (typeof u?.prompt_tokens !== 'number' || typeof u.completion_tokens !== 'number') return null;
  return { input: u.prompt_tokens, output: u.completion_tokens };
}

/**
 * Runs one provider call and, for an owner's call, records it under `purpose`
 * with the tokens it reported (`seen`), whatever its outcome. A failed record
 * is logged and changes nothing about the call.
 */
async function metered<T>(
  env: Env,
  call: ProviderCall,
  purpose: Purpose,
  run: (seen: (tokens: Tokens | null) => void) => Promise<ProviderOutcome<T>>,
): Promise<ProviderOutcome<T>> {
  let tokens: Tokens | null = null;
  const outcome = await run((t) => {
    tokens = t;
  });
  if (call.userId) {
    const record = { userId: call.userId, purpose, model: call.model, at: now(), tokens };
    try {
      await recordUsage(env.DB, record);
    } catch (err) {
      console.error('recording the AI usage failed', err);
    }
  }
  return outcome;
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
      description: '1 to 5 lower-case tags: single words or hyphenated phrases.',
    },
    topic: {
      type: 'string',
      description:
        'The path of the one topic the page belongs to: one to three names from the most general to the most specific, separated by " > ".',
    },
  },
  required: ['summary', 'tags', 'topic'],
  additionalProperties: false,
} as const;

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
): Promise<{ content: string | null; tokens: Tokens | null }> {
  const response = await fetch(`${env.OPENROUTER_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  if (!response.ok) throw new OpenRouterHttpError(response.status, text);
  const json = JSON.parse(text) as {
    choices?: { message?: { content?: unknown } }[];
    usage?: unknown;
  };
  const content = json.choices?.[0]?.message?.content;
  return {
    content: typeof content === 'string' ? content : null,
    tokens: openRouterTokens(json.usage),
  };
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
  return metered(env, call, 'key_test', async (seen) => {
    try {
      await withTimeout(async (signal) => {
        if (call.provider === 'anthropic') {
          const message = await anthropic(env, call.apiKey).messages.create(
            { model: call.model, max_tokens: 5, messages: [{ role: 'user', content: prompt }] },
            { signal },
          );
          seen(anthropicTokens(message.usage));
        } else {
          const answer = await openRouterChat(
            env,
            call.apiKey,
            { model: call.model, max_tokens: 5, messages: [{ role: 'user', content: prompt }] },
            signal,
          );
          seen(answer.tokens);
        }
      });
      return { ok: true, value: undefined };
    } catch (err) {
      return fromError(err);
    }
  });
}

/**
 * The structured result asked of the model for a topic's split: each
 * sub-topic with the numbers of its links in the request. Links are named by
 * short numbers rather than ids, and a link left out stays where it is, so
 * that the answer for 500 links stays a few thousand tokens.
 */
export const SPLIT_SCHEMA = {
  type: 'object',
  properties: {
    subtopics: {
      type: 'array',
      description: 'The 2 to 10 sub-topics, each with the numbers of the links it holds.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The sub-topic’s name.' },
          links: {
            type: 'array',
            items: { type: 'integer' },
            description: 'The numbers of the links that belong under it.',
          },
        },
        required: ['name', 'links'],
        additionalProperties: false,
      },
    },
  },
  required: ['subtopics'],
  additionalProperties: false,
} as const;

/** The longest answers an enrichment and a split may take: a split's lists 500 link numbers. */
const ENRICH_MAX_TOKENS = 4096;
const SPLIT_MAX_TOKENS = 16_384;

/**
 * Asks the user's provider for a structured result of `schema`: a JSON schema
 * through structured outputs (output_config.format) of Anthropic's Messages
 * API, and through the response format of OpenRouter's chat completions. The
 * value is the model's raw object.
 */
async function structuredWith(
  env: Env,
  call: ProviderCall,
  prompt: string,
  { schema, name, maxTokens }: { schema: object; name: string; maxTokens: number },
  seen: (tokens: Tokens | null) => void,
): Promise<ProviderOutcome<unknown>> {
  try {
    return await withTimeout(async (signal) => {
      if (call.provider === 'anthropic') {
        // Structured outputs: current models refuse a forced tool call, and the
        // schema constrains the answer to the JSON object itself.
        const message = await anthropic(env, call.apiKey).messages.create(
          {
            model: call.model,
            max_tokens: maxTokens,
            output_config: {
              format: { type: 'json_schema', schema: schema as Record<string, unknown> },
            },
            messages: [{ role: 'user', content: prompt }],
          },
          { signal },
        );
        seen(anthropicTokens(message.usage));
        if (message.stop_reason === 'refusal') {
          return { ok: false, kind: 'failed', message: 'the model declined' } as const;
        }
        const text = message.content.find((b) => b.type === 'text');
        if (!text || text.type !== 'text' || message.stop_reason === 'max_tokens') {
          return { ok: false, kind: 'failed', message: 'no structured result' } as const;
        }
        try {
          return { ok: true, value: JSON.parse(text.text) as unknown } as const;
        } catch {
          return { ok: false, kind: 'failed', message: 'the answer is not JSON' } as const;
        }
      }
      const { content, tokens } = await openRouterChat(
        env,
        call.apiKey,
        {
          model: call.model,
          messages: [{ role: 'user', content: prompt }],
          // A split's answer is long; enrichment's fits OpenRouter's default.
          ...(maxTokens > ENRICH_MAX_TOKENS ? { max_tokens: maxTokens } : {}),
          response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
        },
        signal,
      );
      seen(tokens);
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

/** Asks the user's provider for a structured {summary, tags, topic} (RESULT_SCHEMA). */
export function enrichWith(
  env: Env,
  call: ProviderCall,
  prompt: string,
): Promise<ProviderOutcome<unknown>> {
  return metered(env, call, 'enrich', (seen) =>
    structuredWith(
      env,
      call,
      prompt,
      { schema: RESULT_SCHEMA, name: 'enrichment', maxTokens: ENRICH_MAX_TOKENS },
      seen,
    ),
  );
}

/** Asks the user's provider for a topic's split: {subtopics: [{name, links}]} (SPLIT_SCHEMA). */
export function splitWith(
  env: Env,
  call: ProviderCall,
  prompt: string,
): Promise<ProviderOutcome<unknown>> {
  return metered(env, call, 'split', (seen) =>
    structuredWith(
      env,
      call,
      prompt,
      { schema: SPLIT_SCHEMA, name: 'split', maxTokens: SPLIT_MAX_TOKENS },
      seen,
    ),
  );
}

/** What a streamed answer is asked: the instruction, and the passages and question. */
export interface AnswerRequest {
  system: string;
  prompt: string;
  /** The most tokens the answer may hold; ANSWER_MAX_TOKENS when not given. */
  maxTokens?: number;
}

/** The most tokens an answer to a question may hold, unless its request says otherwise. */
export const ANSWER_MAX_TOKENS = 1_024;

const DECLINED = { ok: false, kind: 'failed', message: 'the model declined' } as const;
const NO_ANSWER = { ok: false, kind: 'failed', message: 'the model gave no answer' } as const;

/**
 * Reads the server-sent events of a streamed OpenRouter chat completion,
 * handing on each delta's content, until `[DONE]`.
 */
async function readOpenRouterStream(
  body: ReadableStream<Uint8Array>,
  hand: (text: string) => Promise<void>,
  seen: (tokens: Tokens | null) => void,
): Promise<ProviderOutcome<void>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let declined = false;
  for (;;) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split('\n');
    pending = done ? '' : (lines.pop() ?? '');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice('data:'.length).trim();
      if (data === '[DONE]') return declined ? DECLINED : { ok: true, value: undefined };
      let chunk: {
        error?: unknown;
        choices?: { delta?: { content?: unknown }; finish_reason?: string | null }[];
        usage?: unknown;
      };
      try {
        chunk = JSON.parse(data);
      } catch {
        return { ok: false, kind: 'failed', message: 'the answer is not JSON' };
      }
      if (chunk.error) return { ok: false, kind: 'failed', message: messageOf(chunk, 'failed') };
      // The usage comes in a last chunk, when OpenRouter sends it.
      const tokens = openRouterTokens(chunk.usage);
      if (tokens) seen(tokens);
      const choice = chunk.choices?.[0];
      if (typeof choice?.delta?.content === 'string') await hand(choice.delta.content);
      if (choice?.finish_reason === 'content_filter') declined = true;
    }
    if (done) return declined ? DECLINED : { ok: true, value: undefined };
  }
}

/**
 * Streams the user's provider's answer to a question, handing each piece of
 * text to `onText` as it arrives: through `messages.stream` of Anthropic's SDK,
 * and through OpenRouter's chat completions with `stream: true`. The whole
 * answer has the provider timeout, and a failure is sorted as enrichment's is.
 */
export async function streamAnswer(
  env: Env,
  call: ProviderCall,
  request: AnswerRequest,
  onText: (text: string) => void | Promise<void>,
): Promise<ProviderOutcome<void>> {
  return metered(env, call, 'ask', (seen) => streamWith(env, call, request, onText, seen));
}

/** streamAnswer's call, handing the tokens the answer reports to `seen`. */
async function streamWith(
  env: Env,
  call: ProviderCall,
  request: AnswerRequest,
  onText: (text: string) => void | Promise<void>,
  seen: (tokens: Tokens | null) => void,
): Promise<ProviderOutcome<void>> {
  let received = false;
  const hand = async (text: string) => {
    if (!text) return;
    received = true;
    await onText(text);
  };
  try {
    return await withTimeout(async (signal): Promise<ProviderOutcome<void>> => {
      if (call.provider === 'anthropic') {
        const stream = anthropic(env, call.apiKey).messages.stream(
          {
            model: call.model,
            max_tokens: request.maxTokens ?? ANSWER_MAX_TOKENS,
            system: request.system,
            messages: [{ role: 'user', content: request.prompt }],
          },
          { signal },
        );
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            await hand(event.delta.text);
          }
        }
        const message = await stream.finalMessage();
        seen(anthropicTokens(message.usage));
        if (message.stop_reason === 'refusal') return DECLINED;
        return received ? { ok: true, value: undefined } : NO_ANSWER;
      }
      const response = await fetch(
        `${env.OPENROUTER_BASE_URL.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${call.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: call.model,
            stream: true,
            max_tokens: request.maxTokens ?? ANSWER_MAX_TOKENS,
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.prompt },
            ],
          }),
          signal,
        },
      );
      if (!response.ok) throw new OpenRouterHttpError(response.status, await response.text());
      if (!response.body) return NO_ANSWER;
      const outcome = await readOpenRouterStream(response.body, hand, seen);
      return outcome.ok && !received ? NO_ANSWER : outcome;
    });
  } catch (err) {
    return fromError(err);
  }
}

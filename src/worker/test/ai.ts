/**
 * A fake of the AI providers for the Worker tests: the Anthropic Messages
 * endpoint and OpenRouter's chat completions, answered through the outbound
 * router. By default it accepts every key and answers an enrichment with a
 * fixed result; a test scripts other answers. Every request is logged.
 */
import { env } from 'cloudflare:test';
import { onOutbound } from './outbound';

/** An enrichment result as a provider returns it. */
export interface AiResult {
  summary: string;
  tags: string[];
  topic: string;
}

/** One request a provider received. */
export interface AiRequest {
  provider: 'anthropic' | 'openrouter';
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
  /** Whether it asked for an enrichment (rather than testing a key). */
  enrichment: boolean;
  at: number;
}

type Answer =
  | { kind: 'result'; result: AiResult }
  | { kind: 'status'; status: number; message: string; headers?: Record<string, string> }
  | { kind: 'stall' }
  | { kind: 'refuse' }
  | { kind: 'refusal' };

export const DEFAULT_RESULT: AiResult = {
  summary: 'A short summary.',
  tags: ['cloudflare', 'queues', 'workers'],
  topic: 'web development',
};

export class FakeAi {
  readonly requests: AiRequest[] = [];
  private enrichAnswer: Answer = { kind: 'result', result: DEFAULT_RESULT };
  private keyAnswer: Answer | null = null;

  constructor() {
    onOutbound(new URL(env.ANTHROPIC_BASE_URL).origin, (r) => this.handle('anthropic', r));
    onOutbound(new URL(env.OPENROUTER_BASE_URL).origin, (r) => this.handle('openrouter', r));
  }

  /** Answers enrichments with `result`. */
  answer(result: AiResult): this {
    this.enrichAnswer = { kind: 'result', result };
    return this;
  }

  /** Answers enrichments (and key tests, unless `testsToo` is false) with an error status. */
  status(status: number, message: string, { testsToo = true, headers = {} } = {}): this {
    this.enrichAnswer = { kind: 'status', status, message, headers };
    if (testsToo) this.keyAnswer = this.enrichAnswer;
    return this;
  }

  /** Answers key tests only with an error status. */
  rejectKeys(status: number, message: string): this {
    this.keyAnswer = { kind: 'status', status, message };
    return this;
  }

  /** Never answers. */
  stall(): this {
    this.enrichAnswer = { kind: 'stall' };
    this.keyAnswer = this.enrichAnswer;
    return this;
  }

  /** Refuses every connection. */
  refuse(): this {
    this.enrichAnswer = { kind: 'refuse' };
    this.keyAnswer = this.enrichAnswer;
    return this;
  }

  /** The model declines to answer an enrichment. */
  refusal(): this {
    this.enrichAnswer = { kind: 'refusal' };
    return this;
  }

  /** The enrichment requests, leaving out key tests. */
  get enrichments(): AiRequest[] {
    return this.requests.filter((r) => r.enrichment);
  }

  private async handle(provider: 'anthropic' | 'openrouter', request: Request): Promise<Response> {
    const body = (await request.json()) as Record<string, unknown>;
    const enrichment =
      provider === 'anthropic'
        ? 'output_config' in body || 'tools' in body
        : 'response_format' in body;
    this.requests.push({
      provider,
      url: request.url,
      headers: request.headers,
      body,
      enrichment,
      at: Date.now(),
    });
    const answer = enrichment
      ? this.enrichAnswer
      : (this.keyAnswer ?? { kind: 'result', result: DEFAULT_RESULT });
    if (answer.kind === 'stall') return new Promise<Response>(() => undefined);
    if (answer.kind === 'refuse') throw new Error('connect ECONNREFUSED');
    if (answer.kind === 'status') {
      const error =
        provider === 'anthropic'
          ? { type: 'error', error: { type: 'api_error', message: answer.message } }
          : { error: { code: answer.status, message: answer.message } };
      return Response.json(error, { status: answer.status, headers: answer.headers });
    }
    const model = String(body.model ?? 'model');
    if (provider === 'anthropic') {
      // As the real API answers for current models (Claude Opus 5.5 and the like).
      const forced = (body.tool_choice as { type?: string } | undefined)?.type;
      if (forced === 'tool' || forced === 'any') {
        return Response.json(
          {
            type: 'error',
            error: {
              type: 'invalid_request_error',
              message: 'tool_choice: type "tool" and "any" are not supported for this model.',
            },
          },
          { status: 400 },
        );
      }
      // Structured outputs answer with the JSON as text.
      const content =
        answer.kind === 'refusal'
          ? [{ type: 'text', text: 'I cannot help with that.' }]
          : enrichment
            ? [{ type: 'text', text: JSON.stringify(answer.result) }]
            : [{ type: 'text', text: 'ok' }];
      return Response.json({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model,
        content,
        stop_reason: answer.kind === 'refusal' ? 'refusal' : 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    }
    return Response.json({
      id: 'gen-1',
      object: 'chat.completion',
      created: 1_700_000_000,
      model,
      system_fingerprint: null,
      choices: [
        {
          index: 0,
          finish_reason: answer.kind === 'refusal' ? 'content_filter' : 'stop',
          message: {
            role: 'assistant',
            content:
              answer.kind === 'refusal' ? null : enrichment ? JSON.stringify(answer.result) : 'ok',
            refusal: answer.kind === 'refusal' ? 'I cannot help with that.' : null,
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }
}

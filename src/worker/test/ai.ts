/**
 * A fake of the AI providers for the Worker tests: the Anthropic Messages
 * endpoint and OpenRouter's chat completions, answered through the outbound
 * router. By default it accepts every key and answers an enrichment with a
 * fixed result; a test scripts other answers. Every request is logged.
 */
import { env } from 'cloudflare:test';
import { onOutbound } from './outbound';
import {
  anthropicStream,
  anthropicUsage,
  DEFAULT_USAGE,
  openRouterStream,
  type ReportedUsage,
} from './streams';

/** An enrichment result as a provider returns it. */
export interface AiResult {
  summary: string;
  tags: string[];
  topic: string;
}

/** A link as a split's request lists it: its number in the request, title and summary. */
export interface SplitLink {
  n: number;
  title: string;
  summary: string;
}

/** A split's answer, made from the links the request lists: what the provider returns. */
export type SplitPlan = (links: SplitLink[]) => unknown;

/** The links a split's request lists, one JSON object per line of its prompt. */
function splitLinks(body: Record<string, unknown>): SplitLink[] {
  const [message] = (body.messages as { content: string }[] | undefined) ?? [];
  return (message?.content ?? '')
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as SplitLink);
}

/** One request a provider received. */
export interface AiRequest {
  provider: 'anthropic' | 'openrouter';
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
  /** Whether it asked for an enrichment (rather than testing a key or splitting a topic). */
  enrichment: boolean;
  /** Whether it asked for a topic's split. */
  split: boolean;
  /** Whether it asked for a streamed answer to a question. */
  ask: boolean;
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

/** The pieces of text a streamed answer is made of. */
const DEFAULT_PIECES = ['Use an alarm ', '[1].'];

const encoder = new TextEncoder();

/** A server-sent events body of these chunks, left open after them when `hang` is set. */
function eventStream(chunks: string[], hang: boolean): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (!hang) controller.close();
    },
  });
}

export class FakeAi {
  readonly requests: AiRequest[] = [];
  private enrichAnswer: Answer = { kind: 'result', result: DEFAULT_RESULT };
  private splitPlan: SplitPlan = () => ({ subtopics: [] });
  private keyAnswer: Answer | null = null;
  private pieces = DEFAULT_PIECES;
  private hangAfterPieces = false;
  private reported: ReportedUsage | null = DEFAULT_USAGE;

  constructor() {
    onOutbound(new URL(env.ANTHROPIC_BASE_URL).origin, (r) => this.handle('anthropic', r));
    onOutbound(new URL(env.OPENROUTER_BASE_URL).origin, (r) => this.handle('openrouter', r));
  }

  /** Answers a split with what `plan` makes of its links, unless an error, a stall or a refusal is scripted. */
  split(plan: SplitPlan): this {
    this.splitPlan = plan;
    return this;
  }

  /** The requests that asked for a topic's split. */
  get splits(): AiRequest[] {
    return this.requests.filter((r) => r.split);
  }

  /**
   * Reports `usage` with every answer from now on; null reports none (a streamed
   * Anthropic answer, whose events always carry usage, then reports zeros).
   */
  usage(usage: ReportedUsage | null): this {
    this.reported = usage;
    return this;
  }

  /** Answers enrichments with `result`. */
  answer(result: AiResult): this {
    this.enrichAnswer = { kind: 'result', result };
    return this;
  }

  /**
   * Answers a question with these pieces of text, streamed one by one; with
   * `hang`, the stream stays open after the last piece, as when a provider stalls.
   */
  answerText(pieces: string[], { hang = false } = {}): this {
    this.pieces = pieces;
    this.hangAfterPieces = hang;
    this.enrichAnswer = { kind: 'result', result: DEFAULT_RESULT };
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

  /** The requests that asked for a streamed answer to a question. */
  get asks(): AiRequest[] {
    return this.requests.filter((r) => r.ask);
  }

  /** The enrichment requests, leaving out key tests and splits. */
  get enrichments(): AiRequest[] {
    return this.requests.filter((r) => r.enrichment);
  }

  private async handle(provider: 'anthropic' | 'openrouter', request: Request): Promise<Response> {
    const body = (await request.json()) as Record<string, unknown>;
    const structured =
      provider === 'anthropic'
        ? 'output_config' in body || 'tools' in body
        : 'response_format' in body;
    const schema =
      provider === 'anthropic'
        ? (body.output_config as { format?: { schema?: { properties?: object } } } | undefined)
            ?.format?.schema
        : (
            body.response_format as
              { json_schema?: { schema?: { properties?: object } } } | undefined
          )?.json_schema?.schema;
    const split = structured && 'subtopics' in (schema?.properties ?? {});
    const enrichment = structured && !split;
    const ask = body.stream === true;
    this.requests.push({
      provider,
      url: request.url,
      headers: request.headers,
      body,
      enrichment,
      split,
      ask,
      at: Date.now(),
    });
    const answer =
      structured || ask
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
    if (ask) {
      const refusal = answer.kind === 'refusal';
      const chunks =
        provider === 'anthropic'
          ? anthropicStream(
              model,
              this.pieces,
              refusal,
              this.hangAfterPieces,
              this.reported ?? { input: 0, output: 0 },
            )
          : openRouterStream(model, this.pieces, refusal, this.hangAfterPieces, this.reported);
      return new Response(eventStream(chunks, this.hangAfterPieces), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
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
          : structured
            ? [
                {
                  type: 'text',
                  text: JSON.stringify(split ? this.splitPlan(splitLinks(body)) : answer.result),
                },
              ]
            : [{ type: 'text', text: 'ok' }];
      return Response.json({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model,
        content,
        stop_reason: answer.kind === 'refusal' ? 'refusal' : 'end_turn',
        stop_sequence: null,
        ...(this.reported ? { usage: anthropicUsage(this.reported) } : {}),
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
              answer.kind === 'refusal'
                ? null
                : structured
                  ? JSON.stringify(split ? this.splitPlan(splitLinks(body)) : answer.result)
                  : 'ok',
            refusal: answer.kind === 'refusal' ? 'I cannot help with that.' : null,
          },
        },
      ],
      ...(this.reported
        ? {
            usage: {
              prompt_tokens: this.reported.input,
              completion_tokens: this.reported.output,
              total_tokens: this.reported.input + this.reported.output,
            },
          }
        : {}),
    });
  }
}

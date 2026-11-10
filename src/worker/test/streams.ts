/**
 * The server-sent events a provider streams an answer in, as strings: shared by
 * the Worker tests' fake of the providers (ai.ts) and the end-to-end tests' fake
 * (e2e/fake-ai.ts), which must agree on the formats.
 */

/** One Anthropic server-sent event. */
const anthropicEvent = (type: string, data: Record<string, unknown>) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

/** The token usage a fake provider reports for an answer. */
export interface ReportedUsage {
  input: number;
  output: number;
  /** Anthropic's prompt-cache tokens, reported only when given. */
  cacheCreation?: number;
  cacheRead?: number;
}

/** The usage the fakes report when a test sets none. */
export const DEFAULT_USAGE: ReportedUsage = { input: 1, output: 1 };

/** Anthropic's usage object for `u`: the input tokens, the cache tokens when given, and `output`. */
export function anthropicUsage(u: ReportedUsage, output = u.output): Record<string, number> {
  return {
    input_tokens: u.input,
    output_tokens: output,
    ...(u.cacheCreation !== undefined ? { cache_creation_input_tokens: u.cacheCreation } : {}),
    ...(u.cacheRead !== undefined ? { cache_read_input_tokens: u.cacheRead } : {}),
  };
}

/**
 * The events of a streamed Anthropic message holding `pieces` as text deltas:
 * the usage's input tokens in message_start, its output tokens in message_delta.
 */
export function anthropicStream(
  model: string,
  pieces: string[],
  refusal: boolean,
  hang: boolean,
  usage: ReportedUsage = DEFAULT_USAGE,
): string[] {
  const events = [
    anthropicEvent('message_start', {
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: anthropicUsage(usage, 0),
      },
    }),
    anthropicEvent('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    ...(refusal
      ? []
      : pieces.map((text) =>
          anthropicEvent('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }),
        )),
  ];
  if (hang) return events;
  return [
    ...events,
    anthropicEvent('content_block_stop', { index: 0 }),
    anthropicEvent('message_delta', {
      delta: { stop_reason: refusal ? 'refusal' : 'end_turn', stop_sequence: null },
      usage: { output_tokens: usage.output },
    }),
    anthropicEvent('message_stop', {}),
  ];
}

/**
 * The lines of a streamed OpenRouter chat completion holding `pieces` as
 * content deltas, and the usage in a last chunk with no choices, when given.
 */
export function openRouterStream(
  model: string,
  pieces: string[],
  refusal: boolean,
  hang: boolean,
  usage: ReportedUsage | null = DEFAULT_USAGE,
): string[] {
  const line = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({
      id: 'gen-1',
      object: 'chat.completion.chunk',
      created: 1_700_000_000,
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  const deltas = [
    ': OPENROUTER PROCESSING\n\n',
    ...(refusal ? [] : pieces.map((content) => line({ role: 'assistant', content }, null))),
  ];
  const usageLine = usage
    ? [
        `data: ${JSON.stringify({
          id: 'gen-1',
          object: 'chat.completion.chunk',
          created: 1_700_000_000,
          model,
          choices: [],
          usage: {
            prompt_tokens: usage.input,
            completion_tokens: usage.output,
            total_tokens: usage.input + usage.output,
          },
        })}\n\n`,
      ]
    : [];
  return hang
    ? deltas
    : [...deltas, line({}, refusal ? 'content_filter' : 'stop'), ...usageLine, 'data: [DONE]\n\n'];
}

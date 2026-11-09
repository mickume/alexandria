/**
 * The server-sent events a provider streams an answer in, as strings: shared by
 * the Worker tests' fake of the providers (ai.ts) and the end-to-end tests' fake
 * (e2e/fake-ai.ts), which must agree on the formats.
 */

/** One Anthropic server-sent event. */
const anthropicEvent = (type: string, data: Record<string, unknown>) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

/** The events of a streamed Anthropic message holding `pieces` as text deltas. */
export function anthropicStream(
  model: string,
  pieces: string[],
  refusal: boolean,
  hang: boolean,
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
        usage: { input_tokens: 1, output_tokens: 0 },
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
      usage: { output_tokens: 1 },
    }),
    anthropicEvent('message_stop', {}),
  ];
}

/** The lines of a streamed OpenRouter chat completion holding `pieces` as content deltas. */
export function openRouterStream(
  model: string,
  pieces: string[],
  refusal: boolean,
  hang: boolean,
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
  return hang
    ? deltas
    : [...deltas, line({}, refusal ? 'content_filter' : 'stop'), 'data: [DONE]\n\n'];
}

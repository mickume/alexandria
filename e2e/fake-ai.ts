/**
 * A local fake of the AI providers for the end-to-end tests: the Anthropic
 * Messages endpoint (POST /v1/messages) and OpenRouter's chat completions
 * (POST /openrouter/chat/completions). It accepts the Anthropic key
 * 'sk-ant-test-1234' and any OpenRouter key starting 'sk-or-', and answers an
 * enrichment with a fixed result that a test can switch.
 *
 * An enrichment whose request holds a registered marker is answered with that
 * marker's result instead (the last registered marker that matches wins).
 *
 * A streamed request (stream: true) is a question: it is answered with the text
 * of POST /__answer_text {text}, a word at a time, or with the error of
 * POST /__reject_answers {status, message} (no status clears it).
 *
 * A topic's split (a structured request whose schema asks for subtopics) is
 * answered with the sub-topics of POST /__split {subtopics}, the links the
 * request lists filed round-robin under them.
 *
 * Control: POST /__answer {summary, tags, topic}, POST /__answer_when
 * {contains, result}, POST /__split {subtopics}, POST /__answer_text,
 * POST /__reject_answers, GET /__log, GET /health.
 * Run with: node e2e/fake-ai.ts <port>
 */
import { createServer, type IncomingMessage } from 'node:http';
import { anthropicStream, openRouterStream } from '../src/worker/test/streams.ts';

const port = Number(process.argv[2] ?? 8792);

interface Result {
  summary: string;
  tags: string[];
  topic: string;
}

let answer: Result = {
  summary: 'The fake summary of the article.',
  tags: ['links', 'library', 'reading'],
  topic: 'Reading',
};

/** The answers for requests holding a marker, newest first. */
const answersWhen: { contains: string; result: Result }[] = [];

/** The answer to an enrichment request with this body. */
function answerFor(body: string): Result {
  return answersWhen.find((a) => body.includes(a.contains))?.result ?? answer;
}

/** The sub-topics a split is answered with. */
let splitInto: string[] = ['First', 'Second'];

/** Whether a request asks for a topic's split: its structured result has subtopics. */
function isSplit(parsed: Record<string, unknown>): boolean {
  const format = parsed.output_config as
    { format?: { schema?: { properties?: object } } } | undefined;
  const response = parsed.response_format as
    { json_schema?: { schema?: { properties?: object } } } | undefined;
  const properties =
    format?.format?.schema?.properties ?? response?.json_schema?.schema?.properties;
  return 'subtopics' in (properties ?? {});
}

/** The split of the links a request lists (one JSON object per line), round-robin. */
function splitFor(parsed: Record<string, unknown>) {
  const [message] = (parsed.messages as { content: string }[] | undefined) ?? [];
  const ids = (message?.content ?? '')
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => (JSON.parse(line) as { id: string }).id);
  return {
    subtopics: splitInto,
    links: ids.map((id, i) => ({ id, subtopic: splitInto[i % splitInto.length]! })),
  };
}

/** The structured answer to a request: a split or an enrichment. */
function structuredFor(parsed: Record<string, unknown>, body: string): string {
  return JSON.stringify(isSplit(parsed) ? splitFor(parsed) : answerFor(body));
}

/** Every provider request: when, which provider, its key header and its body. */
const log: {
  at: number;
  provider: string;
  auth: string;
  body: string;
  enrichment: boolean;
  ask: boolean;
}[] = [];

/** The text a question is answered with, streamed a word at a time. */
let answerText = 'Use a Durable Object alarm to schedule background work [1].';
/** The error every question is answered with, or null. */
let rejectAnswers: { status: number; message: string } | null = null;

/** The text split into the pieces of a stream: each word with the space after it. */
function pieces(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function keyOf(req: IncomingMessage): string {
  const header = req.headers['x-api-key'] ?? req.headers.authorization ?? '';
  return String(header).replace(/^Bearer\s+/i, '');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/health') return void res.end('ok');
  if (url.pathname === '/__log') return send(200, log);
  if (url.pathname === '/__answer' && req.method === 'POST') {
    answer = JSON.parse(await readBody(req)) as Result;
    return send(200, answer);
  }
  if (url.pathname === '/__split' && req.method === 'POST') {
    splitInto = (JSON.parse(await readBody(req)) as { subtopics: string[] }).subtopics;
    return send(200, { subtopics: splitInto });
  }
  if (url.pathname === '/__answer_when' && req.method === 'POST') {
    const rule = JSON.parse(await readBody(req)) as { contains: string; result: Result };
    answersWhen.unshift(rule);
    return send(200, rule);
  }

  if (url.pathname === '/__answer_text' && req.method === 'POST') {
    answerText = (JSON.parse(await readBody(req)) as { text: string }).text;
    return send(200, { text: answerText });
  }
  if (url.pathname === '/__reject_answers' && req.method === 'POST') {
    const rule = JSON.parse(await readBody(req)) as { status?: number; message?: string };
    rejectAnswers = rule.status
      ? { status: rule.status, message: rule.message ?? 'rejected' }
      : null;
    return send(200, { rejectAnswers });
  }

  const body = await readBody(req);
  const parsed = JSON.parse(body || '{}') as Record<string, unknown>;
  const key = keyOf(req);
  if (url.pathname === '/v1/messages') {
    const enrichment = 'output_config' in parsed || 'tools' in parsed;
    const ask = parsed.stream === true;
    log.push({ at: Date.now(), provider: 'anthropic', auth: key, body, enrichment, ask });
    if (key !== 'sk-ant-test-1234') {
      return send(401, {
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      });
    }
    if (ask && rejectAnswers) {
      return send(rejectAnswers.status, {
        type: 'error',
        error: { type: 'authentication_error', message: rejectAnswers.message },
      });
    }
    if (ask) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      return void res.end(
        anthropicStream(String(parsed.model), pieces(answerText), false, false).join(''),
      );
    }
    // As the real API answers for current models: no forced tool call.
    const forced = (parsed.tool_choice as { type?: string } | undefined)?.type;
    if (forced === 'tool' || forced === 'any') {
      return send(400, {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'tool_choice: type "tool" and "any" are not supported for this model.',
        },
      });
    }
    return send(200, {
      id: 'msg_fake',
      type: 'message',
      role: 'assistant',
      model: parsed.model,
      // Structured outputs answer with the JSON as text.
      content: [{ type: 'text', text: enrichment ? structuredFor(parsed, body) : 'ok' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  }
  if (url.pathname === '/openrouter/chat/completions') {
    const enrichment = 'response_format' in parsed;
    const ask = parsed.stream === true;
    log.push({ at: Date.now(), provider: 'openrouter', auth: key, body, enrichment, ask });
    if (!key.startsWith('sk-or-'))
      return send(401, { error: { code: 401, message: 'No auth credentials found' } });
    if (ask && rejectAnswers) {
      return send(rejectAnswers.status, {
        error: { code: rejectAnswers.status, message: rejectAnswers.message },
      });
    }
    if (ask) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      return void res.end(
        openRouterStream(String(parsed.model), pieces(answerText), false, false).join(''),
      );
    }
    return send(200, {
      id: 'gen-fake',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: parsed.model,
      system_fingerprint: null,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: enrichment ? structuredFor(parsed, body) : 'ok',
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }
  send(404, { error: { message: 'not found' } });
});

server.listen(port, () => {
  console.log(`fake AI listening on http://localhost:${port}`);
});

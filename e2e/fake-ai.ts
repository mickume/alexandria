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
 * Control: POST /__answer {summary, tags, topic}, POST /__answer_when
 * {contains, result}, GET /__log, GET /health.
 * Run with: node e2e/fake-ai.ts <port>
 */
import { createServer, type IncomingMessage } from 'node:http';

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

/** Every provider request: when, which provider, its key header and its body. */
const log: { at: number; provider: string; auth: string; body: string; enrichment: boolean }[] = [];

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
  if (url.pathname === '/__answer_when' && req.method === 'POST') {
    const rule = JSON.parse(await readBody(req)) as { contains: string; result: Result };
    answersWhen.unshift(rule);
    return send(200, rule);
  }

  const body = await readBody(req);
  const parsed = JSON.parse(body || '{}') as Record<string, unknown>;
  const key = keyOf(req);
  if (url.pathname === '/v1/messages') {
    const enrichment = 'tools' in parsed;
    log.push({ at: Date.now(), provider: 'anthropic', auth: key, body, enrichment });
    if (key !== 'sk-ant-test-1234') {
      return send(401, {
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      });
    }
    return send(200, {
      id: 'msg_fake',
      type: 'message',
      role: 'assistant',
      model: parsed.model,
      content: enrichment
        ? [
            {
              type: 'tool_use',
              id: 'toolu_fake',
              name: 'record_enrichment',
              input: answerFor(body),
            },
          ]
        : [{ type: 'text', text: 'ok' }],
      stop_reason: enrichment ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  }
  if (url.pathname === '/openrouter/chat/completions') {
    const enrichment = 'response_format' in parsed;
    log.push({ at: Date.now(), provider: 'openrouter', auth: key, body, enrichment });
    if (!key.startsWith('sk-or-'))
      return send(401, { error: { code: 401, message: 'No auth credentials found' } });
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
            content: enrichment ? JSON.stringify(answerFor(body)) : 'ok',
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

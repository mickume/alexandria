/**
 * A local fake of Workers AI and Vectorize for the end-to-end tests, which the
 * Worker reaches through MEANING_FAKE_URL instead of its AI and VECTORIZE
 * bindings. It embeds with the deterministic embedder the Worker tests use
 * (src/worker/test/embedder.ts) and keeps vectors in memory by namespace.
 *
 * POST /embed {texts} -> {vectors}, POST /upsert {namespace, vectors},
 * POST /query {namespace, vector, topK} -> {matches}, POST /delete {ids};
 * control: GET /__vectors?namespace= lists {id, namespace}, POST /__fail makes
 * /embed and /query answer 503 until POST /__recover, GET /health.
 * Run with: node e2e/fake-meaning.ts <port>
 */
import { createServer, type IncomingMessage } from 'node:http';
import { embedText, VectorIndex } from '../src/worker/test/embedder.ts';

const port = Number(process.argv[2] ?? 8793);
const index = new VectorIndex();
/** Whether embedding and querying fail, as when Workers AI is unreachable. */
let failing = false;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/health') return void res.end('ok');
  if (url.pathname === '/__vectors') {
    const namespace = url.searchParams.get('namespace') ?? undefined;
    return send(
      200,
      index.all(namespace).map(({ id, namespace: ns }) => ({ id, namespace: ns })),
    );
  }
  if (req.method !== 'POST') return send(404, { error: 'not found' });
  if (url.pathname === '/__fail' || url.pathname === '/__recover') {
    failing = url.pathname === '/__fail';
    return send(200, { failing });
  }
  if (failing && (url.pathname === '/embed' || url.pathname === '/query')) {
    return send(503, { error: 'unavailable' });
  }
  readJson(req)
    .then((body) => {
      if (url.pathname === '/embed') {
        return send(200, { vectors: (body.texts as string[]).map(embedText) });
      }
      if (url.pathname === '/upsert') {
        const vectors = body.vectors as { id: string; values: number[] }[];
        index.upsert(vectors.map((v) => ({ ...v, namespace: body.namespace as string })));
        return send(200, {});
      }
      if (url.pathname === '/query') {
        const matches = index
          .query(body.namespace as string, body.vector as number[], body.topK as number)
          .map(({ id, score }) => ({ id, score }));
        return send(200, { matches });
      }
      if (url.pathname === '/delete') {
        index.deleteByIds(body.ids as string[]);
        return send(200, {});
      }
      send(404, { error: 'not found' });
    })
    .catch(() => send(400, { error: 'bad request' }));
});

server.listen(port, () => {
  console.log(`fake search by meaning listening on http://localhost:${port}`);
});

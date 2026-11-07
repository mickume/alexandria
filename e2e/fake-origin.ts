/**
 * A local fake of the origin sites links point at, for the end-to-end tests.
 * The Worker's fetcher sends every request here (ORIGIN_PROXY_URL) with the
 * real target in X-Alexandria-Target. It serves an article at
 * https://news.example/article and a PDF titled 'On Links' at
 * https://papers.example/on-links.pdf, logs every request, and can be taken
 * offline, after which it refuses every connection.
 *
 * Control: POST /__offline, POST /__online, GET /__log (JSON), GET /health.
 * Run with: node e2e/fake-origin.ts <port>
 */
import { createServer } from 'node:http';
import { paperPdf } from '../src/worker/fetcher/fixtures/pdfs.ts';

const port = Number(process.argv[2] ?? 8791);

/** The headline and first paragraph the e2e tests look for. */
export const ARTICLE_TITLE = 'An Article';
const FIRST_PARAGRAPH =
  'This is the first paragraph of the article, long enough to be kept as the reader view of it.';

const article = `<!doctype html>
<html lang="en">
<head><title>${ARTICLE_TITLE}</title><meta name="description" content="A fixture article."></head>
<body>
  <nav>Home · About</nav>
  <article>
    <h1>${ARTICLE_TITLE}</h1>
    <p>${FIRST_PARAGRAPH}</p>
    <p>${'A second paragraph follows with more words about links and why they are kept. '.repeat(6)}</p>
  </article>
  <footer>Footer</footer>
</body>
</html>`;

const pages: Record<string, { type: string; body: string | Uint8Array }> = {
  'https://news.example/article': { type: 'text/html; charset=utf-8', body: article },
  'https://papers.example/on-links.pdf': { type: 'application/pdf', body: paperPdf('On Links') },
};

const log: { target: string; at: number }[] = [];
let offline = false;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  if (url.pathname === '/health') return void res.end('ok');
  if (url.pathname === '/__offline') {
    offline = true;
    return void res.end('offline');
  }
  if (url.pathname === '/__online') {
    offline = false;
    return void res.end('online');
  }
  if (url.pathname === '/__log') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return void res.end(JSON.stringify(log));
  }
  const target = req.headers['x-alexandria-target'];
  if (typeof target !== 'string') {
    res.writeHead(400);
    return void res.end('no target');
  }
  log.push({ target, at: Date.now() });
  if (offline) return void req.socket.destroy();
  const page = pages[target];
  if (!page) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return void res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': page.type });
  res.end(page.body);
});

server.listen(port, () => {
  console.log(`fake origin listening on http://localhost:${port}`);
});

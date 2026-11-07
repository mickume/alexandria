/**
 * A local fake of the origin sites links point at, for the end-to-end tests.
 * The Worker's fetcher sends every request here (ORIGIN_PROXY_URL) with the
 * real target in X-Alexandria-Target. It serves an article at
 * https://news.example/article and a PDF titled 'On Links' at
 * https://papers.example/on-links.pdf, a page about Cloudflare Queues at
 * https://docs.example/queues and one about Apache Kafka at
 * https://blog.example/kafka, two more about queues and one about gardening at
 * https://guides.example/, a paper at https://example.net/paper, and at
 * https://code.example/<slug> a page whose
 * text holds 'marker-<slug>'. It logs every request, and can be taken
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

/** A page with one article: its title as headline, then `text` and filler paragraphs. */
function articlePage(title: string, text: string): string {
  return `<!doctype html>
<html lang="en">
<head><title>${title}</title></head>
<body>
  <article>
    <h1>${title}</h1>
    <p>${text}</p>
    <p>${'More paragraphs follow so that the reader view keeps the article whole. '.repeat(6)}</p>
  </article>
</body>
</html>`;
}

const HTML = 'text/html; charset=utf-8';

const pages: Record<string, { type: string; body: string | Uint8Array }> = {
  'https://news.example/article': { type: HTML, body: article },
  'https://docs.example/queues': {
    type: HTML,
    body: articlePage(
      'Cloudflare Queues explained',
      'Cloudflare Queues deliver messages between Workers with guaranteed delivery and batching.',
    ),
  },
  'https://guides.example/queues-intro': {
    type: HTML,
    body: articlePage(
      'Getting started with queues',
      'Cloudflare Queues let one Worker hand messages to another, retried until they are consumed.',
    ),
  },
  'https://guides.example/queues-batching': {
    type: HTML,
    body: articlePage(
      'Batching messages',
      'Cloudflare Queues deliver messages to a consumer in batches, which keeps each run efficient.',
    ),
  },
  'https://guides.example/gardening': {
    type: HTML,
    body: articlePage('Tomatoes in pots', 'Tomatoes grow well in pots on a sunny balcony.'),
  },
  'https://example.net/paper': {
    type: HTML,
    body: articlePage('A paper', 'An abstract and a long argument about something worth reading.'),
  },
  'https://blog.example/kafka': {
    type: HTML,
    body: articlePage(
      'Apache Kafka in practice',
      'Apache Kafka keeps an ordered log of records that consumers read at their own pace.',
    ),
  },
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
  // Every page under https://news.example/ is the article.
  const code = /^https:\/\/code\.example\/([\w-]+)$/.exec(target);
  const page =
    pages[target] ??
    (code
      ? {
          type: HTML,
          body: articlePage(`Code ${code[1]}`, `A page about code, marker-${code[1]}, to enrich.`),
        }
      : undefined) ??
    (target.startsWith('https://news.example/')
      ? pages['https://news.example/article']
      : undefined);
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

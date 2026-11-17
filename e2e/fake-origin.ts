/**
 * A local fake of the origin sites links point at, for the end-to-end tests.
 * The Worker's fetcher sends every request here (ORIGIN_PROXY_URL) with the
 * real target in X-Alexandria-Target. It serves an article at
 * https://news.example/article and a PDF titled 'On Links' at
 * https://papers.example/on-links.pdf, a page about Cloudflare Queues at
 * https://docs.example/queues and one about Apache Kafka at
 * https://blog.example/kafka, two more about queues and one about gardening at
 * https://guides.example/, three pages about Durable Object alarms at
 * https://example.com/, a paper at https://example.net/paper, two pages each
 * at https://leaving.example/ and https://backup.example/, and at
 * https://code.example/<slug> a page whose
 * text holds 'marker-<slug>', and at https://illustrated.example/article an
 * article with three images: two served (one on its own host, one on
 * https://img.example/) and one that answers 404. It logs every request, and can be taken
 * offline, after which it refuses every connection. POST /__page sets the
 * page one address serves, so a test can change it between two fetches.
 *
 * It also fakes the two APIs the retrievers ask (GITHUB_API_URL and
 * YOUTUBE_API_URL point here): GitHub's at /__github, which knows the
 * repository acme/widget, its README holding the word 'frobnicator', and
 * answers 503 for everything while it is down; and YouTube's at /__youtube,
 * which knows the video dQw4w9WgXcQ. https://github.com/acme/fallback is a
 * GitHub page for a repository its API does not know.
 *
 * Control: POST /__offline, POST /__online, POST /__page ({url, title, text}),
 * POST /__github/down, POST /__github/up, GET /__log (JSON), GET /health.
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

/** A PNG of one red pixel, which a browser draws. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

/** The headline and first paragraph of the illustrated article. */
export const ILLUSTRATED_TITLE = 'An Illustrated Article';
const illustrated = `<!doctype html>
<html lang="en">
<head><title>${ILLUSTRATED_TITLE}</title></head>
<body>
  <nav>Home · About</nav>
  <article>
    <h1>${ILLUSTRATED_TITLE}</h1>
    <p>The first paragraph of the illustrated article explains what the figures below show.</p>
    <figure><img src="/img/one.png" alt="Figure one"><figcaption>The first figure.</figcaption></figure>
    <p>${'A paragraph between the figures, so that the article reads as one. '.repeat(4)}</p>
    <figure><img src="https://img.example/two.png" alt="Figure two"></figure>
    <figure><img src="https://img.example/missing.png" alt="Figure three"></figure>
    <p>${'A closing paragraph with more words about the figures and what they mean. '.repeat(4)}</p>
  </article>
  <aside>Sidebar</aside>
</body>
</html>`;

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
  'https://example.com/durable-object-alarms': {
    type: HTML,
    body: articlePage(
      'Durable Object alarms',
      'An alarm lets a Durable Object schedule a task to run later on Cloudflare, in the background, without a cron trigger.',
    ),
  },
  // Shares no word with the question 'run a task later on cloudflare', so that only
  // its meaning can find it.
  'https://example.com/alarm-timers': {
    type: HTML,
    body: articlePage(
      'Alarm timers',
      'Alarms in Durable Objects schedule background work with a timer, like a cron trigger.',
    ),
  },
  'https://example.com/alarms-for-agents': {
    type: HTML,
    body: articlePage(
      'Alarms for agents',
      'A Durable Object alarm schedules background work on Cloudflare: set the alarm and the object runs the task at that time.',
    ),
  },
  'https://example.net/paper': {
    type: HTML,
    body: articlePage('A paper', 'An abstract and a long argument about something worth reading.'),
  },
  'https://leaving.example/one': {
    type: HTML,
    body: articlePage('Leaving one', 'A page the owner kept before leaving the library.'),
  },
  'https://leaving.example/two': {
    type: HTML,
    body: articlePage('Leaving two', 'Another page the owner kept before leaving the library.'),
  },
  'https://backup.example/one': {
    type: HTML,
    body: articlePage('Backup one', 'The first page of the library that the owner backs up.'),
  },
  'https://backup.example/two': {
    type: HTML,
    body: articlePage('Backup two', 'The second page of the library that the owner backs up.'),
  },
  'https://blog.example/kafka': {
    type: HTML,
    body: articlePage(
      'Apache Kafka in practice',
      'Apache Kafka keeps an ordered log of records that consumers read at their own pace.',
    ),
  },
  'https://papers.example/on-links.pdf': { type: 'application/pdf', body: paperPdf('On Links') },
  'https://illustrated.example/article': { type: HTML, body: illustrated },
  'https://github.com/acme/fallback': {
    type: HTML,
    body: articlePage(
      'GitHub - acme/fallback: From the page · GitHub',
      'A repository page that the fake GitHub API does not know, fetched as a page.',
    ),
  },
  'https://illustrated.example/img/one.png': { type: 'image/png', body: PIXEL },
  'https://img.example/two.png': { type: 'image/png', body: PIXEL },
};

const log: { target: string; at: number }[] = [];
let offline = false;
let githubDown = false;

/** The fake GitHub API's answers, by path under /__github. */
const github: Record<string, { type: string; body: string }> = {
  '/repos/acme/widget': {
    type: 'application/json',
    body: JSON.stringify({
      name: 'widget',
      full_name: 'acme/widget',
      owner: { login: 'acme' },
      description: 'Widgets for everyone',
      stargazers_count: 12345,
      language: 'TypeScript',
      topics: ['widgets'],
      license: { spdx_id: 'MIT' },
      archived: false,
      pushed_at: '2026-10-01T12:00:00Z',
      html_url: 'https://github.com/acme/widget',
    }),
  },
  '/repos/acme/widget/readme': {
    type: 'text/plain',
    body: '# Widget\n\nWidgets are assembled from a frobnicator and two sprockets.',
  },
};

/** The fake YouTube Data API's videos, by id. */
const videos: Record<string, unknown> = {
  dQw4w9WgXcQ: {
    snippet: {
      title: 'A Fixture Video',
      description: 'A video about fixtures, described at length by its channel.',
      channelTitle: 'Fixture Channel',
      publishedAt: '2026-01-02T03:04:05Z',
      thumbnails: { high: { url: `http://localhost:${port}/__thumbnail.png` } },
    },
    contentDetails: { duration: 'PT12M34S' },
  },
};

/** Answers a request to the fake GitHub or YouTube API; false when it is for neither. */
function answerApi(url: URL, res: import('node:http').ServerResponse): boolean {
  if (url.pathname.startsWith('/__github/')) {
    const path = url.pathname.slice('/__github'.length);
    const answer = github[path];
    if (githubDown) res.writeHead(503).end('down');
    else if (!answer) res.writeHead(404, { 'Content-Type': 'application/json' }).end('{}');
    else res.writeHead(200, { 'Content-Type': answer.type }).end(answer.body);
    return true;
  }
  if (url.pathname === '/__youtube/videos') {
    const video = videos[url.searchParams.get('id') ?? ''];
    res
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ items: video ? [video] : [] }));
    return true;
  }
  if (url.pathname === '/__thumbnail.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' }).end(PIXEL);
    return true;
  }
  return false;
}

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
  if (url.pathname === '/__page') {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      const set = JSON.parse(body) as { url: string; title: string; text: string };
      pages[set.url] = { type: HTML, body: articlePage(set.title, set.text) };
      res.end('set');
    });
    return;
  }
  if (url.pathname === '/__github/down' || url.pathname === '/__github/up') {
    githubDown = url.pathname.endsWith('down');
    return void res.end(githubDown ? 'down' : 'up');
  }
  if (answerApi(url, res)) return;
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

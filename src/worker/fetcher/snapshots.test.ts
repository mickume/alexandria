import { describe, expect, it } from 'vitest';
import { FakeOrigin } from '../test/origin';
import {
  addAndFetch,
  api,
  count,
  env,
  recordFetchQueue,
  seedLinks,
  setNow,
  signIn,
  type TestUser,
} from '../test/helpers';
import { blogArticle } from './fixtures/pages';
import { PAPER_FIRST_SENTENCE, paperPdf } from './fixtures/pdfs';

const ARTICLE_URL = 'https://news.example/keep';
const PDF_URL = 'https://papers.example/on-links.pdf';

async function useCount(user: TestUser, id: string): Promise<number> {
  return (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json.use_count;
}

async function fetchedArticle(user: TestUser) {
  const origin = new FakeOrigin().page(ARTICLE_URL, blogArticle);
  return { origin, ...(await addAndFetch(user, ARTICLE_URL)) };
}

async function fetchedPdf(user: TestUser) {
  const pdf = paperPdf('On Links');
  new FakeOrigin().page(PDF_URL, pdf, 'application/pdf');
  return { pdf, ...(await addAndFetch(user, PDF_URL)) };
}

describe('reading a link', () => {
  it.each(['article', 'pdf'] as const)('records a use and returns the stored %s', async (kind) => {
    const user = await signIn();
    const { id } = kind === 'article' ? await fetchedArticle(user) : await fetchedPdf(user);
    const t = '2026-10-01T09:00:00.000Z';
    setNow(t);
    const r = await api('GET', `/api/v1/links/${id}/reader`, { as: user.session });
    expect(r.status).toBe(200);
    if (kind === 'article') {
      expect(r.json).toMatchObject({
        content_kind: 'html',
        title: 'Why We Keep Links',
        empty: false,
      });
      expect(r.json.byline).toContain('Ada Writer');
      expect(r.json.html).toContain('The first reason');
      expect(r.json.text).toContain('The first reason');
    } else {
      expect(r.json).toMatchObject({
        content_kind: 'pdf',
        title: 'On Links',
        html: null,
        empty: false,
      });
      expect(r.json.text.startsWith(PAPER_FIRST_SENTENCE)).toBe(true);
    }
    const link = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
    expect(link.use_count).toBe(1);
    expect(link.last_used_at).toBe(t);
  });

  it('offers an empty view, and still the snapshot, when too little text was extracted', async () => {
    const user = await signIn();
    new FakeOrigin().page(
      'https://thin.example/',
      '<html><head><title>Thin</title></head><body><p>Hi</p></body></html>',
    );
    const { id } = await addAndFetch(user, 'https://thin.example/');
    const r = await api('GET', `/api/v1/links/${id}/reader`, { as: user.session });
    expect(r.json).toMatchObject({ empty: true, html: null, text: '' });
    expect((await api('GET', `/api/v1/links/${id}/snapshot`, { as: user.session })).status).toBe(
      200,
    );
  });
});

describe('a link’s snapshot', () => {
  it('is the stored HTML, with headers that keep its scripts from running', async () => {
    const user = await signIn();
    const { id } = await fetchedArticle(user);
    const r = await api('GET', `/api/v1/links/${id}/snapshot`, { as: user.session });
    expect(r.status).toBe(200);
    expect(await r.response.text()).toBe(blogArticle);
    expect(r.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(r.headers.get('Content-Security-Policy')).toBe(
      "sandbox; default-src 'none'; img-src * data:; style-src * 'unsafe-inline'; font-src * data:",
    );
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(await useCount(user, id)).toBe(1);
  });

  it.each([
    { query: '', disposition: 'inline; filename="On Links.pdf"' },
    { query: '?download=1', disposition: 'attachment; filename="On Links.pdf"' },
  ])('is the stored PDF, $disposition', async ({ query, disposition }) => {
    const user = await signIn();
    const { id, pdf } = await fetchedPdf(user);
    const r = await api('GET', `/api/v1/links/${id}/snapshot${query}`, { as: user.session });
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('application/pdf');
    expect(r.headers.get('Content-Disposition')).toBe(disposition);
    expect(new Uint8Array(await r.response.arrayBuffer())).toEqual(pdf);
    expect(await useCount(user, id)).toBe(1);
  });

  it.each([
    { label: 'a pending link never fetched', setup: 'pending' },
    { label: 'an unreachable link', setup: 'unreachable' },
    { label: 'a link that is not a web page', setup: 'image' },
    { label: 'a PDF too large to store', setup: 'huge' },
  ])('is not there for $label, and no use is recorded', async ({ setup }) => {
    const user = await signIn();
    let id: string;
    if (setup === 'pending' || setup === 'unreachable') {
      [id = ''] = await seedLinks(user, [{ url: 'https://none.example/', state: setup }]);
    } else if (setup === 'image') {
      new FakeOrigin().page('https://img.example/cat.png', 'png', 'image/png');
      ({ id } = await addAndFetch(user, 'https://img.example/cat.png'));
    } else {
      new FakeOrigin().stream(
        'https://papers.example/huge.pdf',
        51 * 1024 * 1024,
        'application/pdf',
        {
          contentLength: true,
        },
      );
      ({ id } = await addAndFetch(user, 'https://papers.example/huge.pdf'));
    }
    for (const view of ['reader', 'snapshot']) {
      const r = await api('GET', `/api/v1/links/${id}/${view}`, { as: user.session });
      expect(r.status).toBe(404);
      expect(r.json).toEqual({ error: 'no_snapshot', message: 'no snapshot stored for this link' });
    }
    expect(await useCount(user, id)).toBe(0);
  });

  it('is served from storage alone, even when the origin is offline', async () => {
    const user = await signIn();
    const { id, origin } = await fetchedArticle(user);
    origin.goOffline();
    origin.clearLog();
    expect((await api('GET', `/api/v1/links/${id}/reader`, { as: user.session })).status).toBe(200);
    const snapshot = await api('GET', `/api/v1/links/${id}/snapshot`, { as: user.session });
    expect(snapshot.status).toBe(200);
    expect(await snapshot.response.text()).toBe(blogArticle);
    expect(origin.log).toEqual([]);
  });
});

describe('another user’s link', () => {
  it('is answered as one that does not exist, with no use recorded and nothing fetched', async () => {
    const owner = await signIn('b@example.test', 'B');
    const { id } = await fetchedArticle(owner);
    const other = await signIn('a@example.test', 'A');
    const sent = recordFetchQueue();
    for (const [method, path] of [
      ['GET', 'reader'],
      ['GET', 'snapshot'],
      ['GET', 'snapshot?download=1'],
      ['POST', 'refresh'],
    ] as const) {
      const r = await api(method, `/api/v1/links/${id}/${path}`, { as: other.session });
      expect(r.status).toBe(404);
      expect(r.json).toEqual({ error: 'not_found' });
    }
    expect(await useCount(owner, id)).toBe(0);
    expect(sent).toEqual([]);
  });
});

describe('deleting a fetched link', () => {
  it.each(['article', 'pdf'] as const)(
    'deletes the stored %s, its text and its events',
    async (kind) => {
      const user = await signIn();
      const { id, prefix } =
        kind === 'article' ? await fetchedArticle(user) : await fetchedPdf(user);
      expect((await env.SNAPSHOTS.list({ prefix })).objects.length).toBeGreaterThan(0);
      const r = await api('DELETE', `/api/v1/links/${id}`, { as: user.session });
      expect(r.status).toBe(204);
      expect((await env.SNAPSHOTS.list({ prefix })).objects).toEqual([]);
      expect(await count('link_texts', 'link_id = ?', id)).toBe(0);
      expect(await count('link_events', 'link_id = ?', id)).toBe(0);
    },
  );
});

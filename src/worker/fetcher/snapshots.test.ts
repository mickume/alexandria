import { describe, expect, it } from 'vitest';
import { FakeOrigin } from '../test/origin';
import {
  addAndFetch,
  api,
  count,
  deliverFetches,
  env,
  recordFetchQueue,
  seedLinks,
  setNow,
  signIn,
  type TestUser,
} from '../test/helpers';
import { blogArticle, illustratedArticle } from './fixtures/pages';
import { paperPdf } from './fixtures/pdfs';

const ARTICLE_URL = 'https://news.example/keep';
const PDF_URL = 'https://papers.example/on-links.pdf';
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const JPEG = new Uint8Array([255, 216, 255, 224, 4, 5, 6]);
const T = Date.parse('2026-10-01T09:00:00.000Z');

async function linkOf(user: TestUser, id: string) {
  return (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
}

/** An article on news.example with a PNG on its own host and a JPEG on a CDN. */
function illustratedOrigin(page = illustratedArticle(['/img/a.png', 'https://cdn.example/b.jpg'])) {
  return new FakeOrigin()
    .page(ARTICLE_URL, page)
    .page('https://news.example/img/a.png', PNG, 'image/png')
    .page('https://cdn.example/b.jpg', JPEG, 'image/jpeg');
}

/** Asks for a snapshot of the link and delivers the fetch it queues. */
async function takeSnapshot(user: TestUser, id: string) {
  const sent = recordFetchQueue();
  const r = await api('POST', `/api/v1/links/${id}/snapshot`, { as: user.session });
  const delivery = await deliverFetches(sent.map((m) => m.body));
  return { r, sent, delivery };
}

/** Adds and fetches the article, then takes its snapshot. */
async function snapshotted(user: TestUser) {
  const origin = illustratedOrigin();
  const { id, prefix } = await addAndFetch(user, ARTICLE_URL);
  setNow(T);
  await takeSnapshot(user, id);
  return { id, prefix, origin };
}

/** The addresses of the images in a snapshot's article. */
function imageAddresses(html: string): string[] {
  return [...html.matchAll(/<img[^>]* src="([^"]+)"/g)].map((m) => m[1]!);
}

async function objectsUnder(prefix: string): Promise<string[]> {
  return (await env.SNAPSHOTS.list({ prefix })).objects.map((o) => o.key).sort();
}

async function snapshotEvents(id: string) {
  const rows = await env.DB.prepare(
    "SELECT outcome, reason FROM link_events WHERE link_id = ? AND kind = 'snapshot' ORDER BY id",
  )
    .bind(id)
    .all<{ outcome: string; reason: string | null }>();
  return rows.results;
}

describe('asking for a snapshot', { timeout: 30_000 }, () => {
  it('queues a fetch that takes one, at once', async () => {
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: ARTICLE_URL, state: 'active' }]);
    const sent = recordFetchQueue();
    setNow(T);
    const r = await api('POST', `/api/v1/links/${id}/snapshot`, { as: user.session });
    expect([r.status, r.json]).toEqual([202, { status: 'queued' }]);
    expect(sent).toEqual([
      {
        body: { user_id: user.id, link_id: id, refresh: true, snapshot: true },
        delaySeconds: undefined,
      },
    ]);
    expect(await linkOf(user, id)).toMatchObject({
      snapshot_requested_at: new Date(T).toISOString(),
      has_snapshot: false,
    });
  });

  it('is refused within 10 minutes of the last one, whatever refreshes do', async () => {
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: ARTICLE_URL, state: 'active' }]);
    const sent = recordFetchQueue();
    setNow(T);
    expect((await api('POST', `/api/v1/links/${id}/refresh`, { as: user.session })).status).toBe(
      202,
    );
    expect((await api('POST', `/api/v1/links/${id}/snapshot`, { as: user.session })).status).toBe(
      202,
    );
    setNow(T + 4 * 60_000);
    const r = await api('POST', `/api/v1/links/${id}/snapshot`, { as: user.session });
    expect(r.status).toBe(429);
    expect(r.json).toEqual({ error: 'snapshot_recent', message: 'a snapshot was taken recently' });
    expect(r.headers.get('Retry-After')).toBe('360');
    expect(sent).toHaveLength(2);
    setNow(T + 10 * 60_000);
    expect((await api('POST', `/api/v1/links/${id}/snapshot`, { as: user.session })).status).toBe(
      202,
    );
  });

  it('answers 503 and gives the window back when the fetch cannot be queued', async () => {
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: ARTICLE_URL, state: 'active' }]);
    env.FETCH_QUEUE = {
      send: () => Promise.reject(new Error('the queue is down')),
    } as unknown as typeof env.FETCH_QUEUE;
    const r = await api('POST', `/api/v1/links/${id}/snapshot`, { as: user.session });
    expect([r.status, r.json]).toEqual([
      503,
      { error: 'unavailable', message: 'the snapshot could not be queued' },
    ]);
    expect((await linkOf(user, id)).snapshot_requested_at).toBeNull();
    recordFetchQueue();
    expect((await api('POST', `/api/v1/links/${id}/snapshot`, { as: user.session })).status).toBe(
      202,
    );
  });

  it('shows a snapshot as being taken for 15 minutes at most', async () => {
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: ARTICLE_URL, state: 'active' }]);
    recordFetchQueue();
    setNow(T);
    await api('POST', `/api/v1/links/${id}/snapshot`, { as: user.session });
    setNow(T + 15 * 60_000 + 1);
    expect((await linkOf(user, id)).snapshot_requested_at).toBeNull();
  });
});

describe('taking a snapshot of a web page', { timeout: 30_000 }, () => {
  it('stores the article with its images, served with nothing from the origin', async () => {
    const user = await signIn();
    const { id, origin } = await snapshotted(user);
    expect(await linkOf(user, id)).toMatchObject({
      has_snapshot: true,
      snapshot_kind: 'html',
      snapshot_at: new Date(T).toISOString(),
      snapshot_requested_at: null,
      snapshot_error: null,
    });
    expect(await snapshotEvents(id)).toEqual([{ outcome: 'ok', reason: null }]);
    origin.goOffline();
    origin.clearLog();
    const r = await api('GET', `/api/v1/links/${id}/snapshot`, { as: user.session });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      content_kind: 'html',
      title: 'Why We Keep Links',
      taken_at: new Date(T).toISOString(),
      notes: [],
    });
    expect(r.json.byline).toContain('Ada Writer');
    expect(r.json.html).toContain('The first reason');
    expect(r.json.html).not.toContain('SIDEBAR-ONLY-TEXT');
    const addresses = imageAddresses(r.json.html);
    expect(addresses).toHaveLength(2);
    const images = [];
    for (const address of addresses) {
      expect(address.startsWith(`/api/v1/links/${id}/snapshot/images/`)).toBe(true);
      const image = await api('GET', address, { as: user.session });
      images.push({
        status: image.status,
        type: image.headers.get('Content-Type'),
        cache: image.headers.get('Cache-Control'),
        bytes: new Uint8Array(await image.response.arrayBuffer()),
      });
    }
    expect(images).toEqual([
      { status: 200, type: 'image/png', cache: 'private, max-age=31536000, immutable', bytes: PNG },
      {
        status: 200,
        type: 'image/jpeg',
        cache: 'private, max-age=31536000, immutable',
        bytes: JPEG,
      },
    ]);
    expect(origin.log).toEqual([]);
    expect((await linkOf(user, id)).use_count).toBe(1);
  });

  it('refreshes the link as it takes the snapshot', async () => {
    const origin = new FakeOrigin().page(ARTICLE_URL, blogArticle);
    const user = await signIn();
    const { id } = await addAndFetch(user, ARTICLE_URL);
    origin.page(ARTICLE_URL, blogArticle.replace(/Why We Keep Links/g, 'Why We Still Keep Links'));
    setNow(T);
    await takeSnapshot(user, id);
    const link = await linkOf(user, id);
    expect(link).toMatchObject({ fetched_at: new Date(T).toISOString(), has_snapshot: true });
    expect(link.title).toContain('Why We Still Keep Links');
  });

  it('puts a placeholder with the alt text and the address for an image it cannot save', async () => {
    const page = illustratedArticle(['/img/a.png', '/img/missing.png', '/img/page.html']);
    new FakeOrigin()
      .page(ARTICLE_URL, page)
      .page('https://news.example/img/a.png', PNG, 'image/png')
      .status('https://news.example/img/missing.png', 404)
      .page('https://news.example/img/page.html', '<p>not an image</p>');
    const user = await signIn();
    const { id } = await addAndFetch(user, ARTICLE_URL);
    await takeSnapshot(user, id);
    const r = await api('GET', `/api/v1/links/${id}/snapshot`, { as: user.session });
    expect(r.json.notes).toEqual(['2 images could not be saved']);
    expect(imageAddresses(r.json.html)).toHaveLength(1);
    expect(r.json.html).toContain(
      '<span class="missing-image">Figure 2 (<a href="https://news.example/img/missing.png">original image</a>)</span>',
    );
    expect(r.json.html).toContain('Figure 3 (<a href="https://news.example/img/page.html">');
  });

  it('does not store an image over 10 MB', async () => {
    new FakeOrigin()
      .page(ARTICLE_URL, illustratedArticle(['/img/huge.png']))
      .stream('https://news.example/img/huge.png', 11 * 1024 * 1024, 'image/png', {
        contentLength: true,
      });
    const user = await signIn();
    const { id, prefix } = await addAndFetch(user, ARTICLE_URL);
    await takeSnapshot(user, id);
    const r = await api('GET', `/api/v1/links/${id}/snapshot`, { as: user.session });
    expect(r.json.notes).toEqual(['1 images could not be saved']);
    expect((await objectsUnder(prefix)).filter((k) => k.includes('/img/'))).toEqual([]);
  });

  it('serves an SVG image under a policy that keeps its scripts from running', async () => {
    new FakeOrigin()
      .page(ARTICLE_URL, illustratedArticle(['/img/chart.svg']))
      .page(
        'https://news.example/img/chart.svg',
        '<svg xmlns="http://www.w3.org/2000/svg"/>',
        'image/svg+xml',
      );
    const user = await signIn();
    const { id } = await addAndFetch(user, ARTICLE_URL);
    await takeSnapshot(user, id);
    const r = await api('GET', `/api/v1/links/${id}/snapshot`, { as: user.session });
    const [address = ''] = imageAddresses(r.json.html);
    const image = await api('GET', address, { as: user.session });
    expect(image.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(image.headers.get('Content-Security-Policy')).toBe(
      "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    );
  });

  it('replaces the previous snapshot, under new image addresses', async () => {
    const user = await signIn();
    const { id, prefix } = await snapshotted(user);
    const first = (await api('GET', `/api/v1/links/${id}/snapshot`, { as: user.session })).json;
    illustratedOrigin(
      illustratedArticle(['/img/a.png']).replace('The first reason', 'A newer reason'),
    );
    setNow(T + 10 * 60_000);
    await takeSnapshot(user, id);
    const second = (await api('GET', `/api/v1/links/${id}/snapshot`, { as: user.session })).json;
    expect(second.html).toContain('A newer reason');
    const [address = ''] = imageAddresses(second.html);
    expect(imageAddresses(first.html)).not.toContain(address);
    for (const old of imageAddresses(first.html)) {
      expect((await api('GET', old, { as: user.session })).status).toBe(404);
    }
    const objects = await objectsUnder(prefix);
    expect(objects).toHaveLength(2);
    expect(new Set(objects.map((k) => k.split('/')[5])).size).toBe(1);
  });
});

describe('a snapshot that fails', { timeout: 30_000 }, () => {
  it.each([
    {
      label: 'a page that cannot be fetched',
      serve: (o: FakeOrigin) => o.status(ARTICLE_URL, 500),
      reason: 'HTTP 500',
    },
    {
      label: 'a page without an article',
      serve: (o: FakeOrigin) =>
        o.page(ARTICLE_URL, '<html><head><title>Thin</title></head><body><p>Hi</p></body></html>'),
      reason: 'no readable content',
    },
    {
      label: 'an address that serves an image',
      serve: (o: FakeOrigin) => o.page(ARTICLE_URL, PNG, 'image/png'),
      reason: 'not a web page (image/png)',
    },
  ])('keeps the snapshot the link had, for $label', async ({ serve, reason }) => {
    const user = await signIn();
    const { id, prefix, origin } = await snapshotted(user);
    const before = (await api('GET', `/api/v1/links/${id}/snapshot`, { as: user.session })).json;
    const objects = await objectsUnder(prefix);
    serve(origin);
    setNow(T + 10 * 60_000);
    const { delivery } = await takeSnapshot(user, id);
    expect(delivery.retried).toEqual([]);
    expect(await linkOf(user, id)).toMatchObject({
      has_snapshot: true,
      snapshot_at: new Date(T).toISOString(),
      snapshot_requested_at: null,
      snapshot_error: reason,
    });
    expect(await objectsUnder(prefix)).toEqual(objects);
    expect((await api('GET', `/api/v1/links/${id}/snapshot`, { as: user.session })).json).toEqual(
      before,
    );
    expect((await snapshotEvents(id)).at(-1)).toEqual({ outcome: 'failed', reason });
  });

  it('keeps the previous snapshot and leaves nothing new when a write fails', async () => {
    const user = await signIn();
    const { id, prefix } = await snapshotted(user);
    const objects = await objectsUnder(prefix);
    setNow(T + 10 * 60_000);
    const sent = recordFetchQueue();
    await api('POST', `/api/v1/links/${id}/snapshot`, { as: user.session });
    const { retried } = await deliverFetches(
      sent.map((m) => m.body),
      { SNAPSHOTS: failingBucket(env.SNAPSHOTS) },
    );
    expect(retried).toEqual(['m0']);
    expect(await objectsUnder(prefix)).toEqual(objects);
    expect((await linkOf(user, id)).snapshot_at).toBe(new Date(T).toISOString());
  });

  it('leaves nothing behind for a link deleted while it was being taken', async () => {
    const user = await signIn();
    const origin = illustratedOrigin();
    const { id, prefix } = await addAndFetch(user, ARTICLE_URL);
    origin.serve('https://cdn.example/b.jpg', async () => {
      await api('DELETE', `/api/v1/links/${id}`, { as: user.session });
      return new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } });
    });
    const { delivery } = await takeSnapshot(user, id);
    expect(delivery).toEqual({ acked: ['m0'], retried: [] });
    expect(await count('links', 'id = ?', id)).toBe(0);
    expect(await objectsUnder(prefix)).toEqual([]);
  });
});

describe('a refresh', { timeout: 30_000 }, () => {
  it('never changes the snapshot', async () => {
    const user = await signIn();
    const { id, prefix } = await snapshotted(user);
    const before = (await api('GET', `/api/v1/links/${id}/snapshot`, { as: user.session })).json;
    const objects = await objectsUnder(prefix);
    illustratedOrigin(blogArticle.replace('The first reason', 'A newer reason'));
    await deliverFetches([{ user_id: user.id, link_id: id, refresh: true }]);
    expect(await objectsUnder(prefix)).toEqual(objects);
    expect((await api('GET', `/api/v1/links/${id}/snapshot`, { as: user.session })).json).toEqual(
      before,
    );
  });
});

describe('a PDF’s snapshot', { timeout: 30_000 }, () => {
  it('is the file, served inline or as an attachment, and Retake replaces it', async () => {
    const user = await signIn();
    const first = paperPdf('On Links');
    const origin = new FakeOrigin().page(PDF_URL, first, 'application/pdf');
    const { id } = await addAndFetch(user, PDF_URL);
    const r = await api('GET', `/api/v1/links/${id}/snapshot`, { as: user.session });
    expect(r.json).toMatchObject({
      content_kind: 'pdf',
      title: 'On Links',
      html: null,
      file_url: `/api/v1/links/${id}/snapshot/file`,
    });
    for (const [query, disposition] of [
      ['', 'inline; filename="On Links.pdf"'],
      ['?download=1', 'attachment; filename="On Links.pdf"'],
    ]) {
      const file = await api('GET', `${r.json.file_url}${query}`, { as: user.session });
      expect(file.headers.get('Content-Disposition')).toBe(disposition);
      expect(new Uint8Array(await file.response.arrayBuffer())).toEqual(first);
    }
    const second = paperPdf('On Links, again');
    origin.page(PDF_URL, second, 'application/pdf');
    await takeSnapshot(user, id);
    const file = await api('GET', r.json.file_url, { as: user.session });
    expect(new Uint8Array(await file.response.arrayBuffer())).toEqual(second);
    expect((await linkOf(user, id)).use_count).toBe(1);
  });

  it('is served from the key a PDF stored before snapshot folders had', async () => {
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: PDF_URL, state: 'active' }]);
    await env.DB.prepare(
      `UPDATE links SET content_kind = 'pdf', has_snapshot = 1, snapshot_kind = 'pdf',
         snapshot_at = '2026-01-01T00:00:00.000Z' WHERE id = ?`,
    )
      .bind(id)
      .run();
    await env.SNAPSHOTS.put(`u/${user.id}/l/${id}/snapshot`, '%PDF-1.4 old');
    const file = await api('GET', `/api/v1/links/${id}/snapshot/file`, { as: user.session });
    expect(await file.response.text()).toBe('%PDF-1.4 old');
  });
});

describe('reading a link without a snapshot', { timeout: 30_000 }, () => {
  it.each([
    { label: 'a pending link never fetched', setup: 'pending' },
    { label: 'a fetched web page', setup: 'page' },
    { label: 'a link that is not a web page', setup: 'image' },
  ])('answers no_snapshot for $label, and records no use', async ({ setup }) => {
    const user = await signIn();
    let id: string;
    if (setup === 'pending') {
      [id = ''] = await seedLinks(user, [{ url: 'https://none.example/' }]);
    } else if (setup === 'page') {
      new FakeOrigin().page(ARTICLE_URL, blogArticle);
      ({ id } = await addAndFetch(user, ARTICLE_URL));
    } else {
      new FakeOrigin().page('https://img.example/cat.png', 'png', 'image/png');
      ({ id } = await addAndFetch(user, 'https://img.example/cat.png'));
    }
    for (const view of ['snapshot', 'snapshot/file']) {
      const r = await api('GET', `/api/v1/links/${id}/${view}`, { as: user.session });
      expect([r.status, r.json]).toEqual([
        404,
        { error: 'no_snapshot', message: 'no snapshot stored for this link' },
      ]);
    }
    const image = await api('GET', `/api/v1/links/${id}/snapshot/images/x-1.png`, {
      as: user.session,
    });
    expect(image.status).toBe(404);
    expect((await linkOf(user, id)).use_count).toBe(0);
  });

  it('removes the reader view', async () => {
    const user = await signIn();
    new FakeOrigin().page(ARTICLE_URL, blogArticle);
    const { id } = await addAndFetch(user, ARTICLE_URL);
    const r = await api('GET', `/api/v1/links/${id}/reader`, { as: user.session });
    expect(r.status).toBe(404);
  });
});

describe('a link’s text', { timeout: 30_000 }, () => {
  it('is its stored article text, read as a use', async () => {
    const user = await signIn();
    new FakeOrigin().page(ARTICLE_URL, blogArticle);
    const { id } = await addAndFetch(user, ARTICLE_URL);
    const r = await api('GET', `/api/v1/links/${id}/text`, { as: user.session });
    expect(r.status).toBe(200);
    expect(r.json.id).toBe(id);
    expect(r.json.text).toContain('The first reason');
    expect((await linkOf(user, id)).use_count).toBe(1);
  });

  it('answers no_text when there is none', async () => {
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: 'https://none.example/' }]);
    const r = await api('GET', `/api/v1/links/${id}/text`, { as: user.session });
    expect([r.status, r.json]).toEqual([
      404,
      { error: 'no_text', message: 'no text stored for this link' },
    ]);
  });
});

describe('another user’s link', { timeout: 30_000 }, () => {
  it('is answered as one that does not exist, with no use recorded and nothing fetched', async () => {
    const owner = await signIn('b@example.test', 'B');
    const { id } = await snapshotted(owner);
    const read = await api('GET', `/api/v1/links/${id}/snapshot`, { as: owner.session });
    const [image = ''] = imageAddresses(read.json.html);
    const before = (await linkOf(owner, id)).use_count;
    const other = await signIn('a@example.test', 'A');
    const sent = recordFetchQueue();
    for (const [method, path] of [
      ['GET', `/api/v1/links/${id}/snapshot`],
      ['GET', `/api/v1/links/${id}/snapshot/file`],
      ['GET', image],
      ['GET', `/api/v1/links/${id}/text`],
      ['POST', `/api/v1/links/${id}/snapshot`],
      ['POST', `/api/v1/links/${id}/refresh`],
    ] as const) {
      const r = await api(method, path, { as: other.session });
      expect([r.status, r.json], path).toEqual([404, { error: 'not_found' }]);
    }
    expect((await linkOf(owner, id)).use_count).toBe(before);
    expect(sent).toEqual([]);
  });
});

describe('deleting a link', { timeout: 30_000 }, () => {
  it('deletes its snapshot, its images, its text and its events', async () => {
    const user = await signIn();
    const { id, prefix } = await snapshotted(user);
    expect((await objectsUnder(prefix)).length).toBe(3);
    const r = await api('DELETE', `/api/v1/links/${id}`, { as: user.session });
    expect(r.status).toBe(204);
    expect(await objectsUnder(prefix)).toEqual([]);
    expect(await count('link_texts', 'link_id = ?', id)).toBe(0);
    expect(await count('link_events', 'link_id = ?', id)).toBe(0);
  });
});

/** A bucket whose second put fails, after the first was written. */
function failingBucket(bucket: R2Bucket): R2Bucket {
  let puts = 0;
  return new Proxy(bucket, {
    get(target, prop) {
      if (prop === 'put') {
        return (...args: Parameters<R2Bucket['put']>) => {
          puts += 1;
          if (puts > 1) throw new Error('R2 put failed');
          return target.put(...args);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

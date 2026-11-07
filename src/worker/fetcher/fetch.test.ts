import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { outboundRequests } from '../test/outbound';
import { FakeOrigin } from '../test/origin';
import {
  api,
  count,
  deliverFetches,
  env,
  ORIGIN,
  recordFetchQueue,
  seedLinks,
  signIn,
  type TestUser,
} from '../test/helpers';
import { blogArticle } from './fixtures/pages';
import { fetchPage } from './fetch';

const ARTICLE = '<!doctype html><html><head><title>A</title></head><body><p>Hi</p></body></html>';

describe('adding links', () => {
  it('sends one fetch message per added link, and none for boosted or refused URLs', async () => {
    const sent = recordFetchQueue();
    const user = await signIn();
    await seedLinks(user, [{ url: 'https://c.example' }]);
    const r = await api('POST', '/api/v1/links/batch', {
      as: user.session,
      body: { urls: ['https://a.example', 'https://b.example', 'https://c.example', 'nope'] },
    });
    const [a, b] = r.json.added.map((l: { id: string }) => l.id);
    expect(sent).toEqual([
      { body: { user_id: user.id, link_id: a }, delaySeconds: undefined },
      { body: { user_id: user.id, link_id: b }, delaySeconds: undefined },
    ]);
    const d = await api('POST', '/api/v1/links', {
      as: user.session,
      body: { url: 'https://d.example' },
    });
    await api('POST', '/api/v1/links', { as: user.session, body: { url: 'https://d.example' } });
    expect(sent.slice(2)).toEqual([
      { body: { user_id: user.id, link_id: d.json.link.id }, delaySeconds: undefined },
    ]);
  });
});

describe('fetching a page', () => {
  it.each([
    { label: 'answered directly', redirects: 0 },
    { label: 'after exactly 5 redirects', redirects: 5 },
  ])(
    'follows a page $label and sends the fetcher’s headers',
    async ({ redirects }) => {
      const origin = new FakeOrigin();
      const host = `chain${redirects}.example`;
      const urls = Array.from({ length: redirects + 1 }, (_, i) => `https://${host}/${i}`);
      urls.slice(0, -1).forEach((u, i) => origin.redirect(u, urls[i + 1]!));
      origin.page(urls.at(-1)!, ARTICLE);
      const r = await fetchPage(env, urls[0]!);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.finalUrl).toBe(urls.at(-1));
      expect(r.status).toBe(200);
      expect(origin.log).toHaveLength(redirects + 1);
      for (const req of origin.log) {
        expect(req.headers.get('Accept')).toBe('text/html, application/pdf');
        expect(req.headers.get('User-Agent')).toBe(
          `Alexandria/1.0 (+${env.PUBLIC_ORIGIN}/about/fetcher)`,
        );
      }
    },
    15_000,
  );

  it.each([
    { label: 'a sixth redirect', target: 'https://six.example/6', reason: 'too many redirects' },
    { label: 'a loopback address', target: 'http://127.0.0.1/admin', reason: 'blocked address' },
    {
      label: 'a link-local address',
      target: 'http://169.254.169.254/latest',
      reason: 'blocked address',
    },
    { label: 'a file URL', target: 'file:///etc/passwd', reason: 'blocked address' },
  ])(
    'stops at $label without requesting it',
    async ({ target, reason }) => {
      const origin = new FakeOrigin();
      const host = reason === 'too many redirects' ? 'six.example' : 'blocked.example';
      const chain = Array.from({ length: 6 }, (_, i) => `https://${host}/${i}`);
      if (reason === 'too many redirects') {
        chain.forEach((u, i) => origin.redirect(u, `https://${host}/${i + 1}`));
        origin.page(target, ARTICLE);
      } else {
        origin.redirect(chain[0]!, target);
      }
      const r = await fetchPage(env, chain[0]!);
      expect(r).toEqual({ ok: false, reason });
      expect(outboundRequests.map((q) => q.url)).not.toContain(target);
    },
    15_000,
  );

  it('gives up when the origin stalls past the timeout', async () => {
    new FakeOrigin().stall('https://slow.example/');
    const started = Date.now();
    const r = await fetchPage(env, 'https://slow.example/', { timeoutMs: 200 });
    expect(r).toEqual({ ok: false, reason: 'timed out' });
    expect(Date.now() - started).toBeLessThan(1200);
  });
});

describe('the host gate', () => {
  it('spaces requests to one host a second apart across users, without delaying other hosts', async () => {
    const sent = recordFetchQueue();
    const origin = new FakeOrigin();
    for (let i = 0; i < 3; i++) origin.page(`https://same.example/${i}`, ARTICLE);
    origin.page('https://other.example/', ARTICLE);
    const users = [await signIn('a@example.test', 'A'), await signIn('b@example.test', 'B')];
    for (const user of users) {
      await api('POST', '/api/v1/links/batch', {
        as: user.session,
        body: { urls: [0, 1, 2].map((i) => `https://same.example/${i}`) },
      });
    }
    await api('POST', '/api/v1/links', {
      as: users[0]!.session,
      body: { url: 'https://other.example/' },
    });
    expect(sent).toHaveLength(7);
    const delivered = Date.now();
    await deliverFetches(sent.map((m) => m.body));
    const same = origin.log
      .filter((r) => r.url.startsWith('https://same.example/'))
      .map((r) => r.at)
      .sort((x, y) => x - y);
    expect(same).toHaveLength(6);
    for (let i = 1; i < same.length; i++) {
      expect(same[i]! - same[i - 1]!).toBeGreaterThanOrEqual(1000);
    }
    const other = origin.log.find((r) => r.url === 'https://other.example/');
    expect(other!.at - delivered).toBeLessThan(500);
  }, 20_000);
});

describe('a fetch', () => {
  it('requests only the link’s URL', async () => {
    const sent = recordFetchQueue();
    const origin = new FakeOrigin().page(
      'https://rich.example/page',
      `<!doctype html><html><head><title>Rich</title>
        <link rel="icon" href="/favicon.png"><link rel="stylesheet" href="/s.css">
        <link rel="alternate" type="application/rss+xml" href="/feed.xml"></head>
        <body><img src="/a.png"><a href="/robots.txt">robots</a><a href="/next">next</a></body></html>`,
    );
    const user = await signIn();
    await api('POST', '/api/v1/links', {
      as: user.session,
      body: { url: 'https://rich.example/page' },
    });
    await deliverFetches(sent.map((m) => m.body));
    expect(origin.log.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET https://rich.example/page',
    ]);
  });
});

describe('the fetcher’s public page', () => {
  it('explains the fetcher to anyone, signed in or not', async () => {
    const r = await SELF.fetch(`${ORIGIN}/about/fetcher`, { redirect: 'manual' });
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toMatch(/^text\/html/);
    const text = await r.text();
    expect(text).toContain('Alexandria');
    expect(text).toContain('1 request per second');
  });
});

/** Adds `url` for `user` and delivers its fetch message; returns the link's id and the delivery. */
async function addAndFetch(user: TestUser, url: string, bindings: Partial<Cloudflare.Env> = {}) {
  const sent = recordFetchQueue();
  const r = await api('POST', '/api/v1/links', { as: user.session, body: { url } });
  const id: string = r.json.link.id;
  const delivery = await deliverFetches(
    sent.map((m) => m.body),
    bindings,
  );
  return { id, delivery, prefix: `u/${user.id}/l/${id}/` };
}

async function objectsUnder(prefix: string): Promise<string[]> {
  return (await env.SNAPSHOTS.list({ prefix })).objects.map((o) => o.key);
}

describe('storing a fetched web page', () => {
  it('stores the metadata, the snapshot and the reader view, and makes the link active', async () => {
    new FakeOrigin()
      .redirect('https://news.example/a', 'https://news.example/articles/a')
      .page('https://news.example/articles/a', blogArticle);
    const user = await signIn();
    const { id, prefix } = await addAndFetch(user, 'https://news.example/a');
    const l = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
    expect(l).toMatchObject({
      state: 'active',
      final_url: 'https://news.example/articles/a',
      http_status: 200,
      title: 'Why We Keep Links Forever',
      description: 'An essay on keeping links.',
      favicon_url: 'https://news.example/static/icon.png',
      language: 'en',
      content_kind: 'html',
      has_snapshot: true,
      fetched_at: expect.any(String),
    });
    const snapshot = await env.SNAPSHOTS.get(`${prefix}snapshot`);
    expect(await snapshot?.text()).toBe(blogArticle);
    const text = await env.DB.prepare('SELECT text FROM link_texts WHERE link_id = ?')
      .bind(id)
      .first<{ text: string }>();
    expect(text?.text).toContain('The first reason');
  });

  it('reads only the first 5 MB of a larger page and notes it as truncated', async () => {
    new FakeOrigin().stream('https://big.example/page', 6 * 1024 * 1024, 'text/html', {
      prefix: '<!doctype html><html><head><title>Big</title></head><body><p>',
    });
    const user = await signIn();
    const { id, prefix } = await addAndFetch(user, 'https://big.example/page');
    const l = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
    expect(l.state).toBe('active');
    expect(l.notes).toContain('truncated');
    const head = await env.SNAPSHOTS.head(`${prefix}snapshot`);
    expect(head?.size).toBe(5_242_880);
  });

  it.each([
    {
      url: 'https://img.example/photos/cat.png',
      type: 'image/png',
      title: 'cat.png',
      note: 'not a web page (image/png)',
    },
    {
      url: 'https://api.example/',
      type: 'application/json',
      title: 'api.example',
      note: 'not a web page (application/json)',
    },
  ])('keeps no snapshot of $type', async ({ url, type, title, note }) => {
    new FakeOrigin().page(url, 'not html', type);
    const user = await signIn();
    const { id, prefix } = await addAndFetch(user, url);
    const l = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
    expect(l).toMatchObject({ state: 'active', content_kind: 'other', title, has_snapshot: false });
    expect(l.notes).toContain(note);
    expect(await objectsUnder(prefix)).toEqual([]);
  });

  it.each(['before delivery', 'while the origin holds the response'])(
    'writes nothing for a link deleted %s',
    async (when) => {
      const user = await signIn();
      const origin = new FakeOrigin();
      const sent = recordFetchQueue();
      const r = await api('POST', '/api/v1/links', {
        as: user.session,
        body: { url: 'https://gone.example/' },
      });
      const id: string = r.json.link.id;
      const remove = () => api('DELETE', `/api/v1/links/${id}`, { as: user.session });
      if (when === 'before delivery') {
        origin.page('https://gone.example/', blogArticle);
        await remove();
      } else {
        origin.serve('https://gone.example/', async () => {
          await remove();
          return new Response(blogArticle, { headers: { 'Content-Type': 'text/html' } });
        });
      }
      const { acked, retried } = await deliverFetches(sent.map((m) => m.body));
      expect(await count('links', 'id = ?', id)).toBe(0);
      expect(await objectsUnder(`u/${user.id}/l/${id}/`)).toEqual([]);
      expect(acked).toEqual(['m0']);
      expect(retried).toEqual([]);
    },
  );

  it.each(['the snapshot write', 'the database write'])(
    'leaves the link as it was and retries when %s fails',
    async (failing) => {
      new FakeOrigin().page('https://flaky.example/', blogArticle);
      const user = await signIn();
      const sent = recordFetchQueue();
      const r = await api('POST', '/api/v1/links', {
        as: user.session,
        body: { url: 'https://flaky.example/' },
      });
      const id: string = r.json.link.id;
      const before = await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first();
      const bindings: Partial<Cloudflare.Env> =
        failing === 'the snapshot write'
          ? { SNAPSHOTS: failingBucket(env.SNAPSHOTS) }
          : { DB: failingDatabase(env.DB) };
      const { acked, retried } = await deliverFetches(
        sent.map((m) => m.body),
        bindings,
      );
      expect(retried).toEqual(['m0']);
      expect(acked).toEqual([]);
      expect(await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first()).toEqual(
        before,
      );
      expect(await objectsUnder(`u/${user.id}/l/${id}/`)).toEqual([]);
    },
  );
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

/** A database whose batches fail, as an unavailable D1 would. */
function failingDatabase(db: D1Database): D1Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'batch') {
        return () => {
          throw new Error('D1 batch failed');
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

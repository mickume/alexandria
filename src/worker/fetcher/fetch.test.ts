import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { outboundRequests } from '../test/outbound';
import { fakeDns, FakeOrigin, INTERNAL_ERROR, NETWORK_LOST } from '../test/origin';
import {
  addAndFetch,
  api,
  count,
  deliverFetches,
  env,
  ORIGIN,
  recordFetchQueue,
  seedLinks,
  setNow,
  signIn,
} from '../test/helpers';
import { blogArticle } from './fixtures/pages';
import { fetchPage } from './fetch';
import { titleFromUrl } from './queue';

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

/** Cloudflare's "Just a moment…" page, as a site behind its bot check answers a fetcher. */
function botCheck(): Response {
  return new Response('<title>Just a moment...</title>', {
    status: 403,
    headers: { 'Content-Type': 'text/html', Server: 'cloudflare', 'cf-mitigated': 'challenge' },
  });
}

describe('a failed first fetch', () => {
  async function pendingLink(url: string) {
    const user = await signIn();
    const sent = recordFetchQueue();
    const r = await api('POST', '/api/v1/links', { as: user.session, body: { url } });
    return { user, sent, id: r.json.link.id as string };
  }

  it('keeps the link pending and retries after 10 minutes, then after 2 hours, then gives up', async () => {
    const origin = new FakeOrigin().status('https://down.example/', 503);
    const { user, sent, id } = await pendingLink('https://down.example/');
    const get = async () => (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
    const attempts = async () =>
      (
        await env.DB.prepare('SELECT fetch_attempts FROM links WHERE id = ?')
          .bind(id)
          .first<{ fetch_attempts: number }>()
      )?.fetch_attempts;

    await deliverFetches([sent[0]!.body]);
    expect(await get()).toMatchObject({ state: 'pending', state_reason: 'HTTP 503' });
    expect(await attempts()).toBe(1);
    expect(sent.slice(1)).toEqual([{ body: { user_id: user.id, link_id: id }, delaySeconds: 600 }]);

    await deliverFetches([sent[1]!.body]);
    expect(await attempts()).toBe(2);
    expect(sent.slice(2)).toEqual([
      { body: { user_id: user.id, link_id: id }, delaySeconds: 7200 },
    ]);

    origin.fail('https://down.example/', NETWORK_LOST);
    await deliverFetches([sent[2]!.body]);
    expect(await get()).toMatchObject({
      state: 'unreachable',
      state_reason: 'could not connect',
      title: 'down.example',
    });
    expect(sent).toHaveLength(3);
  }, 15_000);

  it.each([
    {
      label: 'an unknown host',
      make: (o: FakeOrigin, u: string) => {
        o.fail(u, INTERNAL_ERROR);
        fakeDns({ [new URL(u).hostname]: 'missing' });
      },
      reason: 'host not found',
    },
    {
      label: 'a refused connection',
      make: (o: FakeOrigin, u: string) => o.fail(u, NETWORK_LOST),
      reason: 'could not connect',
    },
    {
      label: 'a connection reset mid-response',
      make: (o: FakeOrigin, u: string) => o.reset(u),
      reason: 'could not connect',
    },
    {
      label: 'a bad certificate',
      make: (o: FakeOrigin, u: string) => {
        o.fail(u, INTERNAL_ERROR);
        fakeDns({ [new URL(u).hostname]: 'found' });
      },
      reason: 'TLS error',
    },
    {
      label: 'an opaque error the DNS lookup cannot explain',
      make: (o: FakeOrigin, u: string) => {
        o.fail(u, INTERNAL_ERROR);
        fakeDns({ [new URL(u).hostname]: 'fail' });
      },
      reason: 'could not connect',
    },
    {
      label: 'a stall past the timeout',
      make: (o: FakeOrigin, u: string) => o.stall(u),
      reason: 'timed out',
    },
    { label: 'a 403', make: (o: FakeOrigin, u: string) => o.status(u, 403), reason: 'HTTP 403' },
    {
      label: 'a bot check',
      make: (o: FakeOrigin, u: string) => o.serve(u, () => botCheck()),
      reason: 'blocked by a bot check',
    },
    { label: 'a 500', make: (o: FakeOrigin, u: string) => o.status(u, 500), reason: 'HTTP 500' },
  ])('states the reason of $label', async ({ make, reason, label }) => {
    const url = `https://${label.replace(/\W+/g, '-')}.example/`;
    make(new FakeOrigin(), url);
    const r = await fetchPage(env, url, { timeoutMs: 300 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(reason);
  });

  it('gives up at once on a bot check, titling the link from its address', async () => {
    const url = 'https://blog.example/why-git-was-replaced-4f31eae67e00';
    new FakeOrigin().serve(url, () => botCheck());
    const { user, sent, id } = await pendingLink(url);
    await deliverFetches([sent[0]!.body]);
    const link = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
    expect(link).toMatchObject({
      state: 'unreachable',
      state_reason: 'blocked by a bot check',
      title: 'Why git was replaced',
    });
    expect(sent).toHaveLength(1);
  });

  it('keeps a title the owner edited while the link was pending', async () => {
    const url = 'https://blog.example/a-post-4f31eae67e00';
    new FakeOrigin().status(url, 503);
    const { user, sent, id } = await pendingLink(url);
    await api('PATCH', `/api/v1/links/${id}`, { as: user.session, body: { title: 'Mine' } });
    await deliverFetches([sent[0]!.body]);
    const link = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
    expect(link).toMatchObject({ state: 'pending', title: 'Mine' });
  });

  it.each([
    [
      'https://onnyunhui.medium.com/why-anthropic-replaced-git-with-scion-for-ai-coding-agents-4f31eae67e00',
      'Why anthropic replaced git with scion for ai coding agents',
    ],
    ['https://x.example/blog/my_first+post.html', 'My first post'],
    ['https://x.example/caf%C3%A9-cr%C3%A8me/', 'Café crème'],
    ['https://x.example/v2-release-notes', 'V2 release notes'],
    ['https://x.example/', 'x.example'],
    ['https://x.example/p/4f31eae67e00', 'x.example'],
    ['https://x.example/2024/05/', 'x.example'],
    ['https://x.example/%E0%A4%A', 'x.example'],
  ])('titles %s as %j when it cannot be fetched', (url, title) => {
    expect(titleFromUrl(url)).toBe(title);
  });

  it.each([
    [521, '', 'could not connect'],
    [522, '', 'timed out'],
    [523, '', 'could not connect'],
    [524, '', 'timed out'],
    [525, '', 'TLS error'],
    [526, '', 'TLS error'],
    [530, 'error code: 1016', 'host not found'],
    [530, 'error code: 1033', 'HTTP 530'],
    [520, '', 'HTTP 520'],
  ])("states the reason of Cloudflare's %i %s", async (status, body, reason) => {
    const url = `https://cf-${status}-${body.replace(/\W+/g, '')}.example/`;
    new FakeOrigin().serve(
      url,
      () => new Response(body || `error ${status}`, { status, headers: { Server: 'cloudflare' } }),
    );
    const r = await fetchPage(env, url, { timeoutMs: 300 });
    expect(r).toMatchObject({ ok: false, reason, status });
  });

  it('keeps the status of a 52x that does not come from Cloudflare', async () => {
    const url = 'https://not-cloudflare.example/';
    new FakeOrigin().status(url, 522);
    expect(await fetchPage(env, url, { timeoutMs: 300 })).toMatchObject({
      ok: false,
      reason: 'HTTP 522',
    });
  });
});

describe('a link’s fetch history', () => {
  it('lists every fetch attempt among the uses, newest first', async () => {
    const origin = new FakeOrigin().status('https://later.example/', 503);
    const user = await signIn();
    const sent = recordFetchQueue();
    const t1 = '2026-09-01T10:00:00.000Z';
    const t2 = '2026-09-01T10:10:00.000Z';
    const t3 = '2026-09-01T11:00:00.000Z';
    setNow(t1);
    const r = await api('POST', '/api/v1/links', {
      as: user.session,
      body: { url: 'https://later.example/' },
    });
    const id = r.json.link.id;
    await deliverFetches([sent[0]!.body]);
    origin.page('https://later.example/', blogArticle);
    setNow(t2);
    await deliverFetches([sent[1]!.body]);
    setNow(t3);
    await api('GET', `/api/v1/links/${id}/open`, { as: user.session });
    const history = await api('GET', `/api/v1/links/${id}/history`, { as: user.session });
    expect(history.json.items).toEqual([
      { kind: 'use', at: t3 },
      { kind: 'fetch', at: t2, outcome: 'ok', http_status: 200, reason: null },
      { kind: 'fetch', at: t1, outcome: 'failed', http_status: 503, reason: 'HTTP 503' },
    ]);
  });
});

describe('refreshing a link', () => {
  it.each(['an active link whose page changed', 'an unreachable link whose site is back'])(
    'takes a new copy of %s',
    async (label) => {
      const url = 'https://changing.example/';
      const user = await signIn();
      const origin = new FakeOrigin();
      let id: string;
      if (label.startsWith('an active')) {
        origin.page(url, blogArticle);
        ({ id } = await addAndFetch(user, url));
      } else {
        [id = ''] = await seedLinks(user, [{ url, state: 'unreachable' }]);
        await env.DB.prepare(
          "UPDATE links SET state_reason = 'timed out', fetch_attempts = 3 WHERE id = ?",
        )
          .bind(id)
          .run();
      }
      const changed = blogArticle.replace('The first reason', 'A newer reason');
      origin.page(url, changed);
      const sent = recordFetchQueue();
      const t = '2026-10-02T12:00:00.000Z';
      setNow(t);
      const r = await api('POST', `/api/v1/links/${id}/refresh`, { as: user.session });
      expect(r.status).toBe(202);
      expect(r.json).toEqual({ status: 'queued' });
      expect(sent).toEqual([
        { body: { user_id: user.id, link_id: id, refresh: true }, delaySeconds: undefined },
      ]);
      await deliverFetches([sent[0]!.body]);
      const l = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
      expect(l).toMatchObject({ state: 'active', state_reason: null, fetched_at: t });
      const snapshot = await env.SNAPSHOTS.get(`u/${user.id}/l/${id}/snapshot`);
      expect(await snapshot?.text()).toBe(changed);
    },
  );

  it('is refused within 10 minutes of the previous refresh', async () => {
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: 'https://often.example/' }]);
    const sent = recordFetchQueue();
    const t = Date.parse('2026-10-03T08:00:00.000Z');
    setNow(t);
    expect((await api('POST', `/api/v1/links/${id}/refresh`, { as: user.session })).status).toBe(
      202,
    );
    setNow(t + 4 * 60_000);
    const r = await api('POST', `/api/v1/links/${id}/refresh`, { as: user.session });
    expect(r.status).toBe(429);
    expect(r.json).toEqual({ error: 'refreshed_recently', message: 'already refreshed recently' });
    expect(r.headers.get('Retry-After')).toBe('360');
    expect(sent).toHaveLength(1);
    setNow(t + 10 * 60_000);
    expect((await api('POST', `/api/v1/links/${id}/refresh`, { as: user.session })).status).toBe(
      202,
    );
  });

  it('takes a new copy of an archived link, enriches it again and keeps it archived', async () => {
    const url = 'https://kept.example/';
    const origin = new FakeOrigin().page(url, blogArticle);
    const user = await signIn();
    const { id } = await addAndFetch(user, url);
    await api('PATCH', `/api/v1/links/${id}`, { as: user.session, body: { title: 'My title' } });
    await env.DB.prepare('UPDATE links SET enrichment_status = NULL WHERE id = ?').bind(id).run();
    const sent = recordFetchQueue();
    const archived = await api('POST', `/api/v1/links/${id}/archive`, { as: user.session });
    const changed = blogArticle.replace('The first reason', 'A newer reason');
    origin.page(url, changed);
    const t = '2026-10-04T12:00:00.000Z';
    setNow(t);
    await deliverFetches([sent[0]!.body]);
    const l = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
    expect(l).toMatchObject({
      state: 'archived',
      archived_at: archived.json.archived_at,
      fetched_at: t,
      title: 'My title',
      enrichment_status: 'no_key',
    });
    const snapshot = await env.SNAPSHOTS.get(`u/${user.id}/l/${id}/snapshot`);
    expect(await snapshot?.text()).toBe(changed);
  });

  it.each(['an active link', 'an archived link'])(
    'keeps everything %s had when the refresh fails',
    async (label) => {
      const url = 'https://steady.example/';
      const origin = new FakeOrigin().page(url, blogArticle);
      const user = await signIn();
      const { id } = await addAndFetch(user, url);
      const sent = recordFetchQueue();
      if (label === 'an archived link') {
        await api('POST', `/api/v1/links/${id}/archive`, { as: user.session });
      }
      const before = await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first();
      origin.status(url, 500);
      if (label === 'an active link') {
        await api('POST', `/api/v1/links/${id}/refresh`, { as: user.session });
      }
      await deliverFetches([sent[0]!.body]);
      const after = await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first();
      expect({ ...after, refresh_requested_at: null, updated_at: null }).toEqual({
        ...before,
        refresh_requested_at: null,
        updated_at: null,
      });
      expect(await (await env.SNAPSHOTS.get(`u/${user.id}/l/${id}/snapshot`))?.text()).toBe(
        blogArticle,
      );
      const history = await api('GET', `/api/v1/links/${id}/history`, { as: user.session });
      expect(history.json.items[0]).toMatchObject({
        kind: 'fetch',
        outcome: 'failed',
        reason: 'HTTP 500',
      });
      expect(sent).toHaveLength(1);
    },
  );
});

describe('an unreachable link', () => {
  it('stays in the stream and can be opened, pinned, unpinned, refreshed and deleted', async () => {
    const url = 'https://gone-away.example/';
    new FakeOrigin().fail(url, NETWORK_LOST);
    const user = await signIn();
    const { id, sent } = await addAndFetch(user, url);
    await deliverFetches([sent[1]!.body]);
    await deliverFetches([sent[2]!.body]);
    expect((await api('GET', `/api/v1/links/${id}`, { as: user.session })).json.state).toBe(
      'unreachable',
    );
    const stream = await api('GET', '/api/v1/links', { as: user.session });
    expect(stream.json.items.map((l: { id: string }) => l.id)).toContain(id);
    for (const [method, path, status] of [
      ['GET', 'open', 302],
      ['POST', 'pin', 200],
      ['DELETE', 'pin', 200],
      ['POST', 'refresh', 202],
    ] as const) {
      expect((await api(method, `/api/v1/links/${id}/${path}`, { as: user.session })).status).toBe(
        status,
      );
    }
    expect((await api('DELETE', `/api/v1/links/${id}`, { as: user.session })).status).toBe(204);
  }, 15_000);
});

describe('the stream’s change feed', () => {
  it('lists the links changed since the server time it gave, oldest change first', async () => {
    new FakeOrigin().page('https://feed-a.example/', blogArticle);
    const user = await signIn();
    const sent = recordFetchQueue();
    setNow('2026-10-04T10:00:00.000Z');
    const add = (url: string) => api('POST', '/api/v1/links', { as: user.session, body: { url } });
    const a = (await add('https://feed-a.example/')).json.link.id;
    await add('https://feed-b.example/');
    setNow('2026-10-04T10:00:05.000Z');
    const r1 = await api('GET', '/api/v1/links?changed_since=2026-10-04T09:00:00.000Z', {
      as: user.session,
    });
    expect(r1.json.items).toHaveLength(2);
    expect(r1.json.server_time).toBe('2026-10-04T10:00:05.000Z');
    setNow('2026-10-04T10:00:09.000Z');
    await deliverFetches([sent[0]!.body]);
    setNow('2026-10-04T10:00:10.000Z');
    const r2 = await api('GET', `/api/v1/links?changed_since=${r1.json.server_time}`, {
      as: user.session,
    });
    expect(r2.status).toBe(200);
    expect(r2.json.items.map((l: { id: string }) => l.id)).toEqual([a]);
    expect(r2.json.items[0]).toMatchObject({
      state: 'active',
      title: 'Why We Keep Links Forever',
      updated_at: '2026-10-04T10:00:09.000Z',
    });
    expect(r2.json.server_time).toBe('2026-10-04T10:00:10.000Z');
  });

  it.each(['yesterday', '', '2026-13-40T00:00:00Z'])('refuses changed_since=%j', async (value) => {
    const user = await signIn();
    const r = await api('GET', `/api/v1/links?changed_since=${encodeURIComponent(value)}`, {
      as: user.session,
    });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({
      error: 'invalid_changed_since',
      field: 'changed_since',
      message: expect.any(String),
    });
  });
});

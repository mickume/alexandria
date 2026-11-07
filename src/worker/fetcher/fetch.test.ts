import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { outboundRequests } from '../test/outbound';
import { FakeOrigin } from '../test/origin';
import {
  api,
  deliverFetches,
  env,
  ORIGIN,
  recordFetchQueue,
  seedLinks,
  signIn,
} from '../test/helpers';
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

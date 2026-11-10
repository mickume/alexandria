import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeUrl } from './normalize';

describe('normalizeUrl', () => {
  it.each([
    ['  https://example.com/a  ', 'https://example.com/a'],
    ['example.com', 'https://example.com'],
    ['HTTPS://Example.COM/Path', 'https://example.com/Path'],
    ['https://example.com/a#top', 'https://example.com/a'],
    ['http://example.com:80/a', 'http://example.com/a'],
    ['https://example.com:443/', 'https://example.com'],
    ['https://example.com:8443/', 'https://example.com:8443'],
    ['https://example.com/article?utm_source=x&utm_medium=y', 'https://example.com/article'],
    [
      'https://example.com/?fbclid=1&gclid=2&mc_cid=3&mc_eid=4&b=2&a=1',
      'https://example.com/?a=1&b=2',
    ],
    ['https://example.com/?ref=hn&source=rss', 'https://example.com/?ref=hn&source=rss'],
    ['https://example.com/a/', 'https://example.com/a/'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalizeUrl(input)).toEqual({ ok: true, url: expected });
  });

  it.each([
    '',
    '   ',
    'not a url',
    'nope',
    'https://intranet/',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,x',
    'ftp://example.com',
    'http://localhost/',
    'http://LOCALHOST:8080',
    'http://127.0.0.1',
    'http://[::1]/',
    'http://10.1.2.3',
    'http://172.16.0.1',
    'http://192.168.1.1',
    'http://169.254.169.254',
    'http://[fd00::1]',
    'http://[fe80::1]',
    'http://foo.localhost./',
    'http://100.64.0.1',
    'http://198.18.0.1',
    'http://224.0.0.1',
    'http://255.255.255.255',
    'http://[::7f00:1]/',
    'http://[64:ff9b::7f00:1]/',
    'http://[fec0::1]',
    'http://[ff02::1]',
  ])('rejects %j', (input) => {
    expect(normalizeUrl(input)).toEqual({ ok: false, error: 'invalid_url' });
  });

  it('accepts a public address next to a private range', () => {
    expect(normalizeUrl('http://172.32.0.1')).toEqual({ ok: true, url: 'http://172.32.0.1' });
  });

  it('returns a URL that normalises to itself', () => {
    const label = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,8}$/);
    const host = fc
      .tuple(fc.array(label, { minLength: 1, maxLength: 3 }), fc.constantFrom('com', 'ORG', 'Io'))
      .map(([labels, tld]) => [...labels, tld].join('.'));
    const param = fc.tuple(
      fc.constantFrom(
        'utm_source',
        'utm_x',
        'fbclid',
        'gclid',
        'mc_cid',
        'mc_eid',
        'ref',
        'a',
        'b',
      ),
      fc.stringMatching(/^[a-z0-9]{0,4}$/),
    );
    const input = fc
      .record({
        scheme: fc.constantFrom('http://', 'https://', 'HTTPS://', ''),
        host,
        port: fc.option(fc.constantFrom(80, 443, 8080, 8443), { nil: undefined }),
        path: fc.array(label, { maxLength: 3 }).map((s) => s.join('/')),
        slash: fc.boolean(),
        params: fc.array(param, { maxLength: 5 }),
        fragment: fc.option(label, { nil: undefined }),
      })
      .map(({ scheme, host, port, path, slash, params, fragment }) => {
        let s = scheme + host + (port ? `:${port}` : '');
        if (path || slash) s += '/' + path + (slash && path ? '/' : '');
        if (params.length) s += '?' + params.map(([k, v]) => `${k}=${v}`).join('&');
        if (fragment) s += '#' + fragment;
        return s;
      });
    fc.assert(
      fc.property(input, (x) => {
        const first = normalizeUrl(x);
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(normalizeUrl(first.url)).toEqual({ ok: true, url: first.url });
      }),
      { numRuns: 300 },
    );
  });
});

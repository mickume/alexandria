import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  api,
  type ApiOptions,
  count,
  createToken,
  env,
  ORIGIN,
  seedLinks,
  setNow,
  sha256Hex,
  signIn,
} from '../test/helpers';

const DAY = 24 * 60 * 60 * 1000;

async function storedExpiry(session: string): Promise<string | undefined> {
  const row = await env.DB.prepare('SELECT expires_at FROM sessions WHERE id_hash = ?')
    .bind(await sha256Hex(session))
    .first<{ expires_at: string }>();
  return row?.expires_at;
}

describe('a session', () => {
  it('authenticates its user and moves its expiry to 30 days after the request', async () => {
    const t0 = Date.parse('2026-03-01T12:00:00.000Z');
    setNow(t0);
    const user = await signIn('owner@example.test');
    const t = t0 + 29 * DAY;
    setNow(t);
    const r = await api('GET', '/api/v1/me', { as: user.session });
    expect(r.status).toBe(200);
    expect(r.json.email).toBe(user.email);
    expect(await storedExpiry(user.session)).toBe(new Date(t + 30 * DAY).toISOString());
  });

  it.each<{ label: string; creds: ApiOptions | 'expired' }>([
    { label: 'no credentials', creds: {} },
    { label: 'a cookie that names no session', creds: { as: 'nope' } },
    { label: 'an expired session', creds: 'expired' },
    { label: 'an unknown bearer token', creds: { bearer: 'alx_unknown' } },
  ])('refuses an API request with $label', async ({ creds }) => {
    const t0 = Date.parse('2026-03-01T12:00:00.000Z');
    setNow(t0);
    const user = await signIn('owner@example.test');
    await seedLinks(user, [{ url: 'https://kept.example' }]);
    const options: ApiOptions = creds === 'expired' ? { as: user.session } : creds;
    if (creds === 'expired') setNow(t0 + 30 * DAY + 1000);
    for (const [method, body] of [
      ['GET', undefined],
      ['POST', { url: 'https://a.example' }],
    ] as const) {
      const r = await api(method, '/api/v1/links', { ...options, body });
      expect(r.status).toBe(401);
      expect(r.json).toEqual({ error: 'unauthorized' });
      expect(await count('links')).toBe(1);
    }
  });
});

describe('website pages', () => {
  it.each(['/', '/settings', '/links/abc'])(
    'redirect %s to the sign-in page without a session',
    async (path) => {
      const r = await SELF.fetch(`${ORIGIN}${path}`, {
        redirect: 'manual',
        headers: { Accept: 'text/html' },
      });
      expect(r.status).toBe(302);
      expect(r.headers.get('Location')).toBe('/signin');
    },
  );

  it('serves the sign-in page and the public pages without a session', async () => {
    for (const path of ['/signin', '/about/fetcher']) {
      const r = await SELF.fetch(`${ORIGIN}${path}`, {
        redirect: 'manual',
        headers: { Accept: 'text/html' },
      });
      expect(r.status).toBe(200);
    }
  });

  it('serves a page to a signed-in user', async () => {
    const user = await signIn();
    const r = await SELF.fetch(`${ORIGIN}/settings`, {
      redirect: 'manual',
      headers: { Accept: 'text/html', Cookie: `alexandria_session=${user.session}` },
    });
    expect(r.status).toBe(200);
  });
});

describe('signing out', () => {
  it('deletes the session and expires its cookie', async () => {
    const user = await signIn('owner@example.test');
    const r = await SELF.fetch(`${ORIGIN}/auth/signout`, {
      method: 'POST',
      redirect: 'manual',
      headers: { Cookie: `alexandria_session=${user.session}`, Origin: ORIGIN },
    });
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toBe('/signin');
    const cookie = r.headers.getSetCookie().find((c) => c.startsWith('alexandria_session='));
    expect(cookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
    expect(await count('sessions')).toBe(0);
    expect((await api('GET', '/api/v1/me', { as: user.session })).status).toBe(401);
  });
});

describe('the origin of a cookie-authenticated change', () => {
  it.each([
    { label: 'missing', origin: null },
    { label: 'another site', origin: 'https://evil.example' },
  ])('refuses a request whose Origin is $label', async ({ origin }) => {
    const user = await signIn();
    const r = await api('POST', '/api/v1/links', {
      as: user.session,
      origin,
      body: { url: 'https://a.example' },
    });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('forbidden_origin');
    expect(await count('links')).toBe(0);
  });
});

describe('another user’s resources', () => {
  it('are answered exactly as resources that do not exist', async () => {
    const a = await signIn('a@example.test', 'A');
    const b = await signIn('b@example.test', 'B');
    const [link = ''] = await seedLinks(b, [{ url: 'https://b.example', useCount: 3 }]);
    const token = await createToken(b);
    const before = await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(link).first();
    const requests = (id: string, tokenId: string) =>
      [
        ['GET', `/api/v1/links/${id}`],
        ['DELETE', `/api/v1/links/${id}`],
        ['GET', `/api/v1/links/${id}/open`],
        ['GET', `/api/v1/links/${id}/history`],
        ['POST', `/api/v1/links/${id}/pin`],
        ['DELETE', `/api/v1/links/${id}/pin`],
        ['DELETE', `/api/v1/tokens/${tokenId}`],
      ] as const;
    const missing = crypto.randomUUID();
    const others = requests(link, token.id);
    const nowhere = requests(missing, missing);
    for (let i = 0; i < others.length; i++) {
      const [method, path] = others[i]!;
      const r = await api(method, path, { as: a.session });
      expect(r.status, `${method} ${path}`).toBe(404);
      expect(r.json).toEqual({ error: 'not_found' });
      const [m2, p2] = nowhere[i]!;
      const r2 = await api(m2, p2, { as: a.session });
      expect([r2.status, r2.json]).toEqual([r.status, r.json]);
    }
    expect(await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(link).first()).toEqual(
      before,
    );
    expect(await count('tokens', 'id = ? AND revoked_at IS NULL', token.id)).toBe(1);
  });
});

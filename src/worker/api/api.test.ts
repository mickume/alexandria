import { describe, expect, it } from 'vitest';
import { advance } from '../clock';
import { api, count, createToken, setNow, signIn } from '../test/helpers';

describe('the current user', () => {
  it('is the email and the display name, and nothing else', async () => {
    const user = await signIn('owner@example.test', 'Ada Owner');
    const r = await api('GET', '/api/v1/me', { as: user.session });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ email: 'owner@example.test', name: 'Ada Owner' });
  });
});

describe('an unknown path under /api/v1/', () => {
  it('is not found for a signed-in user and unauthorized without credentials', async () => {
    const user = await signIn();
    const r = await api('GET', '/api/v1/nothing-here', { as: user.session });
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: 'not_found' });
    const anonymous = await api('GET', '/api/v1/nothing-here');
    expect(anonymous.status).toBe(401);
    expect(anonymous.json).toEqual({ error: 'unauthorized' });
  });
});

describe('the rate limit', () => {
  it('allows 600 requests a minute per user across credentials, then refuses until the minute ends', async () => {
    setNow(Date.parse('2026-05-01T10:00:00.000Z'));
    const owner = await signIn('owner@example.test');
    const token = await createToken(owner);
    const other = await signIn('other@example.test', 'Other');
    for (let i = 0; i < 600; i++) {
      const r = await api(
        'GET',
        '/api/v1/me',
        i % 2 ? { as: owner.session } : { bearer: token.secret },
      );
      expect(r.status).toBe(200);
    }
    const refused = await api('GET', '/api/v1/me', { as: owner.session });
    expect(refused.status).toBe(429);
    expect(refused.json).toEqual({ error: 'rate_limited' });
    const retryAfter = Number(refused.headers.get('Retry-After'));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);

    expect((await api('GET', '/api/v1/me', { as: other.session })).status).toBe(200);
    advance(60_000);
    expect((await api('GET', '/api/v1/me', { bearer: token.secret })).status).toBe(200);
  });
});

describe('a request body', () => {
  it.each([
    { path: '/api/v1/links', body: 'not json', error: 'invalid_json', field: null, table: 'links' },
    {
      path: '/api/v1/links/batch',
      body: { urls: 'x' },
      error: 'no_urls',
      field: 'urls',
      table: 'links',
    },
    {
      path: '/api/v1/tokens',
      body: 'not json',
      error: 'invalid_json',
      field: null,
      table: 'tokens',
    },
    {
      path: '/api/v1/tokens',
      body: { name: 5 },
      error: 'invalid_name',
      field: 'name',
      table: 'tokens',
    },
  ])(
    'that is not acceptable for POST $path is refused with $error',
    async ({ path, body, error, field, table }) => {
      const user = await signIn();
      const r = await api('POST', path, { as: user.session, body });
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ error, field, message: expect.any(String) });
      expect(await count(table)).toBe(0);
    },
  );
});

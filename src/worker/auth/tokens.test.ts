import { describe, expect, it } from 'vitest';
import {
  api,
  count,
  createToken,
  env,
  seedLinks,
  setNow,
  sha256Hex,
  signIn,
} from '../test/helpers';

async function storedValues(): Promise<string[]> {
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  ).all<{ name: string }>();
  const values: string[] = [];
  for (const { name } of tables.results) {
    const rows = await env.DB.prepare(`SELECT * FROM ${name}`).all();
    for (const row of rows.results) values.push(...Object.values(row).map(String));
  }
  return values;
}

describe('creating a token', () => {
  it('returns the secret once and stores only its hash', async () => {
    const user = await signIn();
    const r = await api('POST', '/api/v1/tokens', {
      as: user.session,
      body: { name: 'laptop script' },
    });
    expect(r.status).toBe(201);
    expect(r.json).toEqual({
      id: expect.any(String),
      name: 'laptop script',
      created_at: expect.any(String),
      last_used_at: null,
      secret: expect.stringMatching(/^alx_/),
    });
    expect(await storedValues()).not.toContain(r.json.secret);
    const row = await env.DB.prepare('SELECT secret_hash FROM tokens WHERE id = ?')
      .bind(r.json.id)
      .first<{ secret_hash: string }>();
    expect(row?.secret_hash).toBe(await sha256Hex(r.json.secret));
  });

  it('refuses a 21st token until one is revoked', async () => {
    const user = await signIn();
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await api('POST', '/api/v1/tokens', { as: user.session, body: { name: `t${i}` } });
      expect(r.status).toBe(201);
      ids.push(r.json.id);
    }
    const r = await api('POST', '/api/v1/tokens', { as: user.session, body: { name: 't20' } });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: 'token_limit', message: 'token limit reached' });
    expect(await count('tokens', 'revoked_at IS NULL')).toBe(20);
    await api('DELETE', `/api/v1/tokens/${ids[0]}`, { as: user.session });
    expect(
      (await api('POST', '/api/v1/tokens', { as: user.session, body: { name: 'again' } })).status,
    ).toBe(201);
  });

  it.each([
    { label: 'absent', body: {} },
    { label: 'empty', body: { name: '' } },
    { label: 'only whitespace', body: { name: '   ' } },
    { label: 'longer than 100 characters', body: { name: 'x'.repeat(101) } },
  ])('refuses a name that is $label', async ({ body }) => {
    const user = await signIn();
    const r = await api('POST', '/api/v1/tokens', { as: user.session, body });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('invalid_name');
    expect(r.json.field).toBe('name');
    expect(typeof r.json.message).toBe('string');
    expect(await count('tokens')).toBe(0);
  });

  it('accepts a name of 100 characters', async () => {
    const user = await signIn();
    const r = await api('POST', '/api/v1/tokens', {
      as: user.session,
      body: { name: 'x'.repeat(100) },
    });
    expect(r.status).toBe(201);
  });

  it('is refused to a user who has left the allow-list, keeping their data', async () => {
    const user = await signIn('owner@example.test');
    await seedLinks(user, [{ url: 'https://kept.example' }]);
    env.ALLOWED_EMAILS = '';
    try {
      const r = await api('POST', '/api/v1/tokens', { as: user.session, body: { name: 'late' } });
      expect(r.status).toBe(403);
      expect(r.json.error).toBe('not_allowed');
      expect(typeof r.json.message).toBe('string');
      expect(await count('tokens')).toBe(0);
      expect(await count('links')).toBe(1);
    } finally {
      env.ALLOWED_EMAILS = 'owner@example.test';
    }
  });
});

describe('creating a token with a token', () => {
  it('is refused: only the signed-in owner makes tokens', async () => {
    const user = await signIn();
    const token = await createToken(user);
    const r = await api('POST', '/api/v1/tokens', { bearer: token.secret, body: { name: 'more' } });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('session_required');
    expect(await count('tokens', 'user_id = ?', user.id)).toBe(1);
  });
});

describe('listing tokens', () => {
  it('shows the unrevoked tokens newest first, without their secrets', async () => {
    const user = await signIn();
    setNow('2026-02-01T00:00:00.000Z');
    const a = await api('POST', '/api/v1/tokens', { as: user.session, body: { name: 'a' } });
    setNow('2026-02-02T00:00:00.000Z');
    await api('POST', '/api/v1/tokens', { as: user.session, body: { name: 'b' } });
    setNow('2026-02-03T00:00:00.000Z');
    await api('POST', '/api/v1/tokens', { as: user.session, body: { name: 'c' } });
    await api('DELETE', `/api/v1/tokens/${a.json.id}`, { as: user.session });
    const r = await api('GET', '/api/v1/tokens', { as: user.session });
    expect(r.status).toBe(200);
    expect(r.json.items.map((t: { name: string }) => t.name)).toEqual(['c', 'b']);
    for (const item of r.json.items) {
      expect(Object.keys(item).sort()).toEqual(['created_at', 'id', 'last_used_at', 'name']);
    }
  });
});

describe('a bearer token', () => {
  it('authenticates as its user and records when it was last used', async () => {
    const user = await signIn('owner@example.test', 'Ada Owner');
    const token = await createToken(user);
    const t = '2026-04-01T09:30:00.000Z';
    setNow(t);
    const r = await api('GET', '/api/v1/me', { bearer: token.secret });
    expect(r.status).toBe(200);
    expect(r.json.email).toBe(user.email);
    const list = await api('GET', '/api/v1/tokens', { as: user.session });
    expect(list.json.items[0].last_used_at).toBe(t);
  });

  it('authenticates nothing once revoked', async () => {
    const user = await signIn();
    const token = await createToken(user);
    const r = await api('DELETE', `/api/v1/tokens/${token.id}`, { as: user.session });
    expect(r.status).toBe(204);
    const after = await api('GET', '/api/v1/links', { bearer: token.secret });
    expect(after.status).toBe(401);
    expect(after.json).toEqual({ error: 'unauthorized' });
  });
});

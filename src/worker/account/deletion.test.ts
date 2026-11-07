import { describe, expect, it } from 'vitest';
import {
  api,
  count,
  createToken,
  env,
  recordAccountQueue,
  seedLinks,
  setNow,
  signIn,
  type TestUser,
} from '../test/helpers';
import { googleSignIn } from '../test/google';

/** A user with two sessions, three tokens, an AI key and links. */
async function owner(): Promise<TestUser> {
  const user = await signIn('owner@example.test');
  await signIn('owner@example.test');
  for (let i = 0; i < 3; i++) await createToken(user);
  await env.DB.prepare(
    `UPDATE users SET ai_provider = 'anthropic', ai_model = 'm', ai_key_ciphertext = 'c',
       ai_key_iv = 'iv', ai_key_last4 = '1234', ai_key_status = 'verified' WHERE id = ?`,
  )
    .bind(user.id)
    .run();
  await seedLinks(user, [{ url: 'https://one.example' }, { url: 'https://two.example' }]);
  return user;
}

async function state(user: TestUser) {
  return {
    sessions: await count('sessions', 'user_id = ?', user.id),
    tokens: await count('tokens', 'user_id = ?', user.id),
    links: await count('links', 'user_id = ?', user.id),
    user: await env.DB.prepare(
      'SELECT ai_key_ciphertext, ai_key_last4, deletion_requested_at FROM users WHERE id = ?',
    )
      .bind(user.id)
      .first(),
  };
}

describe('DELETE /api/v1/me', () => {
  it.each(['owner@example.test', '  Owner@Example.TEST '])(
    'with the email %j signs the owner out everywhere and marks the account',
    async (confirm) => {
      const t = '2026-11-07T10:00:00.000Z';
      setNow(t);
      const user = await owner();
      const queue = recordAccountQueue();
      const r = await api('DELETE', '/api/v1/me', {
        as: user.session,
        body: { confirm_email: confirm },
      });
      expect(r.status).toBe(202);
      expect(r.json).toEqual({ status: 'deleting' });
      const cookie = r.headers.getSetCookie().find((c) => c.startsWith('alexandria_session='));
      expect(cookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
      expect(await state(user)).toEqual({
        sessions: 0,
        tokens: 0,
        links: 2,
        user: { ai_key_ciphertext: null, ai_key_last4: null, deletion_requested_at: t },
      });
      expect(queue.map((m) => m.body)).toEqual([{ user_id: user.id }]);
      expect((await api('GET', '/api/v1/me', { as: user.session })).status).toBe(401);
    },
  );

  it.each([
    {},
    { confirm_email: '' },
    { confirm_email: 'other@example.test' },
    { confirm_email: 'owner@example.tes' },
  ])('refuses the confirmation %j and deletes nothing', async (body) => {
    const user = await owner();
    const queue = recordAccountQueue();
    const before = await state(user);
    const r = await api('DELETE', '/api/v1/me', { as: user.session, body });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({
      error: 'confirmation_mismatch',
      field: 'confirm_email',
      message: 'type your email address to confirm',
    });
    expect(await state(user)).toEqual(before);
    expect(queue).toEqual([]);
    expect((await api('GET', '/api/v1/me', { as: user.session })).status).toBe(200);
  });

  it('refuses a personal access token', async () => {
    const user = await owner();
    const token = await createToken(user);
    const queue = recordAccountQueue();
    const r = await api('DELETE', '/api/v1/me', {
      bearer: token.secret,
      body: { confirm_email: user.email },
    });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({
      error: 'session_required',
      message: 'delete the account from the settings page',
    });
    expect((await state(user)).user).toMatchObject({ deletion_requested_at: null });
    expect(queue).toEqual([]);
    expect((await api('GET', '/api/v1/me', { bearer: token.secret })).status).toBe(200);
  });

  it('refuses a sign-in while the account is being deleted', async () => {
    const user = await owner();
    recordAccountQueue();
    await api('DELETE', '/api/v1/me', { as: user.session, body: { confirm_email: user.email } });
    const usersBefore = await count('users');
    const r = await googleSignIn('owner@example.test');
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toBe('/signin?error=deleting');
    expect(
      r.headers
        .getSetCookie()
        .some((c) => c.startsWith('alexandria_session=') && !/Max-Age=0/.test(c)),
    ).toBe(false);
    expect(await count('users')).toBe(usersBefore);
    expect(await count('sessions', 'user_id = ?', user.id)).toBe(0);
  });
});

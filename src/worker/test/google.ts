/**
 * Completes a sign-in with Google through the real routes, Google's token
 * endpoint answered by a fake, for the tests that need a whole sign-in.
 */
import { SELF } from 'cloudflare:test';
import { ORIGIN } from './helpers';
import { onOutbound } from './outbound';

function base64url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Signs `email` in through /auth/google and its callback; returns the callback's answer. */
export async function googleSignIn(email: string, name = 'Ada Owner'): Promise<Response> {
  onOutbound('https://google.test', async () => {
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({
        iss: 'https://accounts.google.com',
        sub: '1234567890',
        email,
        email_verified: true,
        name,
      }),
    );
    return Response.json({
      access_token: 'g-access',
      id_token: `${header}.${claims}.signature`,
      token_type: 'Bearer',
      expires_in: 3599,
      scope: 'openid email profile',
    });
  });
  const started = await SELF.fetch(`${ORIGIN}/auth/google`, { redirect: 'manual' });
  const state = new URL(started.headers.get('Location') ?? '').searchParams.get('state') ?? '';
  const cookie = started.headers
    .getSetCookie()
    .map((h) => h.split(';')[0])
    .join('; ');
  return SELF.fetch(`${ORIGIN}/auth/google/callback?code=c&state=${state}`, {
    redirect: 'manual',
    headers: { Cookie: cookie },
  });
}

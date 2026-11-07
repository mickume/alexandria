import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { onOutbound } from '../test/outbound';
import { count, ORIGIN, seedLinks, signIn } from '../test/helpers';

const GOOGLE = 'https://google.test';

function base64url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function idToken(claims: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  return `${header}.${base64url(JSON.stringify(claims))}.signature`;
}

interface GoogleDouble {
  email: string;
  name: string;
  extraClaims?: Record<string, unknown>;
  accessToken?: string;
  refreshToken?: string;
  /** Answer the exchange with this status and an OAuth error instead. */
  failWith?: number;
}

/** Answers the token endpoint like Google, recording the form it received. */
function google(double: GoogleDouble): { forms: URLSearchParams[]; idToken: () => string } {
  const forms: URLSearchParams[] = [];
  let lastIdToken = '';
  onOutbound(GOOGLE, async (request) => {
    forms.push(new URLSearchParams(await request.text()));
    if (double.failWith) {
      return Response.json({ error: 'invalid_grant' }, { status: double.failWith });
    }
    lastIdToken = idToken({
      iss: 'https://accounts.google.com',
      sub: '1234567890',
      email: double.email,
      email_verified: true,
      name: double.name,
      ...double.extraClaims,
    });
    return Response.json({
      access_token: double.accessToken ?? 'g-access',
      refresh_token: double.refreshToken ?? 'g-refresh',
      id_token: lastIdToken,
      token_type: 'Bearer',
      expires_in: 3599,
      scope: 'openid email profile',
    });
  });
  return { forms, idToken: () => lastIdToken };
}

function cookiesOf(response: Response): Map<string, string> {
  const map = new Map<string, string>();
  for (const header of response.headers.getSetCookie()) {
    const [pair = ''] = header.split(';');
    const i = pair.indexOf('=');
    map.set(pair.slice(0, i), header);
  }
  return map;
}

function cookieValue(header: string | undefined): string {
  const pair = header?.split(';')[0] ?? '';
  return pair.slice(pair.indexOf('=') + 1);
}

/** Starts a sign-in and returns its state and the cookies the browser would hold. */
async function start(): Promise<{
  state: string;
  cookie: string;
  location: URL;
  response: Response;
}> {
  const response = await SELF.fetch(`${ORIGIN}/auth/google`, { redirect: 'manual' });
  const location = new URL(response.headers.get('Location') ?? '');
  const cookie = response.headers
    .getSetCookie()
    .map((h) => h.split(';')[0])
    .join('; ');
  return { state: location.searchParams.get('state') ?? '', cookie, location, response };
}

async function callback(query: string, cookie: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/auth/google/callback?${query}`, {
    redirect: 'manual',
    headers: { Cookie: cookie },
  });
}

async function rowCounts(): Promise<{ users: number; sessions: number }> {
  return { users: await count('users'), sessions: await count('sessions') };
}

describe('starting a sign-in', () => {
  it('redirects to Google with a fresh state, an S256 challenge and short-lived cookies', async () => {
    const { response, location, state } = await start();
    expect(response.status).toBe(302);
    expect(location.href.startsWith(env.GOOGLE_AUTH_URL)).toBe(true);
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('client_id')).toBe(env.GOOGLE_CLIENT_ID);
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/google/callback`);
    expect(location.searchParams.get('scope')).toBe('openid email profile');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toBeTruthy();
    expect(state).toBeTruthy();

    const cookies = [...cookiesOf(response).values()];
    expect(cookies).toHaveLength(2);
    expect(cookies.map(cookieValue)).toContain(state);
    for (const c of cookies) {
      expect(c).toMatch(/HttpOnly/i);
      expect(c).toMatch(/Max-Age=600/);
    }
    const second = await start();
    expect(second.state).not.toBe(state);
  });
});

describe('completing a sign-in', () => {
  it.each([
    { label: 'first sign-in', names: ['Ada Owner'] },
    { label: 'later sign-in with a new name', names: ['Ada Owner', 'Ada O.'] },
  ])('creates or updates the user and a session on a $label', async ({ names }) => {
    for (const name of names) {
      const double = google({ email: 'owner@example.test', name });
      const s = await start();
      const r = await callback(`code=c&state=${s.state}`, s.cookie);
      expect(r.status).toBe(302);
      expect(r.headers.get('Location')).toBe('/');
      const session = cookiesOf(r).get('alexandria_session') ?? '';
      expect(session).toMatch(/HttpOnly/i);
      expect(session).toMatch(/Secure/i);
      expect(session).toMatch(/SameSite=Lax/i);
      expect(session).toMatch(/Path=\//);
      expect(session).toMatch(/Max-Age=2592000/);
      expect(double.forms[0]?.get('code_verifier')).toBeTruthy();
      expect(double.forms[0]?.get('code')).toBe('c');
    }
    const users = await env.DB.prepare('SELECT email, name FROM users WHERE email = ?')
      .bind('owner@example.test')
      .all();
    expect(users.results).toEqual([{ email: 'owner@example.test', name: names.at(-1) }]);
  });

  it('keeps only the email and the display name from Google', async () => {
    const double = google({
      email: 'owner@example.test',
      name: 'Ada Owner',
      accessToken: 'g-access-123',
      refreshToken: 'g-refresh-456',
      extraClaims: { picture: 'https://pics.test/ada.png', locale: 'en-GB-x-test' },
    });
    const s = await start();
    const r = await callback(`code=c&state=${s.state}`, s.cookie);
    expect(r.status).toBe(302);

    const forbidden = [
      'g-access-123',
      'g-refresh-456',
      double.idToken(),
      'https://pics.test/ada.png',
      'en-GB-x-test',
    ];
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
    ).all<{ name: string }>();
    for (const { name } of tables.results) {
      const rows = await env.DB.prepare(`SELECT * FROM ${name}`).all();
      for (const row of rows.results) {
        for (const value of Object.values(row)) {
          for (const f of forbidden) expect(String(value)).not.toContain(f);
        }
      }
    }
  });

  it.each([
    { label: 'an address not on the allow-list', removeOwner: false },
    { label: 'an existing user removed from the allow-list', removeOwner: true },
  ])('refuses $label, creating nothing', async ({ removeOwner }) => {
    let email = 'stranger@example.test';
    if (removeOwner) {
      const owner = await signIn('owner@example.test');
      await seedLinks(owner, [{ url: 'https://kept.example' }]);
      email = owner.email;
    }
    google({ email, name: 'Someone' });
    const s = await start();
    if (removeOwner) env.ALLOWED_EMAILS = 'someone-else@example.test';
    const before = await rowCounts();
    try {
      const r = await callback(`code=c&state=${s.state}`, s.cookie);
      expect(r.status).toBe(302);
      expect(r.headers.get('Location')).toBe('/signin?error=private');
      expect(cookiesOf(r).has('alexandria_session')).toBe(false);
      expect(await rowCounts()).toEqual(before);
      if (removeOwner) expect(await count('links')).toBe(1);
    } finally {
      env.ALLOWED_EMAILS = 'owner@example.test';
    }
  });

  it.each([
    {
      label: 'an error from Google',
      query: (s: string) => `error=access_denied&state=${s}`,
      fail: 0,
      cookie: true,
    },
    { label: 'a missing state', query: () => 'code=c', fail: 0, cookie: true },
    {
      label: 'a state that differs from its cookie',
      query: () => 'code=c&state=x',
      fail: 0,
      cookie: true,
    },
    { label: 'no state cookie', query: (s: string) => `code=c&state=${s}`, fail: 0, cookie: false },
    {
      label: 'a rejected code exchange',
      query: (s: string) => `code=c&state=${s}`,
      fail: 400,
      cookie: true,
    },
  ])('refuses $label, creating nothing', async ({ query, fail, cookie }) => {
    google({ email: 'owner@example.test', name: 'Ada Owner', failWith: fail || undefined });
    const s = await start();
    const before = await rowCounts();
    const r = await callback(query(s.state), cookie ? s.cookie : '');
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toBe('/signin?error=failed');
    expect(cookiesOf(r).has('alexandria_session')).toBe(false);
    expect(await rowCounts()).toEqual(before);
  });

  it.each([
    { allowed: ' Owner@Example.test , b@x.test', email: 'owner@example.TEST', ok: true },
    { allowed: 'b@x.test', email: 'owner@example.test', ok: false },
    { allowed: '', email: 'owner@example.test', ok: false },
  ])(
    'reads the allow-list $allowed for $email case-insensitively',
    async ({ allowed, email, ok }) => {
      env.ALLOWED_EMAILS = allowed;
      try {
        google({ email, name: 'Ada Owner' });
        const s = await start();
        const r = await callback(`code=c&state=${s.state}`, s.cookie);
        expect(r.headers.get('Location')).toBe(ok ? '/' : '/signin?error=private');
      } finally {
        env.ALLOWED_EMAILS = 'owner@example.test';
      }
    },
  );

  it('follows a change of the allow-list between two sign-ins', async () => {
    try {
      google({ email: 'owner@example.test', name: 'Ada Owner' });
      let s = await start();
      expect((await callback(`code=c&state=${s.state}`, s.cookie)).headers.get('Location')).toBe(
        '/',
      );
      env.ALLOWED_EMAILS = 'other@example.test';
      s = await start();
      expect((await callback(`code=c&state=${s.state}`, s.cookie)).headers.get('Location')).toBe(
        '/signin?error=private',
      );
    } finally {
      env.ALLOWED_EMAILS = 'owner@example.test';
    }
  });
});

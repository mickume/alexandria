/**
 * A local fake of Google's OAuth 2.0 / OpenID Connect endpoints for the
 * end-to-end tests. The authorization endpoint signs in one configured account
 * at once (FAKE_GOOGLE_EMAIL, FAKE_GOOGLE_NAME); the token endpoint checks the
 * code and the PKCE verifier as Google does and answers with an ID token.
 *
 * Run with: node e2e/fake-google.ts <port>
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const port = Number(process.argv[2] ?? 8790);
const email = process.env.FAKE_GOOGLE_EMAIL ?? 'owner@example.test';
const name = process.env.FAKE_GOOGLE_NAME ?? 'Ada Owner';

interface Grant {
  challenge: string;
  clientId: string;
  redirectUri: string;
}

const grants = new Map<string, Grant>();

function base64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function idToken(clientId: string): string {
  const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: clientId,
      sub: 'fake-google-1',
      email,
      email_verified: true,
      name,
      iat: now,
      exp: now + 3600,
    }),
  );
  return `${header}.${payload}.fake`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  if (url.pathname === '/health') {
    res.end('ok');
    return;
  }
  if (req.method === 'GET' && url.pathname === '/auth') {
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    const challenge = url.searchParams.get('code_challenge') ?? '';
    if (url.searchParams.get('code_challenge_method') !== 'S256' || !challenge || !redirectUri) {
      json(res, 400, { error: 'invalid_request' });
      return;
    }
    const code = base64url(randomBytes(16));
    grants.set(code, {
      challenge,
      clientId: url.searchParams.get('client_id') ?? '',
      redirectUri,
    });
    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    target.searchParams.set('state', url.searchParams.get('state') ?? '');
    res.writeHead(302, { Location: target.toString() });
    res.end();
    return;
  }
  if (req.method === 'POST' && url.pathname === '/token') {
    const form = new URLSearchParams(await readBody(req));
    const grant = grants.get(form.get('code') ?? '');
    const verifier = form.get('code_verifier') ?? '';
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    if (!grant || grant.challenge !== challenge || grant.redirectUri !== form.get('redirect_uri')) {
      json(res, 400, { error: 'invalid_grant' });
      return;
    }
    grants.delete(form.get('code') ?? '');
    json(res, 200, {
      access_token: `fake-access-${base64url(randomBytes(8))}`,
      refresh_token: `fake-refresh-${base64url(randomBytes(8))}`,
      id_token: idToken(grant.clientId),
      token_type: 'Bearer',
      expires_in: 3599,
      scope: 'openid email profile',
    });
    return;
  }
  json(res, 404, { error: 'not_found' });
});

server.listen(port, () => {
  console.log(`fake Google listening on http://localhost:${port}`);
});

/**
 * Shared helpers of the Worker tests: requests through the real Worker,
 * signed-in users, tokens, seeded links and the clock.
 */
import { env, SELF } from 'cloudflare:test';
import { sha256Hex } from '../auth/crypto';
import { setNow as setClock } from '../clock';

export { sha256Hex };

export { env };

/** The origin the tests' requests come from. */
export const ORIGIN = 'https://alexandria.test';

/** Fixes the application's clock. */
export function setNow(t: Date | number | string): void {
  setClock(typeof t === 'string' ? new Date(t) : t);
}

/** A response with its parsed JSON body, when it has one. */
export interface ApiResponse {
  status: number;
  headers: Headers;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  response: Response;
}

/** How a test request authenticates and what it sends. */
export interface ApiOptions {
  /** A session cookie value (as signIn returns), sent as alexandria_session. */
  as?: string;
  /** A personal access token secret, sent as a bearer token. */
  bearer?: string;
  /** The Origin header; defaults to the site's own origin when `as` is given. */
  origin?: string | null;
  /** A JSON body, or a raw string body. */
  body?: unknown;
  headers?: Record<string, string>;
}

/** Sends a request through the Worker, as a browser or a script would. */
export async function api(
  method: string,
  path: string,
  opts: ApiOptions = {},
): Promise<ApiResponse> {
  const headers = new Headers(opts.headers);
  if (opts.as !== undefined) {
    headers.set('Cookie', `alexandria_session=${opts.as}`);
    const origin = opts.origin === undefined ? ORIGIN : opts.origin;
    if (origin !== null) headers.set('Origin', origin);
  } else if (opts.origin) {
    headers.set('Origin', opts.origin);
  }
  if (opts.bearer !== undefined) headers.set('Authorization', `Bearer ${opts.bearer}`);
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    headers.set('Content-Type', 'application/json');
  }
  const response = await SELF.fetch(new URL(path, ORIGIN), {
    method,
    headers,
    body,
    redirect: 'manual',
  });
  const text = await response.clone().text();
  let json: unknown = null;
  if (text && response.headers.get('Content-Type')?.includes('application/json')) {
    json = JSON.parse(text);
  }
  return { status: response.status, headers: response.headers, json, response };
}

/** Counts the rows of a table, optionally filtered by a WHERE clause. */
export async function count(table: string, where = '1 = 1', ...params: unknown[]): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)
    .bind(...params)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** A user stored for a test. */
export interface TestUser {
  id: string;
  email: string;
  name: string;
  /** The session cookie value of the user's session. */
  session: string;
}

/**
 * Stores a user with a fresh 30-day session, as a completed sign-in leaves it,
 * and returns the user with the session cookie value.
 */
export async function signIn(email = 'owner@example.test', name = 'Ada Owner'): Promise<TestUser> {
  const nowIso = new Date().toISOString();
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  if (!existing) {
    await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, email.toLowerCase(), name, nowIso)
      .run();
  }
  const session = randomSecret();
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(await sha256Hex(session), id, nowIso, expires)
    .run();
  return { id, email: email.toLowerCase(), name, session };
}

/** Stores a personal access token for `user` and returns its id and secret. */
export async function createToken(
  user: TestUser,
  name = 'test token',
): Promise<{ id: string; secret: string }> {
  const id = crypto.randomUUID();
  const secret = `alx_${randomSecret()}`;
  await env.DB.prepare(
    'INSERT INTO tokens (id, user_id, name, secret_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, user.id, name, await sha256Hex(secret), new Date().toISOString())
    .run();
  return { id, secret };
}

/** A link to seed directly into the store. */
export interface SeedLink {
  url: string;
  lastUsedAt?: string;
  addedAt?: string;
  state?: string;
  pinPosition?: number | null;
  useCount?: number;
}

/** Stores links for `user` directly, bypassing the API, and returns their ids in order. */
export async function seedLinks(user: TestUser, links: SeedLink[]): Promise<string[]> {
  const ids: string[] = [];
  const statements: D1PreparedStatement[] = [];
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  links.forEach((l, i) => {
    const id = crypto.randomUUID();
    ids.push(id);
    const host = new URL(l.url).host;
    const at = l.lastUsedAt ?? new Date(base + i * 1000).toISOString();
    statements.push(
      env.DB.prepare(
        `INSERT INTO links (id, user_id, url, original_url, host, title, state, added_at,
           last_used_at, use_count, pin_position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        user.id,
        l.url,
        l.url,
        host,
        host,
        l.state ?? 'pending',
        l.addedAt ?? at,
        at,
        l.useCount ?? 0,
        l.pinPosition ?? null,
      ),
    );
  });
  for (let i = 0; i < statements.length; i += 500) {
    await env.DB.batch(statements.slice(i, i + 500));
  }
  return ids;
}

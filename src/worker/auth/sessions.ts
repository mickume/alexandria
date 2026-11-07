import { now } from '../clock';
import { randomToken, sha256Hex } from './crypto';

/** The cookie that carries the website's session. */
export const SESSION_COOKIE = 'alexandria_session';

/** A session lasts this long after its last use. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Creates the user on first sign-in, or updates the stored display name, and returns the user's id. */
export async function upsertUser(db: D1Database, email: string, name: string): Promise<string> {
  const row = await db
    .prepare(
      `INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE SET name = excluded.name
       RETURNING id`,
    )
    .bind(crypto.randomUUID(), email, name, now().toISOString())
    .first<{ id: string }>();
  if (!row) throw new Error('user upsert returned no row');
  return row.id;
}

/** Creates a session for `userId` and returns its identifier, which is stored only as a hash. */
export async function createSession(db: D1Database, userId: string): Promise<string> {
  const id = randomToken();
  const t = now();
  await db
    .prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(id), userId, t.toISOString(), expiry(t))
    .run();
  return id;
}

function expiry(from: Date): string {
  return new Date(from.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
}

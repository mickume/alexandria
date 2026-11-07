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

/**
 * Finds the user of an unexpired session and moves its expiry to SESSION_TTL
 * after now. An expired session is deleted. Returns null when the identifier
 * names no live session.
 */
export async function useSession(
  db: D1Database,
  id: string,
): Promise<{ id: string; email: string; name: string } | null> {
  const hash = await sha256Hex(id);
  const t = now();
  const row = await db
    .prepare(
      `UPDATE sessions SET expires_at = ?2
       WHERE id_hash = ?1 AND expires_at > ?3
       RETURNING user_id`,
    )
    .bind(hash, expiry(t), t.toISOString())
    .first<{ user_id: string }>();
  if (!row) {
    await db
      .prepare('DELETE FROM sessions WHERE id_hash = ? AND expires_at <= ?')
      .bind(hash, t.toISOString())
      .run();
    return null;
  }
  return db
    .prepare('SELECT id, email, name FROM users WHERE id = ?')
    .bind(row.user_id)
    .first<{ id: string; email: string; name: string }>();
}

/** Ends a session at once. */
export async function deleteSession(db: D1Database, id: string): Promise<void> {
  await db
    .prepare('DELETE FROM sessions WHERE id_hash = ?')
    .bind(await sha256Hex(id))
    .run();
}

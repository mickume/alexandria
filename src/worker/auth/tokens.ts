import { now } from '../clock';
import type { AuthUser } from '../env';
import { randomToken, sha256Hex } from './crypto';

/** The most unrevoked tokens one user may hold. */
export const TOKEN_LIMIT = 20;
/** The longest token name, in characters. */
export const TOKEN_NAME_MAX = 100;
/** Every secret starts with this, so that a leaked one is recognisable. */
export const SECRET_PREFIX = 'alx_';

/** A token as the API shows it: never with its secret. */
export interface TokenView {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

/** Validates a token name: 1 to 100 characters once trimmed. Returns the trimmed name or null. */
export function validTokenName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= TOKEN_NAME_MAX ? trimmed : null;
}

/**
 * Creates a token for `userId` and returns it with its secret, which is shown
 * this once and stored only as its SHA-256 hash. Returns null when the user
 * already holds TOKEN_LIMIT unrevoked tokens.
 */
export async function createToken(
  db: D1Database,
  userId: string,
  name: string,
): Promise<(TokenView & { secret: string }) | null> {
  const id = crypto.randomUUID();
  const secret = `${SECRET_PREFIX}${randomToken(32)}`;
  const createdAt = now().toISOString();
  // The insert happens only while the user is under the limit, in one statement.
  const result = await db
    .prepare(
      `INSERT INTO tokens (id, user_id, name, secret_hash, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5
       WHERE (SELECT COUNT(*) FROM tokens WHERE user_id = ?2 AND revoked_at IS NULL) < ?6`,
    )
    .bind(id, userId, name, await sha256Hex(secret), createdAt, TOKEN_LIMIT)
    .run();
  if (result.meta.changes === 0) return null;
  return { id, name, created_at: createdAt, last_used_at: null, secret };
}

/** The user's unrevoked tokens, newest first. */
export async function listTokens(db: D1Database, userId: string): Promise<TokenView[]> {
  const rows = await db
    .prepare(
      `SELECT id, name, created_at, last_used_at FROM tokens
       WHERE user_id = ? AND revoked_at IS NULL
       ORDER BY created_at DESC, rowid DESC`,
    )
    .bind(userId)
    .all<TokenView>();
  return rows.results;
}

/** Revokes one of the user's tokens. Returns false when the user has no such unrevoked token. */
export async function revokeToken(db: D1Database, userId: string, id: string): Promise<boolean> {
  const result = await db
    .prepare('UPDATE tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(now().toISOString(), id, userId)
    .run();
  return result.meta.changes > 0;
}

/** The user an unrevoked token's secret authenticates, recording its use; null otherwise. */
export async function useToken(db: D1Database, secret: string): Promise<AuthUser | null> {
  if (!secret.startsWith(SECRET_PREFIX)) return null;
  const row = await db
    .prepare(
      `UPDATE tokens SET last_used_at = ? WHERE secret_hash = ? AND revoked_at IS NULL
       RETURNING user_id`,
    )
    .bind(now().toISOString(), await sha256Hex(secret))
    .first<{ user_id: string }>();
  if (!row) return null;
  return db
    .prepare('SELECT id, email, name FROM users WHERE id = ?')
    .bind(row.user_id)
    .first<AuthUser>();
}

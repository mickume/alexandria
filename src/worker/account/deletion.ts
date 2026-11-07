/** Account deletion: the owner's request, and the guard that stops work for a deleted account. */
import type { Context } from 'hono';
import { readJson, refusal, validationError } from '../api/errors';
import { SESSION_COOKIE } from '../auth/sessions';
import { now } from '../clock';
import type { AppEnv } from '../env';

/**
 * Whether the account with this email is marked for deletion: a sign-in for
 * it is refused until the deletion job has removed it.
 */
export async function beingDeleted(db: D1Database, email: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM users WHERE email = ? AND deletion_requested_at IS NOT NULL')
    .bind(email.toLowerCase())
    .first();
  return row !== null;
}

/**
 * DELETE /api/v1/me: the owner, signed in with a session, deletes the account
 * by typing its email (compared ignoring case and surrounding whitespace).
 * Every session and token and the AI key go at once, the account is marked
 * and its deletion job queued; the session cookie is cleared.
 */
export async function requestDeletion(c: Context<AppEnv>): Promise<Response> {
  if (c.get('via') !== 'session') {
    return refusal(c, 403, 'session_required', 'delete the account from the settings page');
  }
  const parsed = await readJson(c, { optional: true });
  if (!parsed.ok) return parsed.response;
  const user = c.get('user');
  const typed = parsed.body.confirm_email;
  if (typeof typed !== 'string' || typed.trim().toLowerCase() !== user.email.toLowerCase()) {
    return validationError(
      c,
      'confirmation_mismatch',
      'confirm_email',
      'type your email address to confirm',
    );
  }
  const db = c.env.DB;
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM tokens WHERE user_id = ?').bind(user.id),
    db
      .prepare(
        `UPDATE users SET ai_provider = NULL, ai_model = NULL, ai_key_ciphertext = NULL,
           ai_key_iv = NULL, ai_key_last4 = NULL, ai_key_status = NULL,
           ai_key_rejected_message = NULL, deletion_requested_at = ?
         WHERE id = ?`,
      )
      .bind(now().toISOString(), user.id),
  ]);
  await c.env.ACCOUNT_QUEUE.send({ user_id: user.id });
  // Replaces the renewal the authentication set: the browser drops the cookie.
  c.header('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
  return c.json({ status: 'deleting' }, 202);
}

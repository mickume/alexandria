/** Account deletion: the owner's request, and the guard that stops work for a deleted account. */
import type { Context } from 'hono';
import { readJson, refusal, validationError } from '../api/errors';
import { SESSION_COOKIE } from '../auth/sessions';
import { now } from '../clock';
import type { AccountMessage, AppEnv, Env } from '../env';

/**
 * Whether background work may run for this account: it exists and is not
 * marked for deletion. Fetch, enrichment, import, liveness and decay work
 * for any other account writes nothing and calls no one.
 */
export async function accountActive(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM users WHERE id = ? AND deletion_requested_at IS NULL')
    .bind(userId)
    .first();
  return row !== null;
}

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
           ai_key_rejected_message = NULL, firecrawl_key_ciphertext = NULL,
           firecrawl_key_iv = NULL, firecrawl_key_last4 = NULL, firecrawl_key_status = NULL,
           firecrawl_key_rejected_message = NULL, deletion_requested_at = ?
         WHERE id = ?`,
      )
      .bind(now().toISOString(), user.id),
  ]);
  await c.env.ACCOUNT_QUEUE.send({ user_id: user.id });
  // Replaces the renewal the authentication set: the browser drops the cookie.
  c.header('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
  return c.json({ status: 'deleting' }, 202);
}

/** Test hooks of the deletion job: told the size of every batch it deletes. */
export const deletionHooks = { onBatch: (_size: number): void => undefined };

/** The most rows one statement, or objects one R2 call, of the deletion job removes. */
export const DELETION_BATCH = 1_000;

/** The tables that hold rows of a user: by user_id, or by link_id through the user's links. */
interface Owned {
  name: string;
  byLink: boolean;
}

/**
 * The tables holding a user's rows, found from the schema: every table with
 * a link_id or a user_id column, except the users and links tables
 * themselves, full-text tables and tables that triggers keep (their rows go
 * with the rows the triggers follow). Link-referencing tables come first.
 */
async function ownedTables(db: D1Database): Promise<Owned[]> {
  const rows = await db
    .prepare(
      `SELECT m.name,
         EXISTS (SELECT 1 FROM pragma_table_info(m.name) WHERE name = 'link_id') AS by_link,
         EXISTS (SELECT 1 FROM pragma_table_info(m.name) WHERE name = 'user_id') AS by_user
       FROM sqlite_master m
       WHERE m.type = 'table' AND m.name NOT IN ('users', 'links', 'd1_migrations')
         AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%'
         AND m.sql NOT LIKE 'CREATE VIRTUAL TABLE%' AND m.sql NOT LIKE 'CREATE TABLE ''%'
         AND NOT EXISTS (SELECT 1 FROM sqlite_master t WHERE t.type = 'trigger'
                         AND t.sql LIKE '%INSERT INTO ' || m.name || ' %')
       ORDER BY m.name`,
    )
    .all<{ name: string; by_link: number; by_user: number }>();
  const owned = rows.results.filter((r) => r.by_link || r.by_user);
  return [
    ...owned.filter((r) => r.by_link).map((r) => ({ name: r.name, byLink: true })),
    ...owned.filter((r) => !r.by_link).map((r) => ({ name: r.name, byLink: false })),
  ];
}

/**
 * Deletes at most one batch of a table's rows of the user; whether a full
 * batch went. The rows are counted from RETURNING: the index rows that
 * triggers remove with a link are not part of the batch.
 */
async function deleteBatch(db: D1Database, sql: string, userId: string): Promise<boolean> {
  const result = await db.prepare(`${sql} RETURNING 1 AS gone`).bind(userId, DELETION_BATCH).all();
  const n = result.results.length;
  if (n > 0) deletionHooks.onBatch(n);
  return n >= DELETION_BATCH;
}

/** Deletes at most one batch of the user's stored objects; whether more may remain. */
async function deleteObjects(env: Env, userId: string): Promise<boolean> {
  const page = await env.SNAPSHOTS.list({ prefix: `u/${userId}/`, limit: DELETION_BATCH });
  if (page.objects.length === 0) return false;
  await env.SNAPSHOTS.delete(page.objects.map((o) => o.key));
  deletionHooks.onBatch(page.objects.length);
  return page.truncated;
}

/**
 * One run of an account's deletion job: one batch of its stored objects, then
 * one batch from each table holding its rows (rows referencing its links
 * first, then its links, then the rest), and, when nothing is left, the user
 * row. 'more' when the run should be followed by another; 'done' when the
 * account is gone; 'skipped' when there is no account marked for deletion
 * with this id (already removed, or never marked).
 */
export async function runDeletion(env: Env, userId: string): Promise<'more' | 'done' | 'skipped'> {
  const db = env.DB;
  const marked = await db
    .prepare('SELECT 1 FROM users WHERE id = ? AND deletion_requested_at IS NOT NULL')
    .bind(userId)
    .first();
  if (!marked) return 'skipped';
  let more = await deleteObjects(env, userId);
  const tables = await ownedTables(db);
  let linkRowsLeft = false;
  for (const t of tables.filter((x) => x.byLink)) {
    const sql = `DELETE FROM ${t.name} WHERE rowid IN (SELECT x.rowid FROM ${t.name} x
                 JOIN links l ON l.id = x.link_id WHERE l.user_id = ?1 LIMIT ?2)`;
    if (await deleteBatch(db, sql, userId)) linkRowsLeft = true;
  }
  more ||= linkRowsLeft;
  // The links go once nothing referencing them is left.
  if (!linkRowsLeft) {
    const links =
      'DELETE FROM links WHERE rowid IN (SELECT rowid FROM links WHERE user_id = ?1 LIMIT ?2)';
    if (await deleteBatch(db, links, userId)) more = true;
  }
  for (const t of tables.filter((x) => !x.byLink)) {
    const sql = `DELETE FROM ${t.name} WHERE rowid IN (SELECT rowid FROM ${t.name} WHERE user_id = ?1 LIMIT ?2)`;
    if (await deleteBatch(db, sql, userId)) more = true;
  }
  if (more) return 'more';
  const left = await db
    .prepare('SELECT 1 FROM links WHERE user_id = ? LIMIT 1')
    .bind(userId)
    .first();
  if (left) return 'more';
  await db
    .prepare('DELETE FROM users WHERE id = ? AND deletion_requested_at IS NOT NULL')
    .bind(userId)
    .run();
  return 'done';
}

/** Runs the deletion job once for the account and queues the next run when one is needed. */
export async function continueDeletion(env: Env, userId: string): Promise<void> {
  if ((await runDeletion(env, userId)) === 'more') {
    await env.ACCOUNT_QUEUE.send({ user_id: userId });
  }
}

/**
 * The ACCOUNT_QUEUE consumer: one run of the job per message. A failed run is
 * retried and continues with what remains; what it removed stays removed.
 */
export async function handleAccountBatch(
  batch: MessageBatch<AccountMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await continueDeletion(env, message.body.user_id);
      message.ack();
    } catch (err) {
      console.error('an account deletion run failed', err);
      message.retry();
    }
  }
}

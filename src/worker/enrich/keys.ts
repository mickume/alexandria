import type { Env } from '../env';

/** The providers a user can choose. */
export type Provider = 'anthropic' | 'openrouter';

/** The model used with Anthropic when the user names none. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

/** The AES-256-GCM key derived from the deployment secret KEY_ENCRYPTION_KEY. */
async function encryptionKey(env: Env): Promise<CryptoKey> {
  if (!env.KEY_ENCRYPTION_KEY) throw new Error('KEY_ENCRYPTION_KEY is not set');
  const raw = await crypto.subtle.digest('SHA-256', encoder.encode(env.KEY_ENCRYPTION_KEY));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * Encrypts a user's API key (for an AI provider or Firecrawl) with AES-GCM
 * under KEY_ENCRYPTION_KEY, with a fresh IV and the user's id as additional
 * data, so that a ciphertext copied to another user's row does not decrypt.
 */
export async function encryptKey(
  env: Env,
  key: string,
  userId: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(userId) },
    await encryptionKey(env),
    encoder.encode(key),
  );
  return { ciphertext: toBase64(new Uint8Array(sealed)), iv: toBase64(iv) };
}

/** Decrypts a user's API key; throws when it was sealed for another user or under another secret. */
export async function decryptKey(
  env: Env,
  ciphertext: string,
  iv: string,
  userId: string,
): Promise<string> {
  const opened = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv), additionalData: encoder.encode(userId) },
    await encryptionKey(env),
    fromBase64(ciphertext),
  );
  return new TextDecoder().decode(opened);
}

/** A key a user stored: encrypted, with its last 4 characters and whether its service still takes it. */
export interface StoredKey {
  ciphertext: string;
  iv: string;
  last4: string;
  status: 'verified' | 'rejected';
  rejectedMessage: string | null;
}

/** The users columns a stored key is kept in: `ai_key_…` or `firecrawl_key_…`. */
export type KeyColumns = 'ai_key' | 'firecrawl_key';

const KEY_FIELDS = ['ciphertext', 'iv', 'last4', 'status', 'rejected_message'] as const;

/**
 * The user's key stored under `columns`, with the `extra` users columns read
 * beside it, or null when none is stored.
 */
export async function getStoredKey(
  db: D1Database,
  userId: string,
  columns: KeyColumns,
  extra: string[] = [],
): Promise<{ key: StoredKey; row: Record<string, string | null> } | null> {
  const names = [...KEY_FIELDS.map((f) => `${columns}_${f}`), ...extra];
  const row = await db
    .prepare(`SELECT ${names.join(', ')} FROM users WHERE id = ?`)
    .bind(userId)
    .first<Record<string, string | null>>();
  const ciphertext = row?.[`${columns}_ciphertext`];
  const iv = row?.[`${columns}_iv`];
  if (!row || !ciphertext || !iv) return null;
  return {
    row,
    key: {
      ciphertext,
      iv,
      last4: row[`${columns}_last4`] ?? '',
      status: row[`${columns}_status`] === 'rejected' ? 'rejected' : 'verified',
      rejectedMessage: row[`${columns}_rejected_message`] ?? null,
    },
  };
}

/**
 * Stores a verified key under `columns`, replacing any earlier one and lifting
 * a rejection, and sets the `extra` users columns with it.
 */
export async function saveStoredKey(
  env: Env,
  userId: string,
  columns: KeyColumns,
  key: string,
  extra: Record<string, string> = {},
): Promise<void> {
  const { ciphertext, iv } = await encryptKey(env, key, userId);
  const set = Object.keys(extra).map((name) => `${name} = ?, `);
  await env.DB.prepare(
    `UPDATE users SET ${set.join('')}${columns}_ciphertext = ?, ${columns}_iv = ?,
       ${columns}_last4 = ?, ${columns}_status = 'verified', ${columns}_rejected_message = NULL
     WHERE id = ?`,
  )
    .bind(...Object.values(extra), ciphertext, iv, key.slice(-4), userId)
    .run();
}

/** Forgets the user's key stored under `columns`, and the `extra` users columns with it. */
export async function clearStoredKey(
  db: D1Database,
  userId: string,
  columns: KeyColumns,
  extra: string[] = [],
): Promise<void> {
  const names = [...KEY_FIELDS.map((f) => `${columns}_${f}`), ...extra];
  await db
    .prepare(`UPDATE users SET ${names.map((n) => `${n} = NULL`).join(', ')} WHERE id = ?`)
    .bind(userId)
    .run();
}

/** Marks the user's key under `columns` as rejected by its service, with the service's message. */
export async function markStoredKeyRejected(
  db: D1Database,
  userId: string,
  columns: KeyColumns,
  message: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE users SET ${columns}_status = 'rejected', ${columns}_rejected_message = ?
       WHERE id = ? AND ${columns}_ciphertext IS NOT NULL`,
    )
    .bind(message, userId)
    .run();
}

/** A user's stored AI settings. */
export interface AiSettings extends StoredKey {
  provider: Provider;
  model: string;
}

/** The user's AI settings, or null when no key is stored. */
export async function getAiSettings(db: D1Database, userId: string): Promise<AiSettings | null> {
  const stored = await getStoredKey(db, userId, 'ai_key', ['ai_provider', 'ai_model']);
  if (!stored?.row.ai_provider) return null;
  return {
    ...stored.key,
    provider: stored.row.ai_provider as Provider,
    model: stored.row.ai_model ?? DEFAULT_ANTHROPIC_MODEL,
  };
}

/** Stores a verified key, replacing any earlier settings and lifting a rejection. */
export function saveAiSettings(
  env: Env,
  userId: string,
  provider: Provider,
  model: string,
  key: string,
): Promise<void> {
  return saveStoredKey(env, userId, 'ai_key', key, { ai_provider: provider, ai_model: model });
}

/** Forgets the user's provider, model and key. */
export function clearAiSettings(db: D1Database, userId: string): Promise<void> {
  return clearStoredKey(db, userId, 'ai_key', ['ai_provider', 'ai_model']);
}

/** Marks the user's key as rejected by the provider, pausing their enrichment. */
export function markKeyRejected(db: D1Database, userId: string, message: string): Promise<void> {
  return markStoredKeyRejected(db, userId, 'ai_key', message);
}

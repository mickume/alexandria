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

/** A user's stored AI settings. */
export interface AiSettings {
  provider: Provider;
  model: string;
  ciphertext: string;
  iv: string;
  last4: string;
  status: 'verified' | 'rejected';
  rejectedMessage: string | null;
}

/** The user's AI settings, or null when no key is stored. */
export async function getAiSettings(db: D1Database, userId: string): Promise<AiSettings | null> {
  const row = await db
    .prepare(
      `SELECT ai_provider, ai_model, ai_key_ciphertext, ai_key_iv, ai_key_last4, ai_key_status,
         ai_key_rejected_message FROM users WHERE id = ?`,
    )
    .bind(userId)
    .first<Record<string, string | null>>();
  if (!row?.ai_key_ciphertext || !row.ai_key_iv || !row.ai_provider) return null;
  return {
    provider: row.ai_provider as Provider,
    model: row.ai_model ?? DEFAULT_ANTHROPIC_MODEL,
    ciphertext: row.ai_key_ciphertext,
    iv: row.ai_key_iv,
    last4: row.ai_key_last4 ?? '',
    status: row.ai_key_status === 'rejected' ? 'rejected' : 'verified',
    rejectedMessage: row.ai_key_rejected_message ?? null,
  };
}

/** Stores a verified key, replacing any earlier settings and lifting a rejection. */
export async function saveAiSettings(
  env: Env,
  userId: string,
  provider: Provider,
  model: string,
  key: string,
): Promise<void> {
  const { ciphertext, iv } = await encryptKey(env, key, userId);
  await env.DB.prepare(
    `UPDATE users SET ai_provider = ?, ai_model = ?, ai_key_ciphertext = ?, ai_key_iv = ?,
       ai_key_last4 = ?, ai_key_status = 'verified', ai_key_rejected_message = NULL
     WHERE id = ?`,
  )
    .bind(provider, model, ciphertext, iv, key.slice(-4), userId)
    .run();
}

/** Forgets the user's provider, model and key. */
export async function clearAiSettings(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE users SET ai_provider = NULL, ai_model = NULL, ai_key_ciphertext = NULL,
         ai_key_iv = NULL, ai_key_last4 = NULL, ai_key_status = NULL, ai_key_rejected_message = NULL
       WHERE id = ?`,
    )
    .bind(userId)
    .run();
}

/** Marks the user's key as rejected by the provider, pausing their enrichment. */
export async function markKeyRejected(
  db: D1Database,
  userId: string,
  message: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE users SET ai_key_status = 'rejected', ai_key_rejected_message = ? WHERE id = ? AND ai_key_ciphertext IS NOT NULL",
    )
    .bind(message, userId)
    .run();
}

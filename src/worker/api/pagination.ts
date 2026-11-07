import type { Env } from '../env';

/** The page size of a list when the request names none. */
export const DEFAULT_LIMIT = 50;
/** The largest page a list returns. */
export const MAX_LIMIT = 100;

/** The page size a request asks for, or null when `value` is not an integer from 1 to MAX_LIMIT. */
export function parseLimit(value: string | undefined, fallback = DEFAULT_LIMIT): number | null {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= MAX_LIMIT ? n : null;
}

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64url(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * The key cursors are signed with. It is derived from the deployment's OAuth
 * client secret, so that it is secret without another variable to configure;
 * rotating that secret only invalidates the cursors in flight.
 */
async function cursorKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(`alexandria-cursor:${env.GOOGLE_CLIENT_SECRET}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** An opaque, tamper-evident cursor carrying `payload`: its JSON, base64url, and an HMAC of it. */
export async function encodeCursor(env: Env, payload: unknown): Promise<string> {
  const body = encoder.encode(JSON.stringify(payload));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await cursorKey(env), body));
  return `${base64url(body)}.${base64url(mac)}`;
}

/** The payload of a cursor this API issued, or null for anything else. */
export async function decodeCursor<T>(env: Env, cursor: string): Promise<T | null> {
  const [bodyPart, macPart, rest] = cursor.split('.');
  if (!bodyPart || !macPart || rest !== undefined) return null;
  const body = fromBase64url(bodyPart);
  const mac = fromBase64url(macPart);
  if (!body || !mac) return null;
  const valid = await crypto.subtle.verify('HMAC', await cursorKey(env), mac, body);
  if (!valid) return null;
  try {
    return JSON.parse(new TextDecoder().decode(body)) as T;
  } catch {
    return null;
  }
}

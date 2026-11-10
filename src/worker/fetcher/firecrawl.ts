import { Hono } from 'hono';
import { readJson, refusal, validationError } from '../api/errors';
import {
  clearStoredKey,
  decryptKey,
  getStoredKey,
  markStoredKeyRejected,
  saveStoredKey,
  type StoredKey,
} from '../enrich/keys';
import type { AppEnv, Env } from '../env';
import { isFetchable } from '../links/normalize';
import { PAGE_LIMIT, type FetchFailed, type FetchOk } from './fetch';

/**
 * The fallback for pages behind a bot check: with the owner's own Firecrawl
 * key, a page whose site answered Alexandria with a bot check is fetched
 * through Firecrawl, which loads it in a browser. Only such pages are sent
 * to Firecrawl, and only for an owner who stored a key.
 */

/** How long Firecrawl may take to load a page, sent as its own time limit. */
export const SCRAPE_TIMEOUT_MS = 60_000;
/** How long a call to Firecrawl may take before it is abandoned. */
const CALL_TIMEOUT_MS = SCRAPE_TIMEOUT_MS + 15_000;
/** The note a page fetched through Firecrawl carries. */
export const FIRECRAWL_NOTE = 'fetched through Firecrawl';

let timeoutOverride: number | null = null;

/** Shortens the call timeout, for tests; null restores it. */
export function setFirecrawlTimeout(ms: number | null): void {
  timeoutOverride = ms;
}

/** A user's stored Firecrawl key. */
export type FirecrawlSettings = StoredKey;

/** The user's Firecrawl settings, or null when no key is stored. */
export async function getFirecrawlSettings(
  db: D1Database,
  userId: string,
): Promise<FirecrawlSettings | null> {
  return (await getStoredKey(db, userId, 'firecrawl_key'))?.key ?? null;
}

/** Stores a verified key, replacing any earlier one and lifting a rejection. */
export function saveFirecrawlKey(env: Env, userId: string, key: string): Promise<void> {
  return saveStoredKey(env, userId, 'firecrawl_key', key);
}

/** Forgets the user's Firecrawl key. */
export function clearFirecrawlKey(db: D1Database, userId: string): Promise<void> {
  return clearStoredKey(db, userId, 'firecrawl_key');
}

/** What a call to Firecrawl came to. */
export type FirecrawlOutcome<T> =
  | { ok: true; value: T }
  /** The key was refused: HTTP 401, 402 (no credits left) or 403. */
  | { ok: false; kind: 'rejected'; message: string }
  /** Firecrawl could not be reached, timed out, was rate limited or answered 5xx: worth a retry. */
  | { ok: false; kind: 'unavailable'; message: string }
  /** Anything else: Firecrawl could not load the page, or answered unusably. */
  | { ok: false; kind: 'failed'; message: string };

/** Firecrawl's own message in an error body, if it carries one. */
function messageOf(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const { error, message } = body as { error?: unknown; message?: unknown };
    if (typeof error === 'string' && error) return error;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

/** Sends one request to Firecrawl's API with `apiKey`, sorting a failure by its kind. */
async function call(
  env: Env,
  apiKey: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<FirecrawlOutcome<unknown>> {
  let response: Response;
  try {
    response = await fetch(`${env.FIRECRAWL_API_URL.replace(/\/$/, '')}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(timeoutOverride ?? CALL_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && /timeout|abort/i.test(err.name);
    return { ok: false, kind: 'unavailable', message: timedOut ? 'timed out' : 'unreachable' };
  }
  const body: unknown = await response.json().catch(() => null);
  const status = response.status;
  const message = messageOf(body, `HTTP ${status}`);
  if (status === 401 || status === 402 || status === 403) {
    return { ok: false, kind: 'rejected', message };
  }
  if (status === 408 || status === 429 || status >= 500) {
    return { ok: false, kind: 'unavailable', message };
  }
  if (status !== 200 || (body as { success?: unknown } | null)?.success !== true) {
    return { ok: false, kind: 'failed', message };
  }
  return { ok: true, value: body };
}

/** Tests `apiKey` with a request that costs no credits: the team's credit usage. */
export async function testFirecrawlKey(env: Env, apiKey: string): Promise<FirecrawlOutcome<null>> {
  const outcome = await call(env, apiKey, '/v2/team/credit-usage', { method: 'GET' });
  return outcome.ok ? { ok: true, value: null } : outcome;
}

/** The part of Firecrawl's scrape answer Alexandria reads. */
interface ScrapeAnswer {
  data?: {
    rawHtml?: unknown;
    metadata?: { url?: unknown; sourceURL?: unknown; statusCode?: unknown };
  };
}

/**
 * Asks Firecrawl for the page at `url` as its browser received it (rawHtml),
 * leaving Firecrawl to choose its proxy. The page is read up to PAGE_LIMIT,
 * like a direct fetch. An answer of the site's that is not a success, a final
 * address that is not public http(s), or no HTML is a failure.
 */
export async function scrape(
  env: Env,
  apiKey: string,
  url: string,
): Promise<FirecrawlOutcome<FetchOk>> {
  const outcome = await call(env, apiKey, '/v2/scrape', {
    method: 'POST',
    body: { url, formats: ['rawHtml'], proxy: 'auto', timeout: SCRAPE_TIMEOUT_MS },
  });
  if (!outcome.ok) return outcome;
  const data = (outcome.value as ScrapeAnswer).data;
  const statusCode =
    typeof data?.metadata?.statusCode === 'number' ? data.metadata.statusCode : 200;
  if (statusCode >= 400) {
    return { ok: false, kind: 'failed', message: `the page answered HTTP ${statusCode}` };
  }
  if (typeof data?.rawHtml !== 'string' || data.rawHtml === '') {
    return { ok: false, kind: 'failed', message: 'no page came back' };
  }
  const named = [data.metadata?.url, data.metadata?.sourceURL].find((u) => typeof u === 'string');
  let finalUrl: URL;
  try {
    finalUrl = new URL(typeof named === 'string' ? named : url);
  } catch {
    finalUrl = new URL(url);
  }
  if (!isFetchable(finalUrl)) return { ok: false, kind: 'failed', message: 'blocked address' };
  const encoded = new TextEncoder().encode(data.rawHtml);
  const truncated = encoded.length > PAGE_LIMIT;
  return {
    ok: true,
    value: {
      ok: true,
      finalUrl: finalUrl.href,
      status: statusCode,
      contentType: 'text/html',
      // Firecrawl's answer is JSON: the page is UTF-8 now, whatever its own <meta> says.
      charset: 'utf-8',
      kind: 'html',
      body: truncated ? encoded.subarray(0, PAGE_LIMIT) : encoded,
      truncated,
      via: 'firecrawl',
    },
  };
}

/**
 * The fallback after a direct fetch of `url` met a bot check: with the user's
 * verified Firecrawl key, the page as Firecrawl fetched it; otherwise the
 * failure as it was. A refused key is marked rejected; a failure Firecrawl may
 * get over is no longer final, so the link's fetch is retried.
 */
export async function fetchThroughFirecrawl(
  env: Env,
  userId: string,
  url: string,
  failure: FetchFailed,
): Promise<FetchOk | FetchFailed> {
  const settings = await getFirecrawlSettings(env.DB, userId);
  if (settings?.status !== 'verified') return failure;
  let apiKey: string;
  try {
    apiKey = await decryptKey(env, settings.ciphertext, settings.iv, userId);
  } catch {
    return failure;
  }
  const outcome = await scrape(env, apiKey, url);
  if (outcome.ok) return outcome.value;
  if (outcome.kind === 'rejected')
    await markStoredKeyRejected(env.DB, userId, 'firecrawl_key', outcome.message);
  return {
    ...failure,
    reason: `${failure.reason} (Firecrawl: ${outcome.message})`,
    final: outcome.kind !== 'unavailable',
  };
}

/** The settings as the API shows them: never the key, only its last 4 characters. */
function settingsView(s: FirecrawlSettings) {
  return {
    configured: true as const,
    key_last4: s.last4,
    status: s.status,
    rejected_message: s.rejectedMessage,
  };
}

/** The owner's Firecrawl key, under /api/v1/settings. */
export const firecrawlSettingsRoutes = new Hono<AppEnv>();

firecrawlSettingsRoutes.get('/firecrawl', async (c) => {
  const settings = await getFirecrawlSettings(c.env.DB, c.get('user').id);
  return c.json(settings ? settingsView(settings) : { configured: false });
});

firecrawlSettingsRoutes.put('/firecrawl', async (c) => {
  const parsed = await readJson(c);
  if (!parsed.ok) return parsed.response;
  const apiKey = parsed.body.api_key;
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    return validationError(c, 'invalid_key', 'api_key', 'an API key is required');
  }
  const outcome = await testFirecrawlKey(c.env, apiKey.trim());
  if (!outcome.ok) {
    if (outcome.kind === 'rejected' || outcome.kind === 'failed') {
      return validationError(c, 'key_rejected', 'api_key', outcome.message);
    }
    return refusal(
      c,
      502,
      'provider_unavailable',
      `Firecrawl could not be reached: ${outcome.message}`,
    );
  }
  const userId = c.get('user').id;
  await saveFirecrawlKey(c.env, userId, apiKey.trim());
  const settings = await getFirecrawlSettings(c.env.DB, userId);
  return c.json(settingsView(settings!));
});

firecrawlSettingsRoutes.delete('/firecrawl', async (c) => {
  await clearFirecrawlKey(c.env.DB, c.get('user').id);
  return c.body(null, 204);
});

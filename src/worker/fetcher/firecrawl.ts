import { firecrawlKey, keyRejection, markKeyRejected } from '../enrich/keys';
import type { Env } from '../env';
import { isFetchable } from '../links/normalize';
import { PAGE_LIMIT, type FetchFailed, type FetchOk } from './fetch';

/**
 * The fallback for pages behind a bot check: with the deployment's Firecrawl
 * key (FIRECRAWL_API_KEY), a page whose site answered Alexandria with a bot
 * check is fetched through Firecrawl, which loads it in a browser. Only such
 * pages are sent to Firecrawl, and only when the deployment has a key.
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
 * The fallback after a direct fetch of `url` met a bot check: with the
 * deployment's Firecrawl key, unless Firecrawl refused it within the hour, the
 * page as Firecrawl fetched it; otherwise the failure as it was. A refused key
 * is recorded as refused; a failure Firecrawl may get over is no longer final,
 * so the link's fetch is retried.
 */
export async function fetchThroughFirecrawl(
  env: Env,
  url: string,
  failure: FetchFailed,
): Promise<FetchOk | FetchFailed> {
  const apiKey = firecrawlKey(env);
  if (!apiKey || (await keyRejection(env.DB, 'firecrawl', apiKey)) !== null) return failure;
  const outcome = await scrape(env, apiKey, url);
  if (outcome.ok) return outcome.value;
  if (outcome.kind === 'rejected') {
    await markKeyRejected(env.DB, 'firecrawl', apiKey, outcome.message);
  }
  return {
    ...failure,
    reason: `${failure.reason} (Firecrawl: ${outcome.message})`,
    final: outcome.kind !== 'unavailable',
  };
}

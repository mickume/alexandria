import type { Env } from '../env';
import { isFetchable } from '../links/normalize';
import { waitForHost } from './hostgate';

/** How long one request may take, from sending it to the last byte of its body. */
export const FETCH_TIMEOUT_MS = 15_000;
/** Redirects followed before a fetch fails. */
export const MAX_REDIRECTS = 5;
/** The most of a web page that is read; the rest is cut off. */
export const PAGE_LIMIT = 5 * 1024 * 1024;
/** The largest PDF that is stored. */
export const PDF_LIMIT = 50 * 1024 * 1024;

/** What a response turned out to be. */
export type ContentKind = 'html' | 'pdf' | 'other';

/** A fetch that reached a 2xx response. */
export interface FetchOk {
  ok: true;
  finalUrl: string;
  status: number;
  /** The response's media type, without parameters, such as text/html. */
  contentType: string;
  kind: ContentKind;
  /** The body read, or null for a kind that is not stored or a PDF over PDF_LIMIT. */
  body: Uint8Array | null;
  /** A web page longer than PAGE_LIMIT, of which only the first PAGE_LIMIT bytes were read. */
  truncated: boolean;
  /** A PDF longer than PDF_LIMIT, of which nothing is kept. */
  tooLarge: boolean;
}

/** A fetch that failed, with the reason shown on the link. */
export interface FetchFailed {
  ok: false;
  reason: string;
  /** The HTTP status of a 4xx or 5xx answer. */
  status?: number;
}

export type FetchResult = FetchOk | FetchFailed;

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

/** The reason shown for a request that threw. */
function reasonFor(err: unknown): string {
  const message = String(err instanceof Error ? err.message : err).toLowerCase();
  if (/dns|enotfound|getaddrinfo|could not resolve|name not resolved|no such host/.test(message)) {
    return 'host not found';
  }
  if (/tls|ssl|certificate|handshake/.test(message)) return 'TLS error';
  return 'could not connect';
}

class TimedOut extends Error {}

/** Resolves with `work`, or rejects with TimedOut once `signal` aborts. */
function beforeAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new TimedOut());
    const onAbort = () => reject(new TimedOut());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Reads at most `limit` bytes of `body`; `over` says whether there was more. */
async function readLimited(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; over: boolean }> {
  if (!body) return { bytes: new Uint8Array(), over: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let over = false;
  try {
    for (;;) {
      const { done, value } = await beforeAbort(reader.read(), signal);
      if (done) break;
      if (size + value.length > limit) {
        chunks.push(value.subarray(0, limit - size));
        size = limit;
        over = true;
        break;
      }
      chunks.push(value);
      size += value.length;
    }
  } finally {
    if (over || signal.aborted) reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return { bytes, over };
}

function startsWithPdfMagic(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
}

/** Sends one GET for `target`, through ORIGIN_PROXY_URL when that is set. */
function send(env: Env, target: URL, signal: AbortSignal): Promise<Response> {
  const headers = new Headers({
    Accept: 'text/html, application/pdf',
    'User-Agent': `Alexandria/1.0 (+${env.PUBLIC_ORIGIN}/about/fetcher)`,
  });
  let url = target.href;
  if (env.ORIGIN_PROXY_URL) {
    headers.set('X-Alexandria-Target', target.href);
    url = env.ORIGIN_PROXY_URL;
  }
  return fetch(url, { method: 'GET', headers, redirect: 'manual', signal });
}

/** Reads a 2xx response's body as its kind requires. */
async function readBody(response: Response, finalUrl: URL, signal: AbortSignal): Promise<FetchOk> {
  const contentType = (response.headers.get('Content-Type') ?? '')
    .split(';')[0]!
    .trim()
    .toLowerCase();
  const base = { ok: true as const, finalUrl: finalUrl.href, status: response.status, contentType };
  const looksLikePdf =
    contentType === 'application/pdf' || finalUrl.pathname.toLowerCase().endsWith('.pdf');

  if (HTML_TYPES.has(contentType)) {
    const { bytes, over } = await readLimited(response.body, PAGE_LIMIT, signal);
    return { ...base, kind: 'html', body: bytes, truncated: over, tooLarge: false };
  }
  if (looksLikePdf) {
    const declared = Number(response.headers.get('Content-Length') ?? NaN);
    if (declared > PDF_LIMIT) {
      await response.body?.cancel();
      return { ...base, kind: 'pdf', body: null, truncated: false, tooLarge: true };
    }
    const { bytes, over } = await readLimited(response.body, PDF_LIMIT, signal);
    if (over) return { ...base, kind: 'pdf', body: null, truncated: false, tooLarge: true };
    if (contentType === 'application/pdf' || startsWithPdfMagic(bytes)) {
      return { ...base, kind: 'pdf', body: bytes, truncated: false, tooLarge: false };
    }
    return { ...base, kind: 'other', body: null, truncated: false, tooLarge: false };
  }
  await response.body?.cancel();
  return { ...base, kind: 'other', body: null, truncated: false, tooLarge: false };
}

/**
 * Fetches the page at `url` as the fetcher does: GET with Alexandria's Accept
 * and User-Agent headers, through the host gate, following at most 5
 * redirects by hand and refusing any target that is not a public http(s)
 * address, each request and its body within `timeoutMs`. A web page is read up
 * to 5 MB and a PDF up to 50 MB; any other kind is not read.
 */
export async function fetchPage(
  env: Env,
  url: string,
  { timeoutMs = FETCH_TIMEOUT_MS } = {},
): Promise<FetchResult> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { ok: false, reason: 'blocked address' };
  }
  for (let hop = 0; ; hop++) {
    if (!isFetchable(target)) return { ok: false, reason: 'blocked address' };
    await waitForHost(env, target.hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await beforeAbort(send(env, target, controller.signal), controller.signal);
      const location = response.headers.get('Location');
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        if (hop >= MAX_REDIRECTS) return { ok: false, reason: 'too many redirects' };
        try {
          target = new URL(location, target);
        } catch {
          return { ok: false, reason: 'blocked address' };
        }
        continue;
      }
      if (response.status >= 400) {
        await response.body?.cancel();
        return { ok: false, reason: `HTTP ${response.status}`, status: response.status };
      }
      return await readBody(response, target, controller.signal);
    } catch (err) {
      return { ok: false, reason: err instanceof TimedOut ? 'timed out' : reasonFor(err) };
    } finally {
      clearTimeout(timer);
    }
  }
}

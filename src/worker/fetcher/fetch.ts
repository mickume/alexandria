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
  /**
   * Trying again later will not help: the site answered with a bot check,
   * which only a browser running JavaScript can pass.
   */
  final?: boolean;
}

export type FetchResult = FetchOk | FetchFailed;

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

/** The DNS-over-HTTPS endpoint (JSON) that tells an unknown host from a bad certificate. */
export const DNS_QUERY_URL = 'https://cloudflare-dns.com/dns-query';
const DNS_TIMEOUT_MS = 3_000;

/** Whether `host` has a DNS record: true, false for NXDOMAIN, null when the lookup failed. */
async function resolves(host: string): Promise<boolean | null> {
  // An address needs no lookup.
  if (/^[\d.]+$/.test(host) || host.includes(':')) return true;
  try {
    const answer = await fetch(`${DNS_QUERY_URL}?name=${encodeURIComponent(host)}&type=A`, {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(DNS_TIMEOUT_MS),
    });
    if (!answer.ok) return null;
    const { Status } = await answer.json<{ Status?: number }>();
    return Status === 3 ? false : Status === 0 ? true : null;
  } catch {
    return null;
  }
}

/**
 * The reason shown for a request to `target` that threw. The Workers runtime
 * says "Network connection lost." for a refused or reset connection, and
 * hides both an unknown host and a bad certificate behind an opaque "internal
 * error; reference = …": for that one, a DNS lookup of the host tells them
 * apart (no record: host not found; a record over https: TLS error). Messages
 * that name their cause, as other runtimes give them, are read as they say.
 */
async function reasonFor(err: unknown, target: URL): Promise<string> {
  const message = String(err instanceof Error ? err.message : err).toLowerCase();
  if (message.startsWith('internal error')) {
    const found = await resolves(target.hostname);
    if (found === false) return 'host not found';
    if (found && target.protocol === 'https:') return 'TLS error';
    return 'could not connect';
  }
  if (/dns|enotfound|getaddrinfo|could not resolve|name not resolved|no such host/.test(message)) {
    return 'host not found';
  }
  if (/tls|ssl|certificate|handshake/.test(message)) return 'TLS error';
  return 'could not connect';
}

/** Cloudflare's own error statuses, by the failure each stands for. */
const CLOUDFLARE_REASONS: Record<number, string> = {
  521: 'could not connect',
  522: 'timed out',
  523: 'could not connect',
  524: 'timed out',
  525: 'TLS error',
  526: 'TLS error',
};

/** The reason given for a site that answers with a bot check instead of its page. */
export const BOT_CHECK_REASON = 'blocked by a bot check';

/**
 * Whether `response` is a bot check (Cloudflare's "Just a moment…" page, or
 * any challenge it marks with cf-mitigated: challenge) rather than an answer
 * of the site's own.
 */
export function isBotCheck(response: Response): boolean {
  return response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge';
}

/**
 * The reason for a final answer that is not a success, consuming its body:
 * a bot check is named as one; an error status Cloudflare itself answers for
 * an origin it could not reach (Server: cloudflare) is named as that failure,
 * a 530 with error 1016 as 'host not found'; any other status is
 * 'HTTP <status>'.
 */
export async function statusReason(response: Response): Promise<string> {
  if (isBotCheck(response)) {
    await response.body?.cancel();
    return BOT_CHECK_REASON;
  }
  const fromCloudflare = response.headers.get('Server')?.toLowerCase() === 'cloudflare';
  const named = fromCloudflare ? CLOUDFLARE_REASONS[response.status] : undefined;
  if (fromCloudflare && response.status === 530) {
    const text = await response.text().catch(() => '');
    return /\b1016\b/.test(text) ? 'host not found' : `HTTP ${response.status}`;
  }
  await response.body?.cancel();
  return named ?? `HTTP ${response.status}`;
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

/** Sends one request for `target`, through ORIGIN_PROXY_URL when that is set. */
function send(
  env: Env,
  target: URL,
  signal: AbortSignal,
  method: 'GET' | 'HEAD' = 'GET',
): Promise<Response> {
  const headers = new Headers({
    Accept: 'text/html, application/pdf',
    // The page that explains the fetcher, when the deployment names its address.
    'User-Agent': env.PUBLIC_ORIGIN
      ? `Alexandria/1.0 (+${env.PUBLIC_ORIGIN}/about/fetcher)`
      : 'Alexandria/1.0',
  });
  let url = target.href;
  if (env.ORIGIN_PROXY_URL) {
    headers.set('X-Alexandria-Target', target.href);
    url = env.ORIGIN_PROXY_URL;
  }
  return fetch(url, { method, headers, redirect: 'manual', signal });
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
 * Sends `method` to `url` as the fetcher does: through the host gate before
 * every request, following at most 5 redirects by hand and refusing any target
 * that is not a public http(s) address, each request within `timeoutMs`; the
 * last response is handed to `onFinal` inside the same time limit. A failure of
 * Alexandria's own (the host gate) is thrown, not turned into a reason.
 */
export async function requestFollowing<T>(
  env: Env,
  url: string,
  { method, timeoutMs }: { method: 'GET' | 'HEAD'; timeoutMs: number },
  onFinal: (response: Response, finalUrl: URL, signal: AbortSignal) => Promise<T>,
): Promise<T | FetchFailed> {
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
      const response = await beforeAbort(
        send(env, target, controller.signal, method),
        controller.signal,
      );
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
      return await onFinal(response, target, controller.signal);
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof TimedOut ? 'timed out' : await reasonFor(err, target),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Fetches the page at `url` as the fetcher does: GET with Alexandria's Accept
 * and User-Agent headers through requestFollowing. A web page is read up to
 * 5 MB and a PDF up to 50 MB; any other kind is not read; a 4xx or 5xx is a
 * failure, and a final one when it is a bot check.
 */
export async function fetchPage(
  env: Env,
  url: string,
  { timeoutMs = FETCH_TIMEOUT_MS } = {},
): Promise<FetchResult> {
  return requestFollowing(
    env,
    url,
    { method: 'GET', timeoutMs },
    async (response, finalUrl, signal) => {
      if (response.status >= 400) {
        const final = isBotCheck(response);
        const reason = await statusReason(response);
        return { ok: false, reason, status: response.status, ...(final && { final }) } as const;
      }
      return readBody(response, finalUrl, signal);
    },
  );
}

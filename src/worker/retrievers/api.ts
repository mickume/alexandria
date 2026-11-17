/**
 * One request to a site's API, as every retriever sends it: through the host
 * gate under the API's host name, with Alexandria's User-Agent, within 15
 * seconds, and with the answer sorted into a success or a named failure.
 */
import type { Env } from '../env';
import { userAgent } from '../fetcher/fetch';
import { waitForHost } from '../fetcher/hostgate';
import type { RetrieverFailure } from './retriever';

/** How long one request to an API may take, from sending it to the last byte of its body. */
export const API_TIMEOUT_MS = 15_000;

let timeoutOverride: number | null = null;

/** Shortens the request timeout, for tests; null restores it. */
export function setApiTimeout(ms: number | null): void {
  timeoutOverride = ms;
}

/** A 2xx answer of an API, its body read as text. */
export interface ApiAnswer {
  status: number;
  headers: Headers;
  body: string;
}

/** How a site tells a spent rate limit or a refused key from another error of the same status. */
export interface ApiRules {
  /** Whether a 400 or 403 answer means the limit or quota is spent. */
  rateLimited?(status: number, headers: Headers, body: string): boolean;
  /** Whether a 400 answer means the key was refused (401 and any other 403 always do). */
  keyRefused?(status: number, body: string): boolean;
}

export type ApiResult = { ok: true; answer: ApiAnswer } | { ok: false; failure: RetrieverFailure };

/** The failure a non-2xx answer stands for. */
function failureOf(
  status: number,
  headers: Headers,
  body: string,
  rules: ApiRules,
): RetrieverFailure {
  if (status >= 500) return 'unreachable';
  if (status === 429) return 'rate limited';
  if ((status === 400 || status === 403) && rules.rateLimited?.(status, headers, body)) {
    return 'rate limited';
  }
  if (status === 401 || status === 403) return 'key refused';
  if (status === 400 && rules.keyRefused?.(status, body)) return 'key refused';
  if (status === 404) return 'not found';
  return 'unusable answer';
}

/**
 * Sends a GET for `url` with `headers`, after waiting for the host gate of the
 * URL's host. A redirect is not followed (the API's answer is what counts),
 * and reads as an unusable answer.
 */
export async function callApi(
  env: Env,
  url: string,
  headers: Record<string, string>,
  rules: ApiRules = {},
): Promise<ApiResult> {
  const target = new URL(url);
  await waitForHost(env, target.hostname);
  const signal = AbortSignal.timeout(timeoutOverride ?? API_TIMEOUT_MS);
  try {
    const response = await fetch(target.href, {
      headers: { 'User-Agent': userAgent(env), ...headers },
      redirect: 'manual',
      signal,
    });
    const body = await response.text();
    if (response.status >= 200 && response.status < 300) {
      return { ok: true, answer: { status: response.status, headers: response.headers, body } };
    }
    return { ok: false, failure: failureOf(response.status, response.headers, body, rules) };
  } catch {
    return { ok: false, failure: signal.aborted ? 'timed out' : 'unreachable' };
  }
}

/** A JSON body parsed, or null when it is not JSON. */
export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

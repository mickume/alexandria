/**
 * The YouTube retriever: a video's page is retrieved through the YouTube Data
 * API v3 with the deployment's YOUTUBE_API_KEY. Without the key it claims
 * nothing, and YouTube's pages are fetched as pages.
 */
import { callApi, parseJson, type ApiRules } from './api';
import { clockDuration, dateOf, describe, facts } from './facts';
import type { Retriever } from './retriever';

/** A video, by its id. */
export interface YouTubeClaim {
  id: string;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The video an address names, whatever form it takes; null for any other address. */
export function claimYouTube(url: URL): YouTubeClaim | null {
  const segments = url.pathname.split('/').filter(Boolean);
  let id: string | null | undefined;
  if (url.hostname.toLowerCase() === 'youtu.be') {
    id = segments.length === 1 ? segments[0] : null;
  } else if (segments.length === 1 && segments[0] === 'watch') {
    id = url.searchParams.get('v');
  } else if (segments.length === 2 && ['shorts', 'live', 'embed'].includes(segments[0]!)) {
    id = segments[1];
  }
  return id && VIDEO_ID.test(id) ? { id } : null;
}

/** The reasons of a YouTube error answer. */
function reasons(body: string): string[] {
  const parsed = parseJson(body) as { error?: { errors?: { reason?: unknown }[] } } | null;
  return (parsed?.error?.errors ?? [])
    .map((e) => e.reason)
    .filter((r): r is string => typeof r === 'string');
}

const RATE_REASONS = new Set([
  'quotaExceeded',
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'dailyLimitExceeded',
]);

const RULES: ApiRules = {
  rateLimited: (_status, _headers, body) => reasons(body).some((r) => RATE_REASONS.has(r)),
  keyRefused: (_status, body) =>
    reasons(body).includes('keyInvalid') || /API key not valid/i.test(body),
};

/** The thumbnail sizes, largest first. */
const THUMBNAILS = ['maxres', 'standard', 'high', 'medium', 'default'];

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function largestThumbnail(thumbnails: unknown): string | null {
  if (!isObject(thumbnails)) return null;
  for (const size of THUMBNAILS) {
    const t = thumbnails[size];
    if (isObject(t) && str(t.url)) return str(t.url);
  }
  return null;
}

export const youtube: Retriever<YouTubeClaim> = {
  name: 'youtube',
  site: 'YouTube',
  hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'],
  enabled: (env) => Boolean(env.YOUTUBE_API_KEY),
  claim: claimYouTube,
  async retrieve(env, claim) {
    const query = new URLSearchParams({
      part: 'snippet,contentDetails',
      id: claim.id,
      key: env.YOUTUBE_API_KEY ?? '',
    });
    const url = `${env.YOUTUBE_API_URL.replace(/\/$/, '')}/videos?${query}`;
    const answer = await callApi(env, url, { Accept: 'application/json' }, RULES);
    if (!answer.ok) return answer;
    const parsed = parseJson(answer.answer.body);
    if (!isObject(parsed) || !Array.isArray(parsed.items)) {
      return { ok: false, failure: 'unusable answer' };
    }
    const item: unknown = parsed.items[0];
    if (item === undefined) return { ok: false, failure: 'not found' };
    const snippet = isObject(item) && isObject(item.snippet) ? item.snippet : null;
    const title = snippet ? str(snippet.title) : null;
    if (!snippet || !title) return { ok: false, failure: 'unusable answer' };
    const details = isObject(item) && isObject(item.contentDetails) ? item.contentDetails : {};
    const description = typeof snippet.description === 'string' ? snippet.description : '';
    return {
      ok: true,
      value: {
        title,
        description: describe(description),
        finalUrl: `https://www.youtube.com/watch?v=${claim.id}`,
        faviconUrl: 'https://www.youtube.com/favicon.ico',
        language: str(snippet.defaultAudioLanguage) ?? str(snippet.defaultLanguage),
        text: description.trim() ? description : null,
        kind: 'video',
        facts: facts([
          ['channel', 'Channel', str(snippet.channelTitle), true],
          ['duration', 'Duration', clockDuration(details.duration), true],
          ['published', 'Published', dateOf(snippet.publishedAt)],
          ['thumbnail', 'Thumbnail', largestThumbnail(snippet.thumbnails)],
        ]),
      },
    };
  },
};

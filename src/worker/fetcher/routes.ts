import { Hono, type Context } from 'hono';
import { notFound } from '../api/errors';
import { now } from '../clock';
import type { AppEnv, Env } from '../env';
import { getLink, type LinkRow } from '../links/store';
import { recordUse } from '../links/use';
import {
  pdfFileName,
  readerKey,
  snapshotKey,
  storedText,
  type ReaderResponse,
  type StoredReader,
} from './snapshots';
import { cleanTitle } from './titles';

/** The public page the fetcher's User-Agent points site operators at. */
export const aboutRoutes = new Hono<AppEnv>();

aboutRoutes.get('/fetcher', (c) =>
  c.html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Alexandria's fetcher</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.6}</style>
</head>
<body>
<h1>Alexandria's fetcher</h1>
<p>Alexandria is a private library of web links. When one of its users adds a link,
Alexandria fetches that one page once, on the user's behalf, to show its title and keep a
copy the user can read later. It identifies itself as <code>Alexandria/1.0</code>.</p>
<ul>
<li>It fetches only the pages its users add, and pages they ask to refresh. It does not
crawl, follow links, or fetch images, feeds or other resources the page refers to.</li>
<li>It sends at most 1 request per second to any one host.</li>
<li>It acts as its user's browser would and does not read <code>robots.txt</code>.</li>
</ul>
</body>
</html>`),
);

/** Headers of a served HTML snapshot: its scripts never run and it cannot act on the session. */
const SNAPSHOT_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy':
    "sandbox; default-src 'none'; img-src * data:; style-src * 'unsafe-inline'; font-src * data:",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/** The stored copies of a user's links, under /api/v1/links: Read and Snapshot. */
export const snapshotRoutes = new Hono<AppEnv>();

/** The user's link with a stored snapshot, or the answer that says why there is none. */
async function storedLink(c: Context<AppEnv>): Promise<LinkRow | Response> {
  const link = await getLink(c.env.DB, c.get('user').id, c.req.param('id') ?? '');
  if (!link) return notFound(c);
  if (!link.has_snapshot) return c.json(NO_SNAPSHOT, 404);
  return link;
}

const NO_SNAPSHOT = { error: 'no_snapshot', message: 'no snapshot stored for this link' };

/** The reader view of a link with a stored snapshot, as GET /api/v1/links/{id}/reader serves it. */
export async function readerBody(env: Env, link: LinkRow): Promise<ReaderResponse> {
  const text = await storedText(env, link.user_id, link.id);
  if (link.content_kind === 'pdf') {
    return {
      content_kind: 'pdf',
      title: link.title,
      byline: null,
      html: null,
      text,
      empty: text === '',
    };
  }
  const object = link.reader_empty
    ? null
    : await env.SNAPSHOTS.get(readerKey(link.user_id, link.id));
  const reader = object ? await object.json<StoredReader>() : null;
  return reader?.html
    ? {
        content_kind: 'html',
        title: reader.title === null ? null : cleanTitle(reader.title, link.final_url ?? link.url),
        byline: reader.byline,
        html: reader.html,
        text,
        empty: false,
      }
    : { content_kind: 'html', title: link.title, byline: null, html: null, text: '', empty: true };
}

/**
 * The stored snapshot of a link as GET /api/v1/links/{id}/snapshot serves it:
 * the HTML sandboxed, or the PDF inline (or as an attachment); null when no
 * object is stored.
 */
export async function snapshotResponse(
  env: Env,
  link: LinkRow,
  download: boolean,
): Promise<Response | null> {
  const object = await env.SNAPSHOTS.get(snapshotKey(link.user_id, link.id));
  if (!object) return null;
  if (link.content_kind === 'pdf') {
    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${pdfFileName(link.title)}"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  return new Response(object.body, { headers: SNAPSHOT_HEADERS });
}

snapshotRoutes.get('/:id/reader', async (c) => {
  const link = await storedLink(c);
  if (link instanceof Response) return link;
  const body = await readerBody(c.env, link);
  await recordUse(c.env.DB, link.user_id, link.id);
  return c.json(body);
});

snapshotRoutes.get('/:id/snapshot', async (c) => {
  const link = await storedLink(c);
  if (link instanceof Response) return link;
  const response = await snapshotResponse(c.env, link, c.req.query('download') === '1');
  if (!response) return c.json(NO_SNAPSHOT, 404);
  await recordUse(c.env.DB, link.user_id, link.id);
  return response;
});

/** The least time between two refreshes of one link. */
export const REFRESH_INTERVAL_MS = 10 * 60_000;

snapshotRoutes.post('/:id/refresh', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const at = now();
  // One statement claims the refresh only when the window has passed, so two
  // requests at once cannot both get through.
  const claimed = await c.env.DB.prepare(
    `UPDATE links SET refresh_requested_at = ?1, updated_at = ?1
     WHERE id = ?2 AND user_id = ?3
       AND (refresh_requested_at IS NULL OR refresh_requested_at <= ?4)
     RETURNING id`,
  )
    .bind(at.toISOString(), id, userId, new Date(at.getTime() - REFRESH_INTERVAL_MS).toISOString())
    .first();
  if (!claimed) {
    const link = await getLink(c.env.DB, userId, id);
    if (!link) return notFound(c);
    const since = at.getTime() - Date.parse(link.refresh_requested_at ?? '');
    c.header('Retry-After', String(Math.max(1, Math.ceil((REFRESH_INTERVAL_MS - since) / 1000))));
    return c.json({ error: 'refreshed_recently', message: 'already refreshed recently' }, 429);
  }
  await c.env.FETCH_QUEUE.send({ user_id: userId, link_id: id, refresh: true });
  return c.json({ status: 'queued' }, 202);
});

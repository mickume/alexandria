import { Hono, type Context } from 'hono';
import { notFound, refusal } from '../api/errors';
import { now } from '../clock';
import type { AppEnv, Env } from '../env';
import { getLink, type LinkRow } from '../links/store';
import { recordUse } from '../links/use';
import {
  articleKey,
  imageAddressPrefix,
  imageKey,
  pdfFileName,
  pdfKey,
  storedText,
  type SnapshotResponse,
  type StoredArticle,
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
Alexandria fetches that one page, on the user's behalf, to show its title. When the user
takes a snapshot of the page, to keep a copy they can read later, Alexandria fetches the
page again with the images of its article. It identifies itself as <code>Alexandria/1.0</code>.</p>
<ul>
<li>It fetches only the pages its users add, pages they ask to refresh or snapshot, and the
images of a page's article when they take a snapshot of it. It does not crawl, follow links,
or fetch stylesheets, scripts, feeds or other resources the page refers to.</li>
<li>It sends at most 1 request per second to any one host.</li>
<li>It acts as its user's browser would and does not read <code>robots.txt</code>.</li>
</ul>
</body>
</html>`),
);

/** The stored copies of a user's links, under /api/v1/links: the snapshot and the text. */
export const snapshotRoutes = new Hono<AppEnv>();

const NO_SNAPSHOT = { error: 'no_snapshot', message: 'no snapshot stored for this link' };

/** The user's link with a stored snapshot, or the answer that says why there is none. */
async function storedLink(c: Context<AppEnv>): Promise<LinkRow | Response> {
  const link = await getLink(c.env.DB, c.get('user').id, c.req.param('id') ?? '');
  if (!link) return notFound(c);
  if (!link.has_snapshot) return c.json(NO_SNAPSHOT, 404);
  return link;
}

/**
 * The stored snapshot of a link as GET /api/v1/links/{id}/snapshot serves it,
 * its image and file addresses under `base` (the link's own address, or the
 * export's); null when nothing is stored.
 */
export async function snapshotBody(
  env: Env,
  link: LinkRow,
  base: string,
): Promise<SnapshotResponse | null> {
  const takenAt = link.snapshot_at ?? link.fetched_at ?? link.updated_at;
  if (link.snapshot_kind === 'pdf') {
    return {
      content_kind: 'pdf',
      title: link.title,
      byline: null,
      html: null,
      taken_at: takenAt,
      notes: [],
      file_url: `${base}/snapshot/file`,
    };
  }
  const key = articleKey(link);
  const object = key ? await env.SNAPSHOTS.get(key) : null;
  if (!object) return null;
  const article = await object.json<StoredArticle>();
  const ownPrefix = imageAddressPrefix(link.id);
  const prefix = `${base}/snapshot/images/`;
  return {
    content_kind: 'html',
    title:
      article.title === null ? link.title : cleanTitle(article.title, link.final_url ?? link.url),
    byline: article.byline,
    html: prefix === ownPrefix ? article.html : article.html.split(ownPrefix).join(prefix),
    taken_at: takenAt,
    notes: article.notes,
  };
}

/** A link's stored PDF snapshot, inline or as an attachment; null when none is stored. */
export async function snapshotFileResponse(
  env: Env,
  link: LinkRow,
  download: boolean,
): Promise<Response | null> {
  if (!link.has_snapshot || link.snapshot_kind !== 'pdf') return null;
  const object = await env.SNAPSHOTS.get(pdfKey(link));
  if (!object) return null;
  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${pdfFileName(link.title)}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** One stored image of a link's snapshot; null when the snapshot holds no image of that name. */
export async function snapshotImageResponse(
  env: Env,
  link: LinkRow,
  name: string,
): Promise<Response | null> {
  const key = link.has_snapshot ? imageKey(link, name) : null;
  const object = key ? await env.SNAPSHOTS.get(key) : null;
  if (!object) return null;
  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    // An image's name is never used again by another snapshot, so it never changes.
    'Cache-Control': 'private, max-age=31536000, immutable',
  };
  if (contentType === 'image/svg+xml') {
    headers['Content-Security-Policy'] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
  }
  return new Response(object.body, { headers });
}

const NO_TEXT = { error: 'no_text', message: 'no text stored for this link' };

/** A link's stored article text as GET /api/v1/links/{id}/text serves it; null when there is none. */
export async function textBody(
  env: Env,
  link: LinkRow,
): Promise<{ id: string; text: string } | null> {
  const text = await storedText(env, link.user_id, link.id);
  return text === '' ? null : { id: link.id, text };
}

/** The address of a link under the API, the base of its snapshot's addresses. */
function linkBase(id: string): string {
  return `/api/v1/links/${encodeURIComponent(id)}`;
}

snapshotRoutes.get('/:id/snapshot', async (c) => {
  const link = await storedLink(c);
  if (link instanceof Response) return link;
  const body = await snapshotBody(c.env, link, linkBase(link.id));
  if (!body) return c.json(NO_SNAPSHOT, 404);
  await recordUse(c.env.DB, link.user_id, link.id);
  return c.json(body);
});

snapshotRoutes.get('/:id/snapshot/file', async (c) => {
  const link = await storedLink(c);
  if (link instanceof Response) return link;
  const response = await snapshotFileResponse(c.env, link, c.req.query('download') === '1');
  return response ?? c.json(NO_SNAPSHOT, 404);
});

snapshotRoutes.get('/:id/snapshot/images/:name', async (c) => {
  const link = await getLink(c.env.DB, c.get('user').id, c.req.param('id'));
  if (!link) return notFound(c);
  return (await snapshotImageResponse(c.env, link, c.req.param('name'))) ?? notFound(c);
});

snapshotRoutes.get('/:id/text', async (c) => {
  const link = await getLink(c.env.DB, c.get('user').id, c.req.param('id'));
  if (!link) return notFound(c);
  const body = await textBody(c.env, link);
  if (!body) return c.json(NO_TEXT, 404);
  await recordUse(c.env.DB, link.user_id, link.id);
  return c.json(body);
});

/** The least time between two snapshots of one link the owner asks for. */
export const SNAPSHOT_INTERVAL_MS = 10 * 60_000;

/**
 * Asks for a snapshot: a fetch of the page that also stores its article with
 * its images (or the PDF), in the background. One per link per 10 minutes,
 * apart from refreshes. The claim is made on the row as it was read, so two
 * requests at once cannot both get through; one that cannot be queued gives
 * the claim back.
 */
snapshotRoutes.post('/:id/snapshot', async (c) => {
  const db = c.env.DB;
  const userId = c.get('user').id;
  const link = await getLink(db, userId, c.req.param('id'));
  if (!link) return notFound(c);
  const at = now();
  const since = link.snapshot_claimed_at
    ? at.getTime() - Date.parse(link.snapshot_claimed_at)
    : NaN;
  if (since < SNAPSHOT_INTERVAL_MS) {
    c.header('Retry-After', String(Math.max(1, Math.ceil((SNAPSHOT_INTERVAL_MS - since) / 1000))));
    return refusal(c, 429, 'snapshot_recent', 'a snapshot was taken recently');
  }
  const stamp = at.toISOString();
  const claimed = await db
    .prepare(
      `UPDATE links SET snapshot_claimed_at = ?1, snapshot_requested_at = ?1, snapshot_error = NULL,
         updated_at = ?1
       WHERE id = ?2 AND user_id = ?3 AND snapshot_claimed_at IS ?4
       RETURNING id`,
    )
    .bind(stamp, link.id, userId, link.snapshot_claimed_at)
    .first();
  if (!claimed) {
    return refusal(c, 429, 'snapshot_recent', 'a snapshot was taken recently');
  }
  try {
    await c.env.FETCH_QUEUE.send({
      user_id: userId,
      link_id: link.id,
      refresh: true,
      snapshot: true,
    });
  } catch (err) {
    console.error('a snapshot could not be queued', err);
    await db
      .prepare(
        `UPDATE links SET snapshot_claimed_at = ?1, snapshot_requested_at = ?2, snapshot_error = ?3
         WHERE id = ?4 AND user_id = ?5 AND snapshot_claimed_at = ?6`,
      )
      .bind(
        link.snapshot_claimed_at,
        link.snapshot_requested_at,
        link.snapshot_error,
        link.id,
        userId,
        stamp,
      )
      .run();
    return refusal(c, 503, 'unavailable', 'the snapshot could not be queued');
  }
  return c.json({ status: 'queued' }, 202);
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

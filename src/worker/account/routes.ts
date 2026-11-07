import { Hono } from 'hono';
import { notFound } from '../api/errors';
import type { AppEnv } from '../env';
import { readerBody, snapshotResponse } from '../fetcher/routes';
import { getLink } from '../links/store';
import { exportResponse, hasReader } from './export';

/** The export, under /api/v1/export. */
export const exportRoutes = new Hono<AppEnv>();

exportRoutes.get('/', (c) => exportResponse(c.env, c.get('user')));

/** 404 for the user's own link with nothing of the kind asked for stored. */
const NO_CONTENT = { error: 'no_content' };

/**
 * A link's stored snapshot, exactly as GET /api/v1/links/{id}/snapshot serves
 * it, archived links included, recording no use: fetching a backup is not
 * using the library.
 */
exportRoutes.get('/links/:id/snapshot', async (c) => {
  const link = await getLink(c.env.DB, c.get('user').id, c.req.param('id'));
  if (!link) return notFound(c);
  if (!link.has_snapshot) return c.json(NO_CONTENT, 404);
  return (await snapshotResponse(c.env, link, false)) ?? c.json(NO_CONTENT, 404);
});

/** A link's reader view, exactly as GET /api/v1/links/{id}/reader serves it, recording no use. */
exportRoutes.get('/links/:id/reader', async (c) => {
  const link = await getLink(c.env.DB, c.get('user').id, c.req.param('id'));
  if (!link) return notFound(c);
  if (!hasReader(link)) return c.json(NO_CONTENT, 404);
  return c.json(await readerBody(c.env, link));
});

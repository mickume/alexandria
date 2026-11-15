import { Hono, type Context } from 'hono';
import { notFound } from '../api/errors';
import type { AppEnv } from '../env';
import {
  snapshotBody,
  snapshotFileResponse,
  snapshotImageResponse,
  textBody,
} from '../fetcher/routes';
import { getLink, type LinkRow } from '../links/store';
import { publicOrigin } from '../origin';
import { exportLinkBase, exportResponse } from './export';

/** The export, under /api/v1/export. */
export const exportRoutes = new Hono<AppEnv>();

exportRoutes.get('/', (c) => exportResponse(c.env, c.get('user'), publicOrigin(c.env, c.req.url)));

/** 404 for the user's own link with nothing of the kind asked for stored. */
const NO_CONTENT = { error: 'no_content' };

/** The user's link, or the 404 answer. */
async function ownLink(c: Context<AppEnv>): Promise<LinkRow | Response> {
  const link = await getLink(c.env.DB, c.get('user').id, c.req.param('id') ?? '');
  return link ?? notFound(c);
}

/*
 * A link's stored content, exactly as the link's own routes serve it, expired
 * links included, recording no use: fetching a backup is not using the
 * library. The snapshot's image and file addresses are the export's own.
 */

exportRoutes.get('/links/:id/snapshot', async (c) => {
  const link = await ownLink(c);
  if (link instanceof Response) return link;
  const base = exportLinkBase(publicOrigin(c.env, c.req.url), link.id);
  const body = link.has_snapshot ? await snapshotBody(c.env, link, base) : null;
  return body ? c.json(body) : c.json(NO_CONTENT, 404);
});

exportRoutes.get('/links/:id/snapshot/file', async (c) => {
  const link = await ownLink(c);
  if (link instanceof Response) return link;
  const response = await snapshotFileResponse(c.env, link, c.req.query('download') === '1');
  return response ?? c.json(NO_CONTENT, 404);
});

exportRoutes.get('/links/:id/snapshot/images/:name', async (c) => {
  const link = await ownLink(c);
  if (link instanceof Response) return link;
  return (await snapshotImageResponse(c.env, link, c.req.param('name'))) ?? notFound(c);
});

exportRoutes.get('/links/:id/text', async (c) => {
  const link = await ownLink(c);
  if (link instanceof Response) return link;
  const body = await textBody(c.env, link);
  return body ? c.json(body) : c.json(NO_CONTENT, 404);
});

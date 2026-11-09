import { Hono } from 'hono';
import { notFound } from './api/errors';
import { openApiDocument } from './api/openapi';
import { rateLimit } from './api/ratelimit';
import { requireAuth, servePage } from './auth/middleware';
import { authRoutes, tokenRoutes } from './auth/routes';
import { requestDeletion } from './account/deletion';
import { exportRoutes } from './account/routes';
import { expiredRoutes, restoreRoutes } from './decay/archive';
import { checkRoutes } from './decay/liveness';
import { decaySettingsRoutes } from './decay/routes';
import { enrichLinkRoutes, settingsRoutes } from './enrich/routes';
import { firecrawlSettingsRoutes } from './fetcher/firecrawl';
import type { AppEnv } from './env';
import { aboutRoutes, snapshotRoutes } from './fetcher/routes';
import { importRoutes } from './imports/routes';
import { linkRoutes } from './links/routes';
import { askRoutes } from './meaning/ask';
import { passageRoutes } from './meaning/passages';
import { mcpRoutes } from './mcp/server';
import { searchRoutes, tagRoutes, topicRoutes } from './search/routes';
import { workspaceRoutes } from './workspaces/routes';

/** The JSON API under /api/v1/; every route needs an authenticated user. */
function createApi(): Hono<AppEnv> {
  const api = new Hono<AppEnv>();
  api.use('*', requireAuth, rateLimit);
  api.get('/me', (c) => {
    const { email, name } = c.get('user');
    return c.json({ email, name });
  });
  api.delete('/me', requestDeletion);
  api.get('/openapi.json', (c) => c.json(openApiDocument()));
  api.route('/tokens', tokenRoutes);
  api.route('/settings', settingsRoutes);
  api.route('/settings', decaySettingsRoutes);
  api.route('/settings', firecrawlSettingsRoutes);
  api.route('/links', enrichLinkRoutes);
  api.route('/links', restoreRoutes);
  api.route('/links', checkRoutes);
  api.route('/links', snapshotRoutes);
  api.route('/links', linkRoutes);
  api.route('/workspaces', workspaceRoutes);
  api.route('/expired', expiredRoutes);
  api.route('/export', exportRoutes);
  api.route('/imports', importRoutes);
  api.route('/search', searchRoutes);
  api.route('/passages', passageRoutes);
  api.route('/ask', askRoutes);
  api.route('/topics', topicRoutes);
  api.route('/tags', tagRoutes);
  api.all('*', notFound);
  return api;
}

/** Builds the application: the API under /api/v1/, the sign-in routes and the website's pages. */
export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const api = createApi();
  app.route('/api/v1', api);
  app.route('/mcp', mcpRoutes(api));
  app.route('/auth', authRoutes);
  app.route('/about', aboutRoutes);
  app.get('*', servePage);
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'internal' }, 500);
  });
  return app;
}

/** The application the Worker serves. */
export const app = createApp();

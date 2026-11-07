import { Hono } from 'hono';
import { notFound } from './api/errors';
import { openApiDocument } from './api/openapi';
import { rateLimit } from './api/ratelimit';
import { requireAuth, servePage } from './auth/middleware';
import { authRoutes, tokenRoutes } from './auth/routes';
import { decaySettingsRoutes } from './decay/routes';
import { enrichLinkRoutes, settingsRoutes } from './enrich/routes';
import type { AppEnv } from './env';
import { aboutRoutes, snapshotRoutes } from './fetcher/routes';
import { linkRoutes } from './links/routes';
import { workspaceRoutes } from './workspaces/routes';

/** The JSON API under /api/v1/; every route needs an authenticated user. */
function createApi(): Hono<AppEnv> {
  const api = new Hono<AppEnv>();
  api.use('*', requireAuth, rateLimit);
  api.get('/me', (c) => {
    const { email, name } = c.get('user');
    return c.json({ email, name });
  });
  api.get('/openapi.json', (c) => c.json(openApiDocument()));
  api.route('/tokens', tokenRoutes);
  api.route('/settings', settingsRoutes);
  api.route('/settings', decaySettingsRoutes);
  api.route('/links', enrichLinkRoutes);
  api.route('/links', snapshotRoutes);
  api.route('/links', linkRoutes);
  api.route('/workspaces', workspaceRoutes);
  api.all('*', notFound);
  return api;
}

/** Builds the application: the API under /api/v1/, the sign-in routes and the website's pages. */
export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/api/v1', createApi());
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

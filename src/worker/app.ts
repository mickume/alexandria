import { Hono } from 'hono';
import { requireAuth, servePage } from './auth/middleware';
import { authRoutes } from './auth/routes';
import type { AppEnv } from './env';

/** The JSON API under /api/v1/; every route needs an authenticated user. */
function createApi(): Hono<AppEnv> {
  const api = new Hono<AppEnv>();
  api.use('*', requireAuth);
  api.get('/me', (c) => {
    const { email, name } = c.get('user');
    return c.json({ email, name });
  });
  api.all('*', (c) => c.json({ error: 'not_found' }, 404));
  return api;
}

/** Builds the application: the API under /api/v1/, the sign-in routes and the website's pages. */
export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/api/v1', createApi());
  app.route('/auth', authRoutes);
  app.get('*', servePage);
  return app;
}

/** The application the Worker serves. */
export const app = createApp();

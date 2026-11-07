import { Hono } from 'hono';
import type { AppEnv } from './env';

/** Builds the application: the API under /api/v1/, the sign-in routes and the website's pages. */
export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));
  return app;
}

/** The application the Worker serves. */
export const app = createApp();

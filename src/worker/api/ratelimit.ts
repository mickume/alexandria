import { createMiddleware } from 'hono/factory';
import { now } from '../clock';
import { internalRequests } from '../auth/middleware';
import type { AppEnv } from '../env';

/** Requests a user may make to /api/v1/ in one minute, across sessions and tokens. */
export const REQUESTS_PER_MINUTE = 600;

const MINUTE = 60_000;

/**
 * Counts the authenticated user's requests per clock minute and refuses those
 * past the limit with 429 and Retry-After, before the route runs. Runs after
 * authentication, so each user has a budget of their own. The Worker's own
 * internal requests are not counted: the request they serve was.
 */
export const rateLimit = createMiddleware<AppEnv>(async (c, next) => {
  if (internalRequests.has(c.req.raw)) return next();
  const t = now().getTime();
  const window = Math.floor(t / MINUTE) * MINUTE;
  const user = c.get('user').id;
  const row = await c.env.DB.prepare(
    `INSERT INTO rate_limits (user_id, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT (user_id, window_start) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(user, window)
    .first<{ count: number }>();
  const used = row?.count ?? 1;
  if (used === 1) {
    // The first request of a minute clears the user's earlier windows.
    await c.env.DB.prepare('DELETE FROM rate_limits WHERE user_id = ? AND window_start < ?')
      .bind(user, window)
      .run();
  }
  if (used > REQUESTS_PER_MINUTE) {
    const retryAfter = Math.min(60, Math.max(1, Math.ceil((window + MINUTE - t) / 1000)));
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'rate_limited' }, 429);
  }
  await next();
});

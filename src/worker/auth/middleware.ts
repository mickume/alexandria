import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { refusal, unauthorized } from '../api/errors';
import type { AppEnv, AuthUser } from '../env';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, useSession } from './sessions';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Re-sends the session cookie so that the browser keeps it as long as the renewed session. */
function renewCookie(c: Context<AppEnv>, session: string): void {
  setCookie(c, SESSION_COOKIE, session, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** The user of the request's session cookie, renewing the session, or null. */
async function sessionUser(c: Context<AppEnv>): Promise<AuthUser | null> {
  const session = getCookie(c, SESSION_COOKIE);
  if (!session) return null;
  const user = await useSession(c.env.DB, session);
  if (user) renewCookie(c, session);
  return user;
}

/**
 * Whether a cookie-authenticated change comes from the site itself. The cookie
 * is the website's credential; this stops another site from acting with it.
 */
function sameOrigin(c: Context<AppEnv>): boolean {
  return c.req.header('Origin') === c.env.PUBLIC_ORIGIN;
}

/**
 * Authenticates every request under /api/v1/: a bearer token or the session
 * cookie. Anything else is answered 401 before the route runs. A change
 * authenticated by the cookie must come from PUBLIC_ORIGIN.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = createMiddleware<AppEnv>(async (c, next) => {
  const authorization = c.req.header('Authorization');
  if (authorization !== undefined) {
    // Personal access tokens are recognised from the tokens module.
    return unauthorized(c);
  }
  const user = await sessionUser(c);
  if (!user) return unauthorized(c);
  if (UNSAFE_METHODS.has(c.req.method) && !sameOrigin(c))
    return refusal(c, 403, 'forbidden_origin');
  c.set('user', user);
  c.set('via', 'session');
  await next();
});

/** Whether a website path is served without a session: the sign-in page and the public pages. */
function isPublicPage(path: string): boolean {
  return path === '/signin' || path.startsWith('/about/');
}

/**
 * Serves the website's pages: the sign-in page and /about/ to anyone, every
 * other page only with a valid session, redirecting to /signin otherwise.
 */
export const servePage: MiddlewareHandler<AppEnv> = async (c) => {
  if (!isPublicPage(c.req.path) && !(await sessionUser(c))) {
    return c.redirect('/signin', 302);
  }
  const page = await c.env.ASSETS.fetch(c.req.raw);
  // Copy the renewed session cookie onto the asset's response.
  const response = new Response(page.body, page);
  for (const cookie of c.res.headers.getSetCookie()) response.headers.append('Set-Cookie', cookie);
  return response;
};

/** Refuses a cookie-authenticated change from another origin; used by routes outside /api/v1/. */
export const requireSameOrigin: MiddlewareHandler<AppEnv> = createMiddleware<AppEnv>(
  async (c, next) => {
    if (UNSAFE_METHODS.has(c.req.method) && getCookie(c, SESSION_COOKIE) && !sameOrigin(c)) {
      return refusal(c, 403, 'forbidden_origin');
    }
    await next();
  },
);

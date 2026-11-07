import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import { isAllowed } from './allowlist';
import { finishSignIn, startSignIn } from './google';
import { requireSameOrigin } from './middleware';
import {
  createSession,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  upsertUser,
} from './sessions';

const STATE_COOKIE = 'alexandria_oauth_state';
const VERIFIER_COOKIE = 'alexandria_oauth_verifier';
/** The state and the verifier live for the ten minutes a sign-in may take. */
const FLOW_COOKIE_SECONDS = 600;

const flowCookie = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/auth/',
  maxAge: FLOW_COOKIE_SECONDS,
} as const;

/** Sign-in with Google and sign-out, under /auth/. */
export const authRoutes = new Hono<AppEnv>();

authRoutes.get('/google', (c) => {
  const { url, state, verifier } = startSignIn(c.env);
  setCookie(c, STATE_COOKIE, state, flowCookie);
  setCookie(c, VERIFIER_COOKIE, verifier, flowCookie);
  return c.redirect(url.toString(), 302);
});

authRoutes.get('/google/callback', async (c) => {
  const state = c.req.query('state');
  const code = c.req.query('code');
  const expectedState = getCookie(c, STATE_COOKIE);
  const verifier = getCookie(c, VERIFIER_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: flowCookie.path, secure: true });
  deleteCookie(c, VERIFIER_COOKIE, { path: flowCookie.path, secure: true });

  const failed = () => c.redirect('/signin?error=failed', 302);
  if (c.req.query('error') || !code || !state || !expectedState || !verifier) return failed();
  if (state !== expectedState) return failed();

  const identity = await finishSignIn(c.env, code, verifier);
  if (!identity) return failed();
  if (!isAllowed(c.env, identity.email)) return c.redirect('/signin?error=private', 302);

  const userId = await upsertUser(c.env.DB, identity.email, identity.name);
  const session = await createSession(c.env.DB, userId);
  setCookie(c, SESSION_COOKIE, session, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return c.redirect('/', 302);
});

authRoutes.post('/signout', requireSameOrigin, async (c) => {
  const session = getCookie(c, SESSION_COOKIE);
  if (session) await deleteSession(c.env.DB, session);
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
  return c.redirect('/signin', 302);
});

import {
  CodeChallengeMethod,
  decodeIdToken,
  generateCodeVerifier,
  generateState,
  OAuth2Client,
} from 'arctic';
import type { Env } from '../env';

/** The scopes asked of Google: just enough for the email and the display name. */
const SCOPES = ['openid', 'email', 'profile'];

/** What a sign-in keeps from Google: the email and the display name, nothing else. */
export interface GoogleIdentity {
  email: string;
  name: string;
}

function client(env: Env): OAuth2Client {
  return new OAuth2Client(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    `${env.PUBLIC_ORIGIN}/auth/google/callback`,
  );
}

/** Starts the authorization-code flow with PKCE: the URL to send the browser to, with its state and verifier. */
export function startSignIn(env: Env): { url: URL; state: string; verifier: string } {
  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = client(env).createAuthorizationURLWithPKCE(
    env.GOOGLE_AUTH_URL,
    state,
    CodeChallengeMethod.S256,
    verifier,
    SCOPES,
  );
  return { url, state, verifier };
}

/**
 * Exchanges an authorization code for the signed-in identity. The ID token
 * comes straight from Google's token endpoint over TLS, so its claims are read
 * without verifying its signature. Every token Google returns is dropped here.
 * Returns null when the exchange is refused or the identity is unusable.
 */
export async function finishSignIn(
  env: Env,
  code: string,
  verifier: string,
): Promise<GoogleIdentity | null> {
  try {
    const tokens = await client(env).validateAuthorizationCode(
      env.GOOGLE_TOKEN_URL,
      code,
      verifier,
    );
    const claims = decodeIdToken(tokens.idToken()) as Record<string, unknown>;
    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    if (!email || claims.email_verified === false) return null;
    const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : email;
    return { email, name };
  } catch {
    return null;
  }
}

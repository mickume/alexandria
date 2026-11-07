import type { Env } from './env';

/**
 * The site's own origin: PUBLIC_ORIGIN when the deployment sets it, or else
 * the origin the request reached, such as the Worker's workers.dev address.
 */
export function publicOrigin(env: Pick<Env, 'PUBLIC_ORIGIN'>, requestUrl: string): string {
  return env.PUBLIC_ORIGIN || new URL(requestUrl).origin;
}

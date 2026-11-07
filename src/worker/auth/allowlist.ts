import type { Env } from '../env';

/**
 * Whether `email` is on the deployment's allow-list. ALLOWED_EMAILS is read on
 * every call, so a change to it takes effect at the next request; entries are
 * trimmed and compared case-insensitively.
 */
export function isAllowed(env: Pick<Env, 'ALLOWED_EMAILS'>, email: string): boolean {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return false;
  return (env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .some((entry) => entry === wanted);
}

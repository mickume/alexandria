import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * The API's error answers. Every error body carries `error`, a stable code;
 * validation errors add the `field` they concern and a `message` for people.
 */

/** 400: a request field is missing or not acceptable. */
export function validationError(
  c: Context,
  error: string,
  field: string | null,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return c.json({ error, field, message, ...extra }, 400);
}

/** 401: no valid credentials. */
export function unauthorized(c: Context): Response {
  return c.json({ error: 'unauthorized' }, 401);
}

/** 404: no such resource for this user, whether it exists for another or not at all. */
export function notFound(c: Context): Response {
  return c.json({ error: 'not_found' }, 404);
}

/** 409: a limit of the user's library or account is reached. */
export function limitReached(c: Context, error: string, message: string): Response {
  return c.json({ error, message }, 409);
}

/** Any other refusal with a code and a message. */
export function refusal(
  c: Context,
  status: ContentfulStatusCode,
  error: string,
  message?: string,
): Response {
  return c.json(message === undefined ? { error } : { error, message }, status);
}

/** The parsed JSON body of a request, or the 400 invalid_json answer when it does not parse. */
export async function readJson(
  c: Context,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return {
      ok: false,
      response: validationError(c, 'invalid_json', null, 'the request body is not valid JSON'),
    };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      response: validationError(c, 'invalid_json', null, 'the request body must be a JSON object'),
    };
  }
  return { ok: true, body: body as Record<string, unknown> };
}

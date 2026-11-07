import { Hono } from 'hono';
import { limitReached, notFound, readJson, validationError } from '../api/errors';
import { decodeCursor, encodeCursor, MAX_LIMIT, parseLimit } from '../api/pagination';
import type { AppEnv, Env } from '../env';
import { now } from '../clock';
import { applyEdit, parseEdit } from '../enrich/edits';
import { deleteLinkObjects } from '../fetcher/snapshots';
import { normalizeUrl } from './normalize';
import {
  addLink,
  addLinks,
  deleteLink,
  getLink,
  pinLink,
  toView,
  unpinLink,
  type LinkView,
  type NewLink,
} from './store';
import { isStreamCursor, listChanged, listStream, parseTimestamp } from './stream';
import { isHistoryCursor, listHistory, recordUse } from './use';

/** The most URLs one batch may carry. */
export const BATCH_LIMIT = 100;

const INVALID_URL_MESSAGE = 'not a valid web address';
const LIBRARY_FULL_MESSAGE = 'library full (20,000 links)';

/** Asks the fetcher to fetch each newly added link. */
async function queueFetches(env: Env, userId: string, links: LinkView[]): Promise<void> {
  if (links.length === 0) return;
  await env.FETCH_QUEUE.sendBatch(links.map((l) => ({ body: { user_id: userId, link_id: l.id } })));
}

/** The user's links, under /api/v1/links. */
export const linkRoutes = new Hono<AppEnv>();

linkRoutes.post('/', async (c) => {
  const parsed = await readJson(c);
  if (!parsed.ok) return parsed.response;
  const input = parsed.body.url;
  const normalized = typeof input === 'string' ? normalizeUrl(input) : null;
  if (!normalized?.ok) {
    return validationError(c, 'invalid_url', 'url', INVALID_URL_MESSAGE, { url: input ?? null });
  }
  const result = await addLink(c.env.DB, c.get('user').id, {
    url: normalized.url,
    original: (input as string).trim(),
  });
  if (result.status === 'library_full')
    return limitReached(c, 'library_full', LIBRARY_FULL_MESSAGE);
  if (result.status === 'added') await queueFetches(c.env, c.get('user').id, [result.link]);
  return c.json(result, result.status === 'added' ? 201 : 200);
});

linkRoutes.post('/batch', async (c) => {
  const parsed = await readJson(c);
  if (!parsed.ok) return parsed.response;
  const urls = parsed.body.urls;
  if (!Array.isArray(urls) || urls.length === 0) {
    return validationError(c, 'no_urls', 'urls', 'a list of 1 to 100 URLs is required');
  }
  if (urls.length > BATCH_LIMIT) {
    return validationError(c, 'too_many_urls', 'urls', `at most ${BATCH_LIMIT} URLs at once`);
  }

  const invalid: { url: unknown; error: 'invalid_url' | 'library_full' }[] = [];
  const unique: NewLink[] = [];
  const seen = new Set<string>();
  for (const input of urls as unknown[]) {
    const normalized = typeof input === 'string' ? normalizeUrl(input) : null;
    if (!normalized?.ok) {
      invalid.push({ url: input, error: 'invalid_url' });
      continue;
    }
    if (seen.has(normalized.url)) continue;
    seen.add(normalized.url);
    unique.push({ url: normalized.url, original: (input as string).trim() });
  }

  const added: LinkView[] = [];
  const boosted: LinkView[] = [];
  const outcomes = await addLinks(c.env.DB, c.get('user').id, unique);
  outcomes.forEach((o, i) => {
    if (o.status === 'added') added.push(o.link);
    else if (o.status === 'boosted') boosted.push(o.link);
    else invalid.push({ url: unique[i]?.original, error: 'library_full' });
  });
  await queueFetches(c.env, c.get('user').id, added);
  return c.json({ added, boosted, invalid });
});

linkRoutes.get('/', async (c) => {
  const changedSince = c.req.query('changed_since');
  if (changedSince !== undefined) {
    const since = parseTimestamp(changedSince);
    if (!since) {
      return validationError(
        c,
        'invalid_changed_since',
        'changed_since',
        'changed_since must be an ISO 8601 timestamp, such as a server_time',
      );
    }
    const serverTime = now().toISOString();
    const rows = await listChanged(c.env.DB, c.get('user').id, since);
    return c.json({ items: rows.map(toView), server_time: serverTime });
  }
  const limit = parseLimit(c.req.query('limit'));
  if (limit === null) {
    return validationError(
      c,
      'invalid_limit',
      'limit',
      `limit must be an integer from 1 to ${MAX_LIMIT}`,
    );
  }
  const raw = c.req.query('cursor');
  let after = null;
  if (raw !== undefined) {
    after = await decodeCursor(c.env, raw);
    if (!isStreamCursor(after)) {
      return validationError(
        c,
        'invalid_cursor',
        'cursor',
        'the cursor was not issued by this API',
      );
    }
  }
  const page = await listStream(c.env.DB, c.get('user').id, limit, after);
  return c.json({
    items: page.items.map(toView),
    next_cursor: page.next ? await encodeCursor(c.env, page.next) : null,
  });
});

linkRoutes.get('/:id', async (c) => {
  const row = await getLink(c.env.DB, c.get('user').id, c.req.param('id'));
  return row ? c.json(toView(row)) : notFound(c);
});

linkRoutes.get('/:id/open', async (c) => {
  const url = await recordUse(c.env.DB, c.get('user').id, c.req.param('id'));
  return url ? c.redirect(url, 302) : notFound(c);
});

linkRoutes.get('/:id/history', async (c) => {
  const link = await getLink(c.env.DB, c.get('user').id, c.req.param('id'));
  if (!link) return notFound(c);
  const limit = parseLimit(c.req.query('limit'), MAX_LIMIT);
  if (limit === null) {
    return validationError(
      c,
      'invalid_limit',
      'limit',
      `limit must be an integer from 1 to ${MAX_LIMIT}`,
    );
  }
  const raw = c.req.query('cursor');
  let after = null;
  if (raw !== undefined) {
    after = await decodeCursor(c.env, raw);
    if (!isHistoryCursor(after)) {
      return validationError(
        c,
        'invalid_cursor',
        'cursor',
        'the cursor was not issued by this API',
      );
    }
  }
  const page = await listHistory(c.env.DB, link.id, limit, after);
  return c.json({
    items: page.items,
    next_cursor: page.next ? await encodeCursor(c.env, page.next) : null,
  });
});

linkRoutes.post('/:id/pin', async (c) => {
  const parsed = await readJson(c, { optional: true });
  if (!parsed.ok) return parsed.response;
  const position = parsed.body.position;
  if (position !== undefined && !(Number.isInteger(position) && (position as number) >= 1)) {
    return validationError(
      c,
      'invalid_position',
      'position',
      'position must be an integer of at least 1',
    );
  }
  const result = await pinLink(
    c.env.DB,
    c.get('user').id,
    c.req.param('id'),
    position as number | undefined,
  );
  if (result.status === 'not_found') return notFound(c);
  if (result.status === 'pin_limit') return limitReached(c, 'pin_limit', 'unpin something first');
  return c.json(result.link);
});

linkRoutes.delete('/:id/pin', async (c) => {
  const link = await unpinLink(c.env.DB, c.get('user').id, c.req.param('id'));
  return link ? c.json(link) : notFound(c);
});

linkRoutes.delete('/:id', async (c) => {
  const userId = c.get('user').id;
  const deleted = await deleteLink(c.env.DB, userId, c.req.param('id'));
  if (!deleted) return notFound(c);
  await deleteLinkObjects(c.env, userId, c.req.param('id'));
  return c.body(null, 204);
});

linkRoutes.patch('/:id', async (c) => {
  const parsed = await readJson(c);
  if (!parsed.ok) return parsed.response;
  const edit = parseEdit(parsed.body);
  if ('error' in edit) return validationError(c, edit.error, edit.field, edit.message);
  const link = await applyEdit(c.env.DB, c.get('user').id, c.req.param('id'), edit);
  return link ? c.json(toView(link)) : notFound(c);
});

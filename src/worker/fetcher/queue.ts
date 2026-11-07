import { now } from '../clock';
import type { Env, FetchMessage } from '../env';
import { afterFetch } from '../enrich/queue';
import { getLink, parseStrings, type LinkRow } from '../links/store';
import { fetchPage, type FetchFailed, type FetchOk } from './fetch';
import { extractMetadata } from './html';
import { readPdf } from './pdf';
import { capText, extractReader } from './reader';
import { deleteLinkObjects, readerKey, snapshotKey, type StoredReader } from './snapshots';

/** Failed attempts of a link's first fetch before it is given up as unreachable. */
export const MAX_ATTEMPTS = 3;
/** The delays before the second and the third attempt. */
const RETRY_DELAYS_SECONDS = [600, 7200];

/** The statement that records one fetch attempt in the link's history. */
function eventStatement(
  env: Env,
  link: LinkRow,
  at: string,
  outcome: 'ok' | 'failed',
  httpStatus: number | null,
  reason: string | null,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO link_events (link_id, user_id, kind, at, outcome, http_status, reason)
     SELECT id, user_id, 'fetch', ?1, ?2, ?3, ?4 FROM links WHERE id = ?5 AND user_id = ?6`,
  ).bind(at, outcome, httpStatus, reason, link.id, link.user_id);
}

/**
 * Records a failed attempt. A link still waiting for its first fetch counts
 * the attempt and is fetched again after 10 minutes, then 2 hours; after the
 * third failure it is unreachable. Any other link (a refresh) only gets the
 * event: what it had stays.
 */
async function recordFailure(
  env: Env,
  link: LinkRow,
  message: FetchMessage,
  failure: FetchFailed,
): Promise<void> {
  const at = now().toISOString();
  const event = eventStatement(env, link, at, 'failed', failure.status ?? null, failure.reason);
  if (message.refresh || link.state !== 'pending') {
    // The link keeps what it had; only its history and its change time move.
    await env.DB.batch([
      event,
      env.DB.prepare('UPDATE links SET updated_at = ? WHERE id = ? AND user_id = ?').bind(
        at,
        link.id,
        link.user_id,
      ),
    ]);
    return;
  }
  const attempts = link.fetch_attempts + 1;
  const state = attempts >= MAX_ATTEMPTS ? 'unreachable' : 'pending';
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE links SET state = ?, state_reason = ?, fetch_attempts = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).bind(state, failure.reason, attempts, at, link.id, link.user_id),
    event,
  ]);
  const delaySeconds = RETRY_DELAYS_SECONDS[attempts - 1];
  if (state === 'pending' && delaySeconds !== undefined) {
    await env.FETCH_QUEUE.send({ user_id: link.user_id, link_id: link.id }, { delaySeconds });
  }
}

/** An object a fetch writes to SNAPSHOTS. */
interface StoredObject {
  key: string;
  body: Uint8Array | string;
  contentType: string;
}

/** What a successful fetch stores on the link's row. */
interface Fetched {
  title: string;
  description: string | null;
  faviconUrl: string | null;
  language: string | null;
  contentKind: 'html' | 'pdf' | 'other';
  hasSnapshot: boolean;
  readerEmpty: boolean;
  notes: string[];
  /** The reader-view text to store, or null to store none. */
  text: string | null;
}

/** The last path segment of `url`, decoded, or its host when the path has none. */
export function lastSegmentOrHost(url: string): string {
  const u = new URL(url);
  const segment = u.pathname.split('/').filter(Boolean).at(-1);
  if (!segment) return u.host;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Writes a successful fetch: the objects first, then the link's row and its
 * text in one D1 batch. Returns false when the link was deleted meanwhile, in
 * which case nothing is left behind. When a write fails, the objects this
 * attempt wrote are removed and the error is thrown, leaving the row as it was.
 */
async function writeFetched(
  env: Env,
  link: LinkRow,
  result: FetchOk,
  fetched: Fetched,
  objects: StoredObject[],
): Promise<boolean> {
  const written: string[] = [];
  try {
    for (const o of objects) {
      await env.SNAPSHOTS.put(o.key, o.body, { httpMetadata: { contentType: o.contentType } });
      written.push(o.key);
    }
    const at = now().toISOString();
    const [update] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE links SET state = 'active', state_reason = NULL, fetch_attempts = 0,
           title = CASE WHEN EXISTS (SELECT 1 FROM json_each(edited_fields) WHERE value = 'title')
                   THEN title ELSE ?1 END,
           final_url = ?2,
           http_status = ?3, description = ?4, favicon_url = ?5, language = ?6, fetched_at = ?7,
           content_kind = ?8, has_snapshot = ?9, reader_empty = ?10, notes = ?11, updated_at = ?7
         WHERE id = ?12 AND user_id = ?13`,
      ).bind(
        fetched.title,
        result.finalUrl,
        result.status,
        fetched.description,
        fetched.faviconUrl,
        fetched.language,
        at,
        fetched.contentKind,
        fetched.hasSnapshot ? 1 : 0,
        fetched.readerEmpty ? 1 : 0,
        JSON.stringify(fetched.notes),
        link.id,
        link.user_id,
      ),
      env.DB.prepare('DELETE FROM link_texts WHERE link_id = ? AND user_id = ?').bind(
        link.id,
        link.user_id,
      ),
      env.DB.prepare(
        `INSERT INTO link_texts (link_id, user_id, text)
         SELECT id, user_id, ?1 FROM links WHERE id = ?2 AND user_id = ?3 AND ?1 IS NOT NULL`,
      ).bind(fetched.text, link.id, link.user_id),
      eventStatement(env, link, at, 'ok', result.status, null),
    ]);
    if (!update?.meta.changes) {
      await deleteLinkObjects(env, link.user_id, link.id);
      return false;
    }
    if (!fetched.hasSnapshot) {
      // A fetch that keeps no snapshot replaces whatever an earlier fetch stored.
      await deleteLinkObjects(env, link.user_id, link.id);
    }
    return true;
  } catch (err) {
    if (written.length > 0) await env.SNAPSHOTS.delete(written).catch(() => undefined);
    throw err;
  }
}

/** Stores a fetched web page: its metadata, the snapshot and the reader view. */
async function storeHtml(env: Env, link: LinkRow, result: FetchOk & { body: Uint8Array }) {
  const html = new TextDecoder().decode(result.body);
  const meta = extractMetadata(html, result.finalUrl);
  const reader = extractReader(html, result.finalUrl);
  const stored: StoredReader = { title: reader.title, byline: reader.byline, html: reader.html };
  const objects: StoredObject[] = [
    {
      key: snapshotKey(link.user_id, link.id),
      body: result.body,
      contentType: 'text/html; charset=utf-8',
    },
  ];
  if (!reader.empty) {
    objects.push({
      key: readerKey(link.user_id, link.id),
      body: JSON.stringify(stored),
      contentType: 'application/json',
    });
  }
  return writeFetched(
    env,
    link,
    result,
    {
      title: meta.title,
      description: meta.description,
      faviconUrl: meta.faviconUrl,
      language: meta.language,
      contentKind: 'html',
      hasSnapshot: true,
      readerEmpty: reader.empty,
      notes: result.truncated ? ['truncated'] : [],
      text: reader.empty ? null : capText(reader.text),
    },
    objects,
  );
}

/** Stores a fetched resource that is neither a web page nor a PDF: no snapshot, a note. */
function storeOther(env: Env, link: LinkRow, result: FetchOk) {
  return writeFetched(
    env,
    link,
    result,
    {
      title: lastSegmentOrHost(result.finalUrl),
      description: null,
      faviconUrl: null,
      language: null,
      contentKind: 'other',
      hasSnapshot: false,
      readerEmpty: true,
      notes: [`not a web page (${result.contentType || 'unknown type'})`],
      text: null,
    },
    [],
  );
}

/** Stores a fetched PDF whole, with its title and text; a PDF over 50 MB is not stored. */
async function storePdf(env: Env, link: LinkRow, result: FetchOk) {
  const name = lastSegmentOrHost(result.finalUrl);
  const base = { description: null, faviconUrl: null, language: null, contentKind: 'pdf' as const };
  if (!result.body) {
    return writeFetched(
      env,
      link,
      result,
      {
        ...base,
        title: name,
        hasSnapshot: false,
        readerEmpty: true,
        notes: ['PDF too large to store (50 MB limit)'],
        text: null,
      },
      [],
    );
  }
  const { title, text } = await readPdf(result.body);
  return writeFetched(
    env,
    link,
    result,
    {
      ...base,
      title: title ?? name,
      hasSnapshot: true,
      readerEmpty: text === '',
      notes: text === '' ? ['no text in this PDF'] : [],
      text: text === '' ? null : capText(text),
    },
    [
      {
        key: snapshotKey(link.user_id, link.id),
        body: result.body,
        contentType: 'application/pdf',
      },
    ],
  );
}

/** Stores what a successful fetch returned; false when the link was deleted meanwhile. */
async function storeResult(env: Env, link: LinkRow, result: FetchOk): Promise<boolean> {
  if (result.kind === 'html' && result.body) {
    return storeHtml(env, link, { ...result, body: result.body });
  }
  if (result.kind === 'pdf') return storePdf(env, link, result);
  return storeOther(env, link, result);
}

/** Fetches one link's page and stores the result. */
async function processFetch(env: Env, message: Message<FetchMessage>): Promise<void> {
  const { user_id, link_id } = message.body;
  const link = await getLink(env.DB, user_id, link_id);
  if (!link) {
    await deleteLinkObjects(env, user_id, link_id);
    message.ack();
    return;
  }
  const result = await fetchPage(env, link.url);
  try {
    if (result.ok) {
      if (await storeResult(env, link, result)) {
        const stored = await getLink(env.DB, link.user_id, link.id);
        if (stored) await afterFetch(env, stored, parseStrings(stored.notes));
      }
    } else {
      await recordFailure(env, link, message.body, result);
    }
    message.ack();
  } catch (err) {
    console.error('storing a fetch failed', err);
    message.retry();
  }
}

/**
 * The FETCH_QUEUE consumer. The messages of a batch are processed
 * concurrently, so that a wait at one host's gate does not hold up the others.
 */
export async function handleFetchBatch(
  batch: MessageBatch<FetchMessage>,
  env: Env,
  _ctx?: ExecutionContext,
): Promise<void> {
  await Promise.all(batch.messages.map((m) => processFetch(env, m)));
}

import { now } from '../clock';
import type { Env, FetchMessage } from '../env';
import { getLink, type LinkRow } from '../links/store';
import { fetchPage, type FetchOk } from './fetch';
import { extractMetadata } from './html';
import { capText, extractReader } from './reader';
import { deleteLinkObjects, readerKey, snapshotKey, type StoredReader } from './snapshots';

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
        `UPDATE links SET state = 'active', state_reason = NULL, title = ?1, final_url = ?2,
           http_status = ?3, description = ?4, favicon_url = ?5, language = ?6, fetched_at = ?7,
           content_kind = ?8, has_snapshot = ?9, reader_empty = ?10, notes = ?11
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

/** Stores what a successful fetch returned. */
async function storeResult(env: Env, link: LinkRow, result: FetchOk): Promise<boolean> {
  if (result.kind === 'html' && result.body) {
    return storeHtml(env, link, { ...result, body: result.body });
  }
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
  if (!result.ok) {
    message.ack();
    return;
  }
  try {
    await storeResult(env, link, result);
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

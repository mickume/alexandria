import { now } from '../clock';
import type { Env, FetchMessage } from '../env';
import { accountActive } from '../account/deletion';
import { afterFetch } from '../enrich/queue';
import { getLink, ownerEdited, parseStrings, type LinkRow } from '../links/store';
import { queueIndexing } from '../meaning/indexing';
import { indexReaderTextStatement } from '../search/search';
import { decodeHtml, fetchPage, type FetchFailed, type FetchOk } from './fetch';
import { FIRECRAWL_NOTE, fetchThroughFirecrawl } from './firecrawl';
import { extractMetadata, parsePage, type PageMetadata } from './html';
import { readPdf } from './pdf';
import { capText, extractReader, type ReaderView } from './reader';
import { deleteLinkObjects, readerKey, snapshotKey, type StoredReader } from './snapshots';
import { cleanTitle } from './titles';

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
 * third failure, or at once when trying again will not help, it is
 * unreachable. Its title, unless edited, is read from its address, which
 * says more than the host it shows until then. Any other link (a refresh)
 * only gets the event: what it had stays.
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
  // Counted and decided on the row as it is now: a link archived or fetched
  // while this attempt ran keeps its state, and gets only the event.
  const after = `(CASE WHEN ?1 THEN ${MAX_ATTEMPTS} ELSE fetch_attempts + 1 END)`;
  const [updated] = await env.DB.batch<{ state: string; fetch_attempts: number }>([
    env.DB.prepare(
      `UPDATE links SET
         state = CASE WHEN ${after} >= ${MAX_ATTEMPTS} THEN 'unreachable' ELSE 'pending' END,
         state_reason = ?2, fetch_attempts = ${after}, updated_at = ?3,
         title = CASE WHEN ${ownerEdited('title')}
                 THEN title ELSE ?4 END
       WHERE id = ?5 AND user_id = ?6 AND state = 'pending'
       RETURNING state, fetch_attempts`,
    ).bind(
      failure.final ? 1 : 0,
      failure.reason,
      at,
      titleFromUrl(link.url),
      link.id,
      link.user_id,
    ),
    event,
  ]);
  const row = updated?.results[0];
  const delaySeconds = row ? RETRY_DELAYS_SECONDS[row.fetch_attempts - 1] : undefined;
  if (row?.state === 'pending' && delaySeconds !== undefined) {
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

/** The last path segment of `url`, decoded, or undefined when the path has none. */
function lastSegment(url: URL): string | undefined {
  const segment = url.pathname.split('/').filter(Boolean).at(-1);
  if (!segment) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The last path segment of `url`, decoded, or its host when the path has none. */
export function lastSegmentOrHost(url: string): string {
  const u = new URL(url);
  return lastSegment(u) ?? u.host;
}

/**
 * A title read from the words of `url`'s last path segment, for a page that
 * could not be fetched: "/why-git-was-replaced-4f31eae67e00" reads "Why git
 * was replaced". A file extension and a trailing id (a run of 8 or more hex
 * digits with a digit among them) are dropped, dashes, underscores and pluses
 * become spaces, and the first letter is capitalised. A path without a word
 * in its last segment (an id, a date, nothing) gives the host.
 */
export function titleFromUrl(url: string): string {
  const u = new URL(url);
  const segment = lastSegment(u);
  if (!segment) return u.host;
  const words = segment
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[-_+]+(?=[0-9a-f]*\d)[0-9a-f]{8,}$/i, '')
    .replace(/[-_+\s]+/g, ' ')
    .trim();
  // A word is letters only; an id such as 4f31eae67e00 or a date is not one.
  if (!words.split(' ').some((w) => /^\p{L}+$/u.test(w))) return u.host;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Writes a successful fetch: the objects first, then the link's row and its
 * text in one D1 batch. The title is cleaned by the title rules. The link becomes active, unless it is archived, which
 * it stays: the refresh that archiving queues must not undo it. Returns false when the link was deleted meanwhile, in
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
        `UPDATE links SET state = CASE WHEN state = 'archived' THEN 'archived' ELSE 'active' END,
           state_reason = NULL, fetch_attempts = 0,
           title = CASE WHEN ${ownerEdited('title')}
                   THEN title ELSE ?1 END,
           final_url = ?2,
           http_status = ?3, description = ?4, favicon_url = ?5, language = ?6, fetched_at = ?7,
           content_kind = ?8, has_snapshot = ?9, reader_empty = ?10, notes = ?11, updated_at = ?7
         WHERE id = ?12 AND user_id = ?13`,
      ).bind(
        cleanTitle(fetched.title, result.finalUrl),
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
      indexReaderTextStatement(env.DB, link.id, fetched.text),
      eventStatement(env, link, at, 'ok', result.status, null),
    ]);
    if (!update?.meta.changes) {
      await deleteLinkObjects(env, link.user_id, link.id);
      return false;
    }
    if (!fetched.hasSnapshot) {
      // A fetch that keeps no snapshot replaces whatever an earlier fetch stored.
      await deleteLinkObjects(env, link.user_id, link.id);
    } else if (fetched.readerEmpty) {
      // Nor does the reader view of an earlier fetch outlive a page without one.
      await env.SNAPSHOTS.delete(readerKey(link.user_id, link.id));
    }
    return true;
  } catch (err) {
    // A link that had a copy keeps what is there: the objects written took the
    // place of that copy, and deleting them would leave it with none.
    if (written.length > 0 && !link.has_snapshot) {
      await env.SNAPSHOTS.delete(written).catch(() => undefined);
    }
    throw err;
  }
}

/** The note on a page stored without metadata or reader view, because it could not be parsed. */
export const UNREADABLE_NOTE = 'page could not be read';

/** Stores a fetched web page: its metadata, the snapshot and the reader view. */
async function storeHtml(env: Env, link: LinkRow, result: FetchOk & { body: Uint8Array }) {
  const { html, utf8 } = decodeHtml(result.body, result.charset);
  // A page that cannot be parsed, or is nested too deep to read, is still a
  // page: it keeps its snapshot, with a note, and trying again would end the
  // same way.
  let meta: PageMetadata = {
    title: titleFromUrl(result.finalUrl),
    description: null,
    faviconUrl: `${new URL(result.finalUrl).origin}/favicon.ico`,
    language: null,
  };
  let reader: ReaderView = { title: null, byline: null, html: null, text: '', empty: true };
  let unreadable = false;
  try {
    // One parse for both, the metadata first: the reader view takes the document apart.
    const document = parsePage(html);
    meta = extractMetadata(document, result.finalUrl);
    reader = extractReader(document, result.finalUrl);
  } catch (err) {
    console.error('a fetched page could not be read', err);
    unreadable = true;
  }
  const stored: StoredReader = { title: reader.title, byline: reader.byline, html: reader.html };
  const objects: StoredObject[] = [
    {
      key: snapshotKey(link.user_id, link.id),
      // Stored as UTF-8, as it is served: the bytes when they are UTF-8 already.
      body: utf8 ? result.body : html,
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
      notes: [
        ...(result.via === 'firecrawl' ? [FIRECRAWL_NOTE] : []),
        ...(result.truncated ? ['truncated'] : []),
        ...(unreadable ? [UNREADABLE_NOTE] : []),
      ],
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

/**
 * Fetches one link's page and stores the result. A page behind a bot check is
 * fetched again through the owner's Firecrawl key, when they stored one.
 */
async function processFetch(env: Env, message: Message<FetchMessage>): Promise<void> {
  const { user_id, link_id } = message.body;
  // Whatever fails here fails this message alone: the others of its batch go on.
  try {
    // An account being deleted is fetched for no more.
    if (!(await accountActive(env.DB, user_id))) return message.ack();
    const link = await getLink(env.DB, user_id, link_id);
    if (!link) {
      await deleteLinkObjects(env, user_id, link_id);
      message.ack();
      return;
    }
    let result = await fetchPage(env, link.url);
    if (!result.ok && result.final) {
      result = await fetchThroughFirecrawl(env, user_id, link.url, result);
    }
    // Nor is anything written for it when its deletion began during the fetch.
    if (!(await accountActive(env.DB, user_id))) return message.ack();
    if (result.ok) {
      if (await storeResult(env, link, result)) {
        const stored = await getLink(env.DB, link.user_id, link.id);
        if (stored) await afterFetch(env, stored, parseStrings(stored.notes));
        await queueIndexing(env, link.user_id, [link.id]);
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
export async function handleFetchBatch(batch: MessageBatch<FetchMessage>, env: Env): Promise<void> {
  await Promise.all(batch.messages.map((m) => processFetch(env, m)));
}

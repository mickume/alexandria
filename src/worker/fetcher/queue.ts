import { now } from '../clock';
import type { Env, FetchMessage } from '../env';
import { accountActive } from '../account/deletion';
import { afterFetch } from '../enrich/queue';
import { getLink, ownerEdited, parseStrings, type LinkRow } from '../links/store';
import { queueIndexing } from '../meaning/indexing';
import { pauseRetrieval } from '../retrievers/backfill';
import { findRetriever, retrieve, retrievedNote } from '../retrievers/registry';
import type { Retrieved, Retriever, SiteView } from '../retrievers/retriever';
import { indexReaderTextStatement } from '../search/search';
import { decodeHtml, fetchPage, type FetchFailed, type FetchOk } from './fetch';
import { FIRECRAWL_NOTE, fetchThroughFirecrawl } from './firecrawl';
import { extractMetadata, parsePage, type PageMetadata } from './html';
import { missingImagesNote, saveImages, type StoredObject } from './images';
import { readPdf } from './pdf';
import { capText, extractReader, type ReaderView } from './reader';
import {
  ARTICLE_OBJECT,
  PDF_OBJECT,
  deleteFolder,
  deleteLinkObjects,
  imageAddressPrefix,
  snapshotFolder,
  type StoredArticle,
} from './snapshots';
import { cleanTitle } from './titles';

/** Failed attempts of a link's first fetch before it is given up as unreachable. */
export const MAX_ATTEMPTS = 3;
/** The delays before the second and the third attempt. */
const RETRY_DELAYS_SECONDS = [600, 7200];

/** The reason a snapshot of a page without an article fails. */
export const NO_ARTICLE_REASON = 'no readable content';
/** The note on, and the reason a snapshot fails for, a PDF too large to store. */
export const PDF_TOO_LARGE = 'PDF too large to store (50 MB limit)';

/** The statement that records one fetch or snapshot attempt in the link's history. */
function eventStatement(
  env: Env,
  link: LinkRow,
  at: string,
  outcome: 'ok' | 'failed',
  httpStatus: number | null,
  reason: string | null,
  kind: 'fetch' | 'snapshot' = 'fetch',
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO link_events (link_id, user_id, kind, at, outcome, http_status, reason)
     SELECT id, user_id, ?7, ?1, ?2, ?3, ?4 FROM links WHERE id = ?5 AND user_id = ?6`,
  ).bind(at, outcome, httpStatus, reason, link.id, link.user_id, kind);
}

/** The statements that end a snapshot asked for that failed: the reason on the link and in its history. */
function snapshotFailedStatements(
  env: Env,
  link: LinkRow,
  at: string,
  reason: string,
  httpStatus: number | null = null,
): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      `UPDATE links SET snapshot_requested_at = NULL, snapshot_error = ?1, updated_at = ?2
       WHERE id = ?3 AND user_id = ?4`,
    ).bind(reason, at, link.id, link.user_id),
    eventStatement(env, link, at, 'failed', httpStatus, reason, 'snapshot'),
  ];
}

/**
 * Records a failed attempt. A link still waiting for its first fetch counts
 * the attempt and is fetched again after 10 minutes, then 2 hours; after the
 * third failure, or at once when trying again will not help, it is
 * unreachable. Its title, unless edited, is read from its address, which
 * says more than the host it shows until then. Any other link (a refresh)
 * only gets the event: what it had stays. A snapshot that could not fetch
 * its page changes nothing but the snapshot's own state and history.
 */
async function recordFailure(
  env: Env,
  link: LinkRow,
  message: FetchMessage,
  failure: FetchFailed,
): Promise<void> {
  const at = now().toISOString();
  if (message.snapshot) {
    await env.DB.batch(
      snapshotFailedStatements(env, link, at, failure.reason, failure.status ?? null),
    );
    return;
  }
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

/** What a successful fetch stores on the link's row. */
interface Fetched {
  title: string;
  description: string | null;
  faviconUrl: string | null;
  language: string | null;
  contentKind: 'html' | 'pdf' | 'other';
  readerEmpty: boolean;
  notes: string[];
  /** The article text to store, or null to store none. */
  text: string | null;
  /** The reason the fetch event records beside its success, such as a retriever's fallback. */
  eventReason?: string | null;
  /** Set when a retriever answered: what it says the thing's address and facts are. */
  retrieved?: { finalUrl: string; site: SiteView };
}

/** What a retriever's answer stores on the link, in place of what a page fetch would. */
function fromRetrieved(retriever: Retriever, r: Retrieved): Fetched {
  return {
    title: r.title,
    description: r.description,
    faviconUrl: r.faviconUrl,
    language: r.language,
    contentKind: 'html',
    readerEmpty: r.text === null,
    notes: [retrievedNote(retriever)],
    text: r.text === null ? null : capText(r.text),
    eventReason: r.warning ?? null,
    retrieved: {
      finalUrl: r.finalUrl,
      site: {
        retriever: retriever.name,
        kind: r.kind,
        retrieved_at: now().toISOString(),
        facts: r.facts,
      },
    },
  };
}

/**
 * What a retriever adds to a page fetch: its answer, which replaces what the
 * page says about itself (the page then gives only the snapshot), or the
 * reason it could not answer, which the fetch event records.
 */
interface Retrieval {
  retrieved?: Fetched | null;
  reason?: string | null;
}

/** `fetched`, or the retriever's answer in its place, with the retrieval's reason. */
function withRetrieval(fetched: Fetched, retrieval: Retrieval): Fetched {
  return retrieval.retrieved ?? { ...fetched, eventReason: retrieval.reason ?? null };
}

/** A snapshot to store with the fetch: its folder and the objects in it. */
interface NewSnapshot {
  id: string;
  kind: 'html' | 'pdf';
  objects: StoredObject[];
  /** Set when the owner (or archiving) asked for it: it replaces any snapshot. */
  requested: boolean;
}

/** What the fetch does about the link's snapshot. */
type SnapshotOutcome =
  | { store: NewSnapshot }
  | { failed: string }
  /** Nothing: a fetch that takes no snapshot leaves the stored one alone. */
  | null;

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
 * The statements that store a new snapshot: the link points at its folder,
 * unless it is not asked for and the link has a snapshot already (a PDF's
 * refresh). Returns the id of the snapshot in place after the write.
 */
function snapshotStatements(
  env: Env,
  link: LinkRow,
  at: string,
  snapshot: NewSnapshot,
): D1PreparedStatement[] {
  const statements = [
    env.DB.prepare(
      `UPDATE links SET snapshot_id = ?1, snapshot_kind = ?2, snapshot_at = ?3, has_snapshot = 1,
         snapshot_requested_at = CASE WHEN ?4 THEN NULL ELSE snapshot_requested_at END,
         snapshot_error = CASE WHEN ?4 THEN NULL ELSE snapshot_error END,
         updated_at = ?3
       WHERE id = ?5 AND user_id = ?6 AND (?4 OR snapshot_at IS NULL)
       RETURNING snapshot_id`,
    ).bind(snapshot.id, snapshot.kind, at, snapshot.requested ? 1 : 0, link.id, link.user_id),
  ];
  if (snapshot.requested) {
    statements.push(eventStatement(env, link, at, 'ok', null, null, 'snapshot'));
  }
  return statements;
}

/**
 * Writes a successful fetch: a new snapshot's objects first, then the link's
 * row, its text and its snapshot in one D1 batch. The title is cleaned by the
 * title rules. The link becomes active, unless it is archived, which it stays.
 * Returns false when the link was deleted meanwhile, in which case nothing is
 * left behind. A new snapshot replaces the old one only once the batch has
 * pointed the link at it; when a write fails, the new snapshot's objects are
 * removed and the error is thrown, leaving the row and the old snapshot as
 * they were.
 */
async function writeFetched(
  env: Env,
  link: LinkRow,
  result: FetchOk,
  fetched: Fetched,
  snapshot: SnapshotOutcome,
): Promise<boolean> {
  const store = snapshot && 'store' in snapshot ? snapshot.store : null;
  const retrieved = fetched.retrieved;
  const status = retrieved ? 200 : result.status;
  const folder = store ? snapshotFolder(link.user_id, link.id, store.id) : null;
  try {
    for (const o of store?.objects ?? []) {
      await env.SNAPSHOTS.put(o.key, o.body, { httpMetadata: { contentType: o.contentType } });
    }
    const at = now().toISOString();
    const statements = [
      env.DB.prepare(
        `UPDATE links SET state = CASE WHEN state = 'archived' THEN 'archived' ELSE 'active' END,
           state_reason = NULL, fetch_attempts = 0,
           title = CASE WHEN ${ownerEdited('title')}
                   THEN title ELSE ?1 END,
           final_url = ?2,
           http_status = ?3, description = ?4, favicon_url = ?5, language = ?6, fetched_at = ?7,
           content_kind = ?8, reader_empty = ?9, notes = ?10, updated_at = ?7,
           site = COALESCE(?13, site)
         WHERE id = ?11 AND user_id = ?12`,
      ).bind(
        // A retriever's title is the site's own; the title rules clean a page's.
        retrieved ? fetched.title : cleanTitle(fetched.title, result.finalUrl),
        retrieved?.finalUrl ?? result.finalUrl,
        status,
        fetched.description,
        fetched.faviconUrl,
        fetched.language,
        at,
        fetched.contentKind,
        fetched.readerEmpty ? 1 : 0,
        JSON.stringify(fetched.notes),
        link.id,
        link.user_id,
        retrieved ? JSON.stringify({ ...retrieved.site, retrieved_at: at }) : null,
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
      eventStatement(env, link, at, 'ok', status, fetched.eventReason ?? null),
    ];
    if (store) statements.push(...snapshotStatements(env, link, at, store));
    else if (snapshot && 'failed' in snapshot) {
      statements.push(...snapshotFailedStatements(env, link, at, snapshot.failed));
    }
    const results = await env.DB.batch<{ snapshot_id: string }>(statements);
    if (!results[0]?.meta.changes) {
      await deleteLinkObjects(env, link.user_id, link.id);
      return false;
    }
    if (store && folder) {
      const applied = results[5]?.results[0]?.snapshot_id === store.id;
      // The new snapshot replaces every object stored before it; one not applied is removed.
      if (applied) await deleteLinkObjects(env, link.user_id, link.id, folder);
      else await deleteFolder(env, folder);
    }
    return true;
  } catch (err) {
    if (folder) await deleteFolder(env, folder).catch(() => undefined);
    throw err;
  }
}

/** The note on a page stored without metadata or article text, because it could not be parsed. */
export const UNREADABLE_NOTE = 'page could not be read';

/** A new snapshot's id and folder. */
function newSnapshotFolder(link: LinkRow): { id: string; folder: string } {
  const id = crypto.randomUUID();
  return { id, folder: snapshotFolder(link.user_id, link.id, id) };
}

/**
 * The snapshot of a web page: its article, with the article's images stored;
 * a failure when the page has no article.
 */
async function articleSnapshot(
  env: Env,
  link: LinkRow,
  reader: ReaderView,
): Promise<SnapshotOutcome> {
  if (reader.empty || reader.html === null) return { failed: NO_ARTICLE_REASON };
  const { id, folder } = newSnapshotFolder(link);
  const saved = await saveImages(env, reader.html, {
    folder,
    addressPrefix: imageAddressPrefix(link.id),
    snapshotId: id,
  });
  const article: StoredArticle = {
    title: reader.title,
    byline: reader.byline,
    html: saved.html,
    notes: saved.missing > 0 ? [missingImagesNote(saved.missing)] : [],
  };
  return {
    store: {
      id,
      kind: 'html',
      requested: true,
      objects: [
        ...saved.objects,
        {
          key: `${folder}${ARTICLE_OBJECT}`,
          body: JSON.stringify(article),
          contentType: 'application/json',
        },
      ],
    },
  };
}

/** Stores a fetched web page: its metadata and its article text, and the snapshot when one is asked for. */
async function storeHtml(
  env: Env,
  link: LinkRow,
  result: FetchOk & { body: Uint8Array },
  takeSnapshot: boolean,
  retrieval: Retrieval,
) {
  const { html } = decodeHtml(result.body, result.charset);
  // A page that cannot be parsed, or is nested too deep to read, is still a
  // page: it is stored with a note, and trying again would end the same way.
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
  const snapshot = takeSnapshot ? await articleSnapshot(env, link, reader) : null;
  return writeFetched(
    env,
    link,
    result,
    withRetrieval(
      {
        title: meta.title,
        description: meta.description,
        faviconUrl: meta.faviconUrl,
        language: meta.language,
        contentKind: 'html',
        readerEmpty: reader.empty,
        notes: [
          ...(result.via === 'firecrawl' ? [FIRECRAWL_NOTE] : []),
          ...(result.truncated ? ['truncated'] : []),
          ...(unreadable ? [UNREADABLE_NOTE] : []),
        ],
        text: reader.empty ? null : capText(reader.text),
      },
      retrieval,
    ),
    snapshot,
  );
}

/** Stores a fetched resource that is neither a web page nor a PDF: a note, and no snapshot. */
function storeOther(
  env: Env,
  link: LinkRow,
  result: FetchOk,
  takeSnapshot: boolean,
  retrieval: Retrieval,
) {
  const note = `not a web page (${result.contentType || 'unknown type'})`;
  return writeFetched(
    env,
    link,
    result,
    withRetrieval(
      {
        title: lastSegmentOrHost(result.finalUrl),
        description: null,
        faviconUrl: null,
        language: null,
        contentKind: 'other',
        readerEmpty: true,
        notes: [note],
        text: null,
      },
      retrieval,
    ),
    takeSnapshot ? { failed: note } : null,
  );
}

/**
 * Stores a fetched PDF's title and text. The file is the link's snapshot: the
 * first successful fetch stores it, and later only a snapshot asked for
 * replaces it. A PDF over 50 MB is not stored.
 */
async function storePdf(
  env: Env,
  link: LinkRow,
  result: FetchOk,
  takeSnapshot: boolean,
  retrieval: Retrieval,
) {
  const name = lastSegmentOrHost(result.finalUrl);
  const base = { description: null, faviconUrl: null, language: null, contentKind: 'pdf' as const };
  if (!result.body) {
    return writeFetched(
      env,
      link,
      result,
      withRetrieval(
        {
          ...base,
          title: name,
          readerEmpty: true,
          notes: [PDF_TOO_LARGE],
          text: null,
        },
        retrieval,
      ),
      takeSnapshot ? { failed: PDF_TOO_LARGE } : null,
    );
  }
  const { title, text } = await readPdf(result.body);
  let snapshot: SnapshotOutcome = null;
  if (takeSnapshot || !link.has_snapshot) {
    const { id, folder } = newSnapshotFolder(link);
    snapshot = {
      store: {
        id,
        kind: 'pdf',
        requested: takeSnapshot,
        objects: [
          { key: `${folder}${PDF_OBJECT}`, body: result.body, contentType: 'application/pdf' },
        ],
      },
    };
  }
  return writeFetched(
    env,
    link,
    result,
    withRetrieval(
      {
        ...base,
        title: title ?? name,
        readerEmpty: text === '',
        notes: text === '' ? ['no text in this PDF'] : [],
        text: text === '' ? null : capText(text),
      },
      retrieval,
    ),
    snapshot,
  );
}

/**
 * Stores what a successful fetch returned, with what the link's retriever
 * added to it; false when the link was deleted meanwhile.
 */
async function storeResult(
  env: Env,
  link: LinkRow,
  result: FetchOk,
  takeSnapshot: boolean,
  retrieval: Retrieval = {},
): Promise<boolean> {
  if (result.kind === 'html' && result.body) {
    return storeHtml(env, link, { ...result, body: result.body }, takeSnapshot, retrieval);
  }
  if (result.kind === 'pdf') return storePdf(env, link, result, takeSnapshot, retrieval);
  return storeOther(env, link, result, takeSnapshot, retrieval);
}

/** The link's stored text, to tell whether a fetch changed it. */
async function storedText(env: Env, link: LinkRow): Promise<string | null> {
  const row = await env.DB.prepare('SELECT text FROM link_texts WHERE link_id = ? AND user_id = ?')
    .bind(link.id, link.user_id)
    .first<{ text: string }>();
  return row?.text ?? null;
}

/** What a fetch through a retriever is written as: a 200 answer at the thing's address. */
function retrievedResult(retrieved: Fetched): FetchOk {
  return {
    ok: true,
    finalUrl: retrieved.retrieved?.finalUrl ?? '',
    status: 200,
    contentType: 'application/json',
    kind: 'html',
    body: null,
    truncated: false,
  };
}

/**
 * Fetches one link and stores the result, with a snapshot when the message
 * asks for one. An address a retriever claims is retrieved through its site's
 * API; a snapshot of it still takes the page's article, and a retriever that
 * cannot answer leaves the link to be fetched as a page, the reason recorded
 * in its history. A page behind a bot check is fetched again through the
 * deployment's Firecrawl key, when it has one. The one-time retrieval of a
 * link meeting a spent rate limit hands the link back to it instead, and
 * enriches the link again only when its text changed.
 */
async function processFetch(env: Env, message: Message<FetchMessage>): Promise<void> {
  const { user_id, link_id, backfill } = message.body;
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
    const takeSnapshot = Boolean(message.body.snapshot);
    const retrieval: Retrieval = {};
    const found = findRetriever(env, link.url);
    if (found) {
      const answer = await retrieve(env, found);
      if (answer.ok) {
        retrieval.retrieved = fromRetrieved(found.retriever, answer.value);
      } else if (backfill && answer.failure === 'rate limited') {
        await pauseRetrieval(env, found.retriever.name, user_id, link_id);
        return message.ack();
      } else {
        retrieval.reason = `${found.retriever.site} API: ${answer.failure}; fetched as the page`;
      }
    }
    const textBefore = backfill ? await storedText(env, link) : undefined;
    let stored: boolean;
    if (retrieval.retrieved && !takeSnapshot) {
      if (!(await accountActive(env.DB, user_id))) return message.ack();
      stored = await writeFetched(
        env,
        link,
        retrievedResult(retrieval.retrieved),
        retrieval.retrieved,
        null,
      );
    } else {
      let result = await fetchPage(env, link.url);
      if (!result.ok && result.final) {
        result = await fetchThroughFirecrawl(env, link.url, result);
      }
      // Nor is anything written for it when its deletion began during the fetch.
      if (!(await accountActive(env.DB, user_id))) return message.ack();
      if (!result.ok) {
        await recordFailure(env, link, message.body, result);
        return message.ack();
      }
      stored = await storeResult(env, link, result, takeSnapshot, retrieval);
    }
    if (stored) {
      const after = await getLink(env.DB, link.user_id, link.id);
      const changed = textBefore === undefined || textBefore !== (await storedText(env, link));
      if (after && changed) await afterFetch(env, after, parseStrings(after.notes));
      await queueIndexing(env, link.user_id, [link.id]);
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

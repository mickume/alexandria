import type { Env } from '../env';

/** Where a link's stored objects live in SNAPSHOTS. */
export function linkPrefix(userId: string, linkId: string): string {
  return `u/${userId}/l/${linkId}/`;
}

/** The folder of one snapshot of a link: its article and images, or its PDF. */
export function snapshotFolder(userId: string, linkId: string, snapshotId: string): string {
  return `${linkPrefix(userId, linkId)}s/${snapshotId}/`;
}

/**
 * The key of a PDF stored before snapshots had folders. Such a PDF stays the
 * link's snapshot, read from here, while the link has no snapshot id.
 */
export function legacyPdfKey(userId: string, linkId: string): string {
  return `${linkPrefix(userId, linkId)}snapshot`;
}

/** The name of a web page snapshot's article in its folder. */
export const ARTICLE_OBJECT = 'article.json';
/** The name of a PDF snapshot's file in its folder. */
export const PDF_OBJECT = 'file.pdf';

/** What a link row says about its snapshot. */
export interface SnapshotColumns {
  user_id: string;
  id: string;
  snapshot_id: string | null;
  snapshot_kind: string | null;
  snapshot_at: string | null;
}

/** The key of a link's stored PDF snapshot. */
export function pdfKey(link: SnapshotColumns): string {
  return link.snapshot_id
    ? `${snapshotFolder(link.user_id, link.id, link.snapshot_id)}${PDF_OBJECT}`
    : legacyPdfKey(link.user_id, link.id);
}

/** The key of a link's stored article, or null when it has no web page snapshot. */
export function articleKey(link: SnapshotColumns): string | null {
  return link.snapshot_id && link.snapshot_kind === 'html'
    ? `${snapshotFolder(link.user_id, link.id, link.snapshot_id)}${ARTICLE_OBJECT}`
    : null;
}

/** The key of one stored image of a link's snapshot, or null when the name cannot be one. */
export function imageKey(link: SnapshotColumns, name: string): string | null {
  if (!link.snapshot_id || link.snapshot_kind !== 'html' || !/^[\w-]+\.[a-z]+$/.test(name)) {
    return null;
  }
  return `${snapshotFolder(link.user_id, link.id, link.snapshot_id)}img/${name}`;
}

/** The address prefix under which the API serves a link's snapshot images, ending in '/'. */
export function imageAddressPrefix(linkId: string): string {
  return `/api/v1/links/${encodeURIComponent(linkId)}/snapshot/images/`;
}

/** A web page's snapshot as stored: the article, its byline and the notes taken with it. */
export interface StoredArticle {
  title: string | null;
  byline: string | null;
  /** The sanitised article, its stored images at the addresses imageAddressPrefix gives. */
  html: string;
  notes: string[];
}

/** Deletes every object stored for a link, except those whose keys start with `keep`. */
export async function deleteLinkObjects(
  env: Env,
  userId: string,
  linkId: string,
  keep?: string,
): Promise<void> {
  const prefix = linkPrefix(userId, linkId);
  let cursor: string | undefined;
  for (;;) {
    const page = await env.SNAPSHOTS.list({ prefix, cursor });
    const keys = page.objects.map((o) => o.key).filter((k) => !keep || !k.startsWith(keep));
    if (keys.length > 0) await env.SNAPSHOTS.delete(keys);
    if (!page.truncated) return;
    cursor = page.cursor;
  }
}

/** Deletes every object under one folder. */
export async function deleteFolder(env: Env, folder: string): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const page = await env.SNAPSHOTS.list({ prefix: folder, cursor });
    if (page.objects.length > 0) await env.SNAPSHOTS.delete(page.objects.map((o) => o.key));
    if (!page.truncated) return;
    cursor = page.cursor;
  }
}

/** The snapshot as the API returns it. */
export interface SnapshotResponse {
  content_kind: 'html' | 'pdf';
  title: string | null;
  byline: string | null;
  html: string | null;
  taken_at: string;
  notes: string[];
  /** A PDF snapshot's file. */
  file_url?: string;
}

/** A link's stored article text, or '' when it has none. */
export async function storedText(env: Env, userId: string, linkId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT text FROM link_texts WHERE link_id = ? AND user_id = ?')
    .bind(linkId, userId)
    .first<{ text: string }>();
  return row?.text ?? '';
}

/** A file name for a stored PDF: the link's title without characters a header cannot carry. */
export function pdfFileName(title: string): string {
  const base =
    title
      .replace(/\.pdf$/i, '')
      .replace(/[^\w .,()-]+/g, '_')
      .trim() || 'document';
  return `${base}.pdf`;
}

import type { Env } from '../env';

/** Where a link's stored objects live in SNAPSHOTS. */
export function linkPrefix(userId: string, linkId: string): string {
  return `u/${userId}/l/${linkId}/`;
}

/** The key of a link's snapshot: the raw HTML, or the whole PDF. */
export function snapshotKey(userId: string, linkId: string): string {
  return `${linkPrefix(userId, linkId)}snapshot`;
}

/** The key of a link's reader view: its title, byline and sanitised HTML, as JSON. */
export function readerKey(userId: string, linkId: string): string {
  return `${linkPrefix(userId, linkId)}reader.json`;
}

/** The stored reader view of a web page. */
export interface StoredReader {
  title: string | null;
  byline: string | null;
  html: string | null;
}

/** Deletes every object stored for a link. */
export async function deleteLinkObjects(env: Env, userId: string, linkId: string): Promise<void> {
  const prefix = linkPrefix(userId, linkId);
  for (;;) {
    const page = await env.SNAPSHOTS.list({ prefix });
    if (page.objects.length > 0) await env.SNAPSHOTS.delete(page.objects.map((o) => o.key));
    if (!page.truncated) return;
  }
}

/** The reader view as the API returns it. */
export interface ReaderResponse {
  content_kind: 'html' | 'pdf';
  title: string | null;
  byline: string | null;
  html: string | null;
  text: string;
  empty: boolean;
}

/** A link's stored reader-view text, or '' when it has none. */
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

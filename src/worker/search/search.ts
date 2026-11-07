/** Search: the full-text index of the user's links, and the searches over it. */
import type { Env } from '../env';

/** The most reader-view text the index holds for a link, in characters. */
export const INDEXED_TEXT_MAX = 500_000;

/**
 * The statement that makes `text` (or none, for null) the reader-view text
 * indexed for a link, replacing what was indexed before. The fetch worker
 * runs it in the batch that stores the text.
 */
export function indexReaderTextStatement(
  db: D1Database,
  linkId: string,
  text: string | null,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE link_search SET reader_text = ?
       WHERE rowid = (SELECT id FROM link_search_keys WHERE link_id = ?)`,
    )
    .bind((text ?? '').slice(0, INDEXED_TEXT_MAX), linkId);
}

/** Indexes `text` as the link's reader-view text, at most its first 500,000 characters. */
export async function indexReaderText(
  env: Env,
  linkId: string,
  text: string | null,
): Promise<void> {
  await indexReaderTextStatement(env.DB, linkId, text).run();
}

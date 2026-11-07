/** The user's topics and tags as the owner browses them: listed with their link counts. */

/** Topics or tags: which vocabulary a route is about. */
export type VocabularyKind = 'topics' | 'tags';

/** A topic or tag as listed. */
export interface VocabularyItem {
  id: string;
  name: string;
  count: number;
  newest_added_at: string;
}

/** Where a page of a vocabulary list ends: at the newest-link date and id of its last item. */
export interface VocabularyCursor {
  v: 'n';
  n: string;
  i: string;
}

export function isVocabularyCursor(value: unknown): value is VocabularyCursor {
  const c = value as VocabularyCursor | null;
  return (
    typeof c === 'object' &&
    c !== null &&
    c.v === 'n' &&
    typeof c.n === 'string' &&
    typeof c.i === 'string'
  );
}

/** The rows of `kind` with their links, as (item, link) pairs. */
const LINKED: Record<VocabularyKind, string> = {
  topics: 'topics v JOIN links l ON l.topic_id = v.id',
  tags: 'tags v JOIN link_tags lt ON lt.tag_id = v.id JOIN links l ON l.id = lt.link_id',
};

/**
 * One page of the user's topics or tags that have a link: each with the
 * number of its links in any state and the added date of its newest link,
 * newest first, the id breaking ties.
 */
export async function listVocabularyItems(
  db: D1Database,
  userId: string,
  kind: VocabularyKind,
  limit: number,
  after: VocabularyCursor | null,
): Promise<{ items: VocabularyItem[]; next: VocabularyCursor | null }> {
  const keyset = after ? 'HAVING (newest_added_at < ? OR (newest_added_at = ? AND v.id < ?))' : '';
  const rows = await db
    .prepare(
      `SELECT v.id, v.name, COUNT(*) AS count, MAX(l.added_at) AS newest_added_at
       FROM ${LINKED[kind]}
       WHERE v.user_id = ?
       GROUP BY v.id ${keyset}
       ORDER BY newest_added_at DESC, v.id DESC LIMIT ?`,
    )
    .bind(userId, ...(after ? [after.n, after.n, after.i] : []), limit + 1)
    .all<VocabularyItem>();
  const items = rows.results.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    next:
      rows.results.length > limit && last ? { v: 'n', n: last.newest_added_at, i: last.id } : null,
  };
}

/** The user's topics and tags as the owner browses them: listed, renamed and merged. */
import { now } from '../clock';

/** Topics or tags: which vocabulary a route is about. */
export type VocabularyKind = 'topics' | 'tags';

/** A topic or tag as listed; a topic also with its parent_id and subtree_count. */
export interface VocabularyItem {
  id: string;
  name: string;
  count: number;
  newest_added_at: string;
  parent_id?: string | null;
  subtree_count?: number;
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

/**
 * The rows of `kind` with their links, as (item, link) pairs: a topic's are
 * the links filed under it or under a topic beneath it (at most two levels).
 */
const LINKED: Record<VocabularyKind, string> = {
  topics: `topics v JOIN topics d ON d.id = v.id OR d.parent_id = v.id
             OR d.parent_id IN (SELECT c.id FROM topics c WHERE c.parent_id = v.id)
           JOIN links l ON l.topic_id = d.id`,
  tags: 'tags v JOIN link_tags lt ON lt.tag_id = v.id JOIN links l ON l.id = lt.link_id',
};

/** The columns of an item of `kind`, beside its id and name, over its (item, link) pairs. */
const ITEM_COLUMNS: Record<VocabularyKind, string> = {
  topics: `v.parent_id, (SELECT COUNT(*) FROM links o WHERE o.topic_id = v.id) AS count,
           COUNT(*) AS subtree_count, MAX(l.added_at) AS newest_added_at`,
  tags: 'COUNT(*) AS count, MAX(l.added_at) AS newest_added_at',
};

/**
 * One page of the user's topics or tags that have a link: each with the
 * number of its links in any state and the added date of its newest link,
 * newest first, the id breaking ties. A topic is listed with its parent and
 * counted over the links beneath it too (subtree_count, newest_added_at); its
 * own count is of the links filed directly under it, which may be none.
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
      `SELECT v.id, v.name, ${ITEM_COLUMNS[kind]}
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

/** The longest tag and topic names. */
export const TAG_NAME_MAX = 50;
export const TOPIC_NAME_MAX = 100;

/** A tag name: lower-case letters and digits in hyphen-joined words. */
const TAG_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A new name as it is stored, or null when it is not acceptable: a tag name
 * lower-cased, 1 to 50 characters of letters and digits in hyphen-joined
 * words; a topic name trimmed, its spaces collapsed, 1 to 100 characters.
 */
export function parseName(kind: VocabularyKind, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (kind === 'tags') {
    const name = value.toLowerCase();
    return name.length <= TAG_NAME_MAX && TAG_NAME.test(name) ? name : null;
  }
  const name = value.replace(/\s+/g, ' ').trim();
  return name && name.length <= TOPIC_NAME_MAX ? name : null;
}

/** A topic or tag with its number of links. */
export interface VocabularyEntry {
  id: string;
  name: string;
  count: number;
}

/** The table, alias table and alias column of each kind. */
const TABLES = {
  topics: { table: 'topics', aliases: 'topic_aliases', column: 'topic_id' },
  tags: { table: 'tags', aliases: 'tag_aliases', column: 'tag_id' },
} as const;

/** The ids of the links carrying a topic or tag, as SQL with one parameter (its id). */
const CARRIERS: Record<VocabularyKind, string> = {
  topics: 'SELECT id FROM links WHERE topic_id = ?',
  tags: 'SELECT link_id FROM link_tags WHERE tag_id = ?',
};

/** The ids of the user's links carrying one of their topics or tags. */
export async function carrierIds(
  db: D1Database,
  userId: string,
  kind: VocabularyKind,
  id: string,
): Promise<string[]> {
  const sql =
    kind === 'topics'
      ? 'SELECT id FROM links WHERE topic_id = ? AND user_id = ?'
      : `SELECT lt.link_id FROM link_tags lt JOIN links l ON l.id = lt.link_id
         WHERE lt.tag_id = ? AND l.user_id = ?`;
  const rows = await db.prepare(sql).bind(id, userId).raw<[string]>();
  return rows.map(([linkId]) => linkId);
}

/** One of the user's topics or tags with its number of links, or null when the user has none such. */
export async function getEntry(
  db: D1Database,
  userId: string,
  kind: VocabularyKind,
  id: string,
): Promise<VocabularyEntry | null> {
  return db
    .prepare(
      `SELECT v.id, v.name, (SELECT COUNT(*) FROM (${CARRIERS[kind]})) AS count
       FROM ${TABLES[kind].table} v WHERE v.id = ? AND v.user_id = ?`,
    )
    .bind(id, id, userId)
    .first<VocabularyEntry>();
}

/** Whether another of the user's topics (or tags) than `id` is named `name`, ignoring case. */
async function nameTaken(
  db: D1Database,
  userId: string,
  kind: VocabularyKind,
  name: string,
  id: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM ${TABLES[kind].table} WHERE user_id = ? AND name = ? COLLATE NOCASE AND id <> ?`,
    )
    .bind(userId, name, id)
    .first();
  return row !== null;
}

/** Marks the links carrying a topic or tag as changed, for the stream's change feed. */
function touchCarriers(db: D1Database, kind: VocabularyKind, id: string): D1PreparedStatement {
  return db
    .prepare(`UPDATE links SET updated_at = ? WHERE id IN (${CARRIERS[kind]})`)
    .bind(now().toISOString(), id);
}

/**
 * Renames one of the user's topics or tags, keeping the old name as an alias
 * of it; a name that is now current is no longer an alias. 'taken' when
 * another topic (or tag) has the name; null when the user has no such item.
 */
export async function renameEntry(
  db: D1Database,
  userId: string,
  kind: VocabularyKind,
  id: string,
  name: string,
): Promise<VocabularyEntry | 'taken' | null> {
  const entry = await getEntry(db, userId, kind, id);
  if (!entry) return null;
  if (await nameTaken(db, userId, kind, name, id)) return 'taken';
  const { table, aliases, column } = TABLES[kind];
  const statements = [
    db.prepare(`UPDATE ${table} SET name = ? WHERE id = ? AND user_id = ?`).bind(name, id, userId),
    db
      .prepare(`DELETE FROM ${aliases} WHERE user_id = ? AND name = ? COLLATE NOCASE`)
      .bind(userId, name),
  ];
  if (entry.name.toLowerCase() !== name.toLowerCase()) {
    statements.push(
      db
        .prepare(`INSERT OR REPLACE INTO ${aliases} (user_id, name, ${column}) VALUES (?, ?, ?)`)
        .bind(userId, entry.name, id),
      touchCarriers(db, kind, id),
    );
  }
  await db.batch(statements);
  return { ...entry, name };
}

/**
 * Merges one of the user's topics or tags into another in one batch: every
 * link of the source gets the target (a link never carries a tag twice),
 * the source's name and aliases become aliases of the target, and the source
 * is deleted. Null when either is not the user's.
 */
export async function mergeEntry(
  db: D1Database,
  userId: string,
  kind: VocabularyKind,
  sourceId: string,
  targetId: string,
): Promise<VocabularyEntry | null> {
  const [source, target] = await Promise.all([
    getEntry(db, userId, kind, sourceId),
    getEntry(db, userId, kind, targetId),
  ]);
  if (!source || !target) return null;
  const { table, aliases, column } = TABLES[kind];
  const move =
    kind === 'tags'
      ? [
          db
            .prepare(
              `INSERT INTO link_tags (link_id, tag_id, position)
               SELECT link_id, ?, position FROM link_tags WHERE tag_id = ? AND true
               ON CONFLICT (link_id, tag_id) DO NOTHING`,
            )
            .bind(targetId, sourceId),
          db.prepare('DELETE FROM link_tags WHERE tag_id = ?').bind(sourceId),
        ]
      : [
          db
            .prepare('UPDATE links SET topic_id = ? WHERE topic_id = ? AND user_id = ?')
            .bind(targetId, sourceId, userId),
        ];
  await db.batch([
    // The aliases move first: deleting the source would take its aliases with it.
    db.prepare(`UPDATE ${aliases} SET ${column} = ? WHERE ${column} = ?`).bind(targetId, sourceId),
    db
      .prepare(`INSERT OR REPLACE INTO ${aliases} (user_id, name, ${column}) VALUES (?, ?, ?)`)
      .bind(userId, source.name, targetId),
    touchCarriers(db, kind, sourceId),
    ...move,
    db.prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`).bind(sourceId, userId),
  ]);
  return getEntry(db, userId, kind, targetId);
}

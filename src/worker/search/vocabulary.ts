/** The user's topics and tags as the owner browses them: listed, renamed and merged. */
import { now } from '../clock';
import { dropIfEmptyStatement, resolveTopicPath, TOPIC_LEVELS } from '../enrich/vocabulary';

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
 * words; a topic name trimmed, its spaces collapsed, 1 to 100 characters
 * without `>`.
 */
export function parseName(kind: VocabularyKind, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (kind === 'tags') {
    const name = value.toLowerCase();
    return name.length <= TAG_NAME_MAX && TAG_NAME.test(name) ? name : null;
  }
  // `>` separates the names of a topic path.
  const name = value.replace(/\s+/g, ' ').trim();
  return name && name.length <= TOPIC_NAME_MAX && !name.includes('>') ? name : null;
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

/** The ids of the topics in a topic's subtree, as SQL with one parameter (its id): itself and up to two levels beneath. */
const SUBTREE = `SELECT s.id FROM topics s WHERE s.id = ?1 OR s.parent_id = ?1
  OR s.parent_id IN (SELECT c.id FROM topics c WHERE c.parent_id = ?1)`;

/** The ids of the user's links carrying one of their topics or tags, or filed under a topic or beneath it. */
export async function carrierIds(
  db: D1Database,
  userId: string,
  kind: VocabularyKind,
  id: string,
  { subtree = false }: { subtree?: boolean } = {},
): Promise<string[]> {
  const sql =
    kind === 'topics'
      ? subtree
        ? `SELECT id FROM links WHERE topic_id IN (${SUBTREE}) AND user_id = ?2`
        : 'SELECT id FROM links WHERE topic_id = ? AND user_id = ?'
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
      // A topic's name is in the path of every link beneath it, too.
      kind === 'topics'
        ? db
            .prepare(
              `UPDATE links SET updated_at = ?3 WHERE topic_id IN (${SUBTREE}) AND user_id = ?2`,
            )
            .bind(id, userId, now().toISOString())
        : touchCarriers(db, kind, id),
    );
  }
  await db.batch(statements);
  return { ...entry, name };
}

/** Why a merge of topics was refused. */
export type MergeRefusal = 'invalid_merge' | 'too_deep';

/**
 * Merges one of the user's topics or tags into another in one batch: every
 * link of the source gets the target (a link never carries a tag twice),
 * the source's name and aliases become aliases of the target, and the source
 * is deleted. A topic's children become the target's first, and every link
 * beneath the source is marked changed; a target beneath the source, or a
 * child that would end up below the third level, refuses the merge. Null
 * when either is not the user's.
 */
export async function mergeEntry(
  db: D1Database,
  userId: string,
  kind: VocabularyKind,
  sourceId: string,
  targetId: string,
): Promise<VocabularyEntry | MergeRefusal | null> {
  const [source, target] = await Promise.all([
    getEntry(db, userId, kind, sourceId),
    getEntry(db, userId, kind, targetId),
  ]);
  if (!source || !target) return null;
  const tree = kind === 'topics' ? await topicTree(db, userId) : null;
  if (tree?.within(targetId, sourceId)) return 'invalid_merge';
  if (tree && tree.level(targetId) + tree.height(sourceId) - 1 > TOPIC_LEVELS) return 'too_deep';
  const former = tree?.parents.get(sourceId) ?? null;
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
          // The children move first, so that the source is empty when its links leave it.
          db
            .prepare('UPDATE topics SET parent_id = ? WHERE parent_id = ? AND user_id = ?')
            .bind(targetId, sourceId, userId),
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
    kind === 'topics'
      ? db
          .prepare(
            `UPDATE links SET updated_at = ?3 WHERE topic_id IN (${SUBTREE}) AND user_id = ?2`,
          )
          .bind(sourceId, userId, now().toISOString())
      : touchCarriers(db, kind, sourceId),
    ...move,
    db.prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`).bind(sourceId, userId),
    ...(tree ? dropEmptied(db, [former, former === null ? null : tree.parents.get(former)]) : []),
  ]);
  return getEntry(db, userId, kind, targetId);
}

/** A topic with its place in the tree and its links, as a move answers it. */
export interface TopicEntry {
  id: string;
  name: string;
  parent_id: string | null;
  count: number;
  subtree_count: number;
}

/** One of the user's topics as a move answers it, or null when the user has none such. */
async function getTopic(db: D1Database, userId: string, id: string): Promise<TopicEntry | null> {
  return db
    .prepare(
      `SELECT v.id, v.name, v.parent_id,
         (SELECT COUNT(*) FROM links WHERE topic_id = v.id) AS count,
         (SELECT COUNT(*) FROM links WHERE topic_id IN (${SUBTREE})) AS subtree_count
       FROM topics v WHERE v.id = ?1 AND v.user_id = ?2`,
    )
    .bind(id, userId)
    .first<TopicEntry>();
}

/** The user's topic tree: each topic's parent, and its children. */
async function topicTree(db: D1Database, userId: string) {
  const rows = await db
    .prepare('SELECT id, parent_id FROM topics WHERE user_id = ?')
    .bind(userId)
    .all<{ id: string; parent_id: string | null }>();
  const parents = new Map(rows.results.map((r) => [r.id, r.parent_id]));
  const children = new Map<string, string[]>();
  for (const r of rows.results) {
    if (r.parent_id !== null)
      children.set(r.parent_id, [...(children.get(r.parent_id) ?? []), r.id]);
  }
  /** The topic's level: 1 at the top; 0 for none. */
  const level = (id: string | null): number => {
    let n = 0;
    for (let at = id; at !== null; at = parents.get(at) ?? null) n++;
    return n;
  };
  /** The levels the topic's subtree spans: 1 for a topic with no children. */
  const height = (id: string): number =>
    1 + Math.max(0, ...(children.get(id) ?? []).map((c) => height(c)));
  /** Whether `id` is `ancestor` or beneath it. */
  const within = (id: string | null, ancestor: string): boolean => {
    for (let at = id; at !== null; at = parents.get(at) ?? null) if (at === ancestor) return true;
    return false;
  };
  return { parents, children, level, height, within };
}

/**
 * The statements that delete each of these topics, in order, that has no link
 * filed under it and no child topic: a topic's former parent, then that
 * parent's parent, so that an emptied branch goes all the way up.
 */
function dropEmptied(db: D1Database, ids: (string | null | undefined)[]): D1PreparedStatement[] {
  return ids
    .filter((id): id is string => typeof id === 'string')
    .map((id) => dropIfEmptyStatement(db, id));
}

/** Why a move was refused. */
export type MoveRefusal = 'not_found' | 'invalid_move' | 'too_deep';

/**
 * Moves one of the user's topics, with every topic beneath it, under another
 * of their topics, or to the top level for null. Refused when either is not
 * the user's, when the parent is the topic or beneath it, and when anything
 * would end up below the third level. Under the parent it already has,
 * nothing changes. Otherwise every link beneath the topic is marked changed,
 * and the former parent and its parent are deleted when left empty.
 */
export async function moveTopic(
  db: D1Database,
  userId: string,
  id: string,
  parent: string | null,
): Promise<TopicEntry | MoveRefusal> {
  const tree = await topicTree(db, userId);
  if (!tree.parents.has(id) || (parent !== null && !tree.parents.has(parent))) return 'not_found';
  if (parent !== null && tree.within(parent, id)) return 'invalid_move';
  if (tree.level(parent) + tree.height(id) > TOPIC_LEVELS) return 'too_deep';
  const former = tree.parents.get(id) ?? null;
  if (former !== parent) {
    await db.batch([
      db
        .prepare(`UPDATE links SET updated_at = ?3 WHERE topic_id IN (${SUBTREE}) AND user_id = ?2`)
        .bind(id, userId, now().toISOString()),
      db
        .prepare('UPDATE topics SET parent_id = ? WHERE id = ? AND user_id = ?')
        .bind(parent, id, userId),
      ...dropEmptied(db, [former, former === null ? null : tree.parents.get(former)]),
    ]);
  }
  return (await getTopic(db, userId, id))!;
}

/** The fewest and the most links filed directly under a topic that a split takes. */
export const SPLIT_MIN_LINKS = 20;
export const SPLIT_MAX_LINKS = 500;

/** Why a split was refused before the provider was asked. */
export type SplitRefusal = 'not_found' | 'too_deep' | 'too_few_links' | 'too_many_links';

/** What a split asks the provider about: the topic, its children and the links it may move. */
export interface SplitRequest {
  /** The topic's names from the top level down, its own last. */
  path: string[];
  children: string[];
  /** The links filed directly under the topic whose topic the owner did not edit. */
  links: { id: string; title: string; summary: string | null }[];
}

/**
 * What a split of one of the user's topics would send the provider, or why it
 * is refused: not the user's, at the third level, or with fewer than 20 or
 * more than 500 links filed directly under it (every such link counts, the
 * ones whose topic the owner edited among them, though those are not sent).
 */
export async function prepareSplit(
  db: D1Database,
  userId: string,
  id: string,
): Promise<SplitRequest | SplitRefusal> {
  const tree = await topicTree(db, userId);
  if (!tree.parents.has(id)) return 'not_found';
  if (tree.level(id) >= TOPIC_LEVELS) return 'too_deep';
  const [links, names] = await db.batch<{
    id: string;
    title: string;
    summary: string | null;
    edited_fields: string;
    name: string;
    parent_id: string | null;
  }>([
    db
      .prepare(
        'SELECT id, title, summary, edited_fields FROM links WHERE topic_id = ? AND user_id = ? ORDER BY added_at, id',
      )
      .bind(id, userId),
    db.prepare('SELECT id, name, parent_id FROM topics WHERE user_id = ?').bind(userId),
  ]);
  const all = links?.results ?? [];
  if (all.length < SPLIT_MIN_LINKS) return 'too_few_links';
  if (all.length > SPLIT_MAX_LINKS) return 'too_many_links';
  const byId = new Map((names?.results ?? []).map((t) => [t.id, t.name]));
  const path: string[] = [];
  for (let at: string | null = id; at !== null; at = tree.parents.get(at) ?? null) {
    path.unshift(byId.get(at)!);
  }
  return {
    path,
    children: (tree.children.get(id) ?? []).map((c) => byId.get(c)!).sort(),
    links: all
      .filter((l) => !(JSON.parse(l.edited_fields) as string[]).includes('topic'))
      .map(({ id: linkId, title, summary }) => ({ id: linkId, title, summary })),
  };
}

/** A split as it answers: the topic, every child of it by name, and how many links moved. */
export interface SplitOutcome {
  topic: TopicEntry;
  children: VocabularyEntry[];
  moved: number;
  /** The ids of the links whose topic changed. */
  movedIds: string[];
}

/**
 * Applies a split of one of the user's topics: each sub-topic name some link
 * is filed under is resolved as the last name of the topic's own path, with
 * near names (an existing child or any existing topic is reused where it is,
 * otherwise a child of the topic is created), and in one batch each link is
 * filed under its sub-topic and, when its topic changes, marked changed.
 * `assignments` maps each link to its sub-topic's name; '' leaves it. Null
 * when the topic is no longer the user's.
 */
export async function applySplit(
  db: D1Database,
  userId: string,
  id: string,
  path: string[],
  assignments: Map<string, string>,
): Promise<SplitOutcome | null> {
  const targets = new Map<string, string>();
  for (const name of new Set(assignments.values())) {
    if (name === '') continue;
    targets.set(name, await resolveTopicPath(db, userId, [...path, name], { near: true }));
  }
  const moves = [...assignments].flatMap(([linkId, name]) => {
    const target = name === '' ? undefined : targets.get(name);
    return target && target !== id ? [{ linkId, target }] : [];
  });
  // A link the owner moved or deleted while the provider answered is left as
  // it is, and a sub-topic none of the links reached goes again.
  const at = now().toISOString();
  if (moves.length > 0) {
    await db.batch(
      moves.map(({ linkId, target }) =>
        db
          .prepare(
            'UPDATE links SET topic_id = ?, updated_at = ? WHERE id = ? AND user_id = ? AND topic_id = ?',
          )
          .bind(target, at, linkId, userId, id),
      ),
    );
  }
  // The moved links are the ones now under their sub-topic.
  const landed = await db
    .prepare(
      `SELECT l.id FROM links l JOIN json_each(?) j
         ON l.id = json_extract(j.value, '$.linkId') AND l.topic_id = json_extract(j.value, '$.target')
       WHERE l.user_id = ?`,
    )
    .bind(JSON.stringify(moves), userId)
    .all<{ id: string }>();
  const movedIds = landed.results.map((r) => r.id);
  const created = [...new Set(targets.values())].filter((t) => t !== id);
  if (created.length > 0) await db.batch(dropEmptied(db, created));
  const topic = await getTopic(db, userId, id);
  // The topic itself went (merged or emptied) while the provider answered.
  if (!topic) return null;
  const children = await db
    .prepare(
      `SELECT t.id, t.name, (SELECT COUNT(*) FROM links WHERE topic_id = t.id) AS count
       FROM topics t WHERE t.parent_id = ? AND t.user_id = ? ORDER BY t.name COLLATE NOCASE, t.id`,
    )
    .bind(id, userId)
    .all<VocabularyEntry>();
  return { topic, children: children.results, moved: movedIds.length, movedIds };
}

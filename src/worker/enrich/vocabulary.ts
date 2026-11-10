import { nameKey, nearKeys, type Aliases, type VocabularyEntry } from './enrich';

/** How many of the user's topics and tags the provider is shown. */
export const PROMPT_TOPICS = 100;
export const PROMPT_TAGS = 300;

/**
 * What the provider is shown of the user's vocabulary, for it to reuse: the
 * paths of the 100 topics whose newest link, filed under the topic or under a
 * topic beneath it, was added most recently, each as its names from the top
 * level down joined with ' > ', without counts; and the 300 most used tags,
 * each with its number of links.
 */
export async function listVocabulary(
  db: D1Database,
  userId: string,
): Promise<{ topics: string[]; tags: VocabularyEntry[] }> {
  const [topics, tags] = await db.batch<{ path: string } & VocabularyEntry>([
    db
      .prepare(
        `SELECT COALESCE(p2.name || ' > ', '') || COALESCE(p1.name || ' > ', '') || v.name AS path
         FROM topics v
         LEFT JOIN topics p1 ON p1.id = v.parent_id
         LEFT JOIN topics p2 ON p2.id = p1.parent_id
         JOIN topics d ON d.id = v.id OR d.parent_id = v.id
           OR d.parent_id IN (SELECT c.id FROM topics c WHERE c.parent_id = v.id)
         JOIN links l ON l.topic_id = d.id
         WHERE v.user_id = ? GROUP BY v.id ORDER BY MAX(l.added_at) DESC, path LIMIT ?`,
      )
      .bind(userId, PROMPT_TOPICS),
    db
      .prepare(
        `SELECT t.name, COUNT(lt.link_id) AS count FROM tags t LEFT JOIN link_tags lt ON lt.tag_id = t.id
         WHERE t.user_id = ? GROUP BY t.id ORDER BY COUNT(lt.link_id) DESC, t.name LIMIT ?`,
      )
      .bind(userId, PROMPT_TAGS),
  ]);
  return {
    topics: (topics?.results ?? []).map((r) => r.path),
    tags: (tags?.results ?? []).map(({ name, count }) => ({ name, count })),
  };
}

/** How names are matched to the user's vocabulary. */
export interface ResolveOptions {
  /**
   * Whether a name with no equal also reuses a near one (nearKeys: hyphens
   * dropped, singular or plural). Enrichment asks for it so that the model's
   * variants converge; an owner's own edit does not, so it is taken as typed.
   */
  near?: boolean;
}

/**
 * The ids of `names` in the user's `table` (topics or tags), reusing a row
 * whose name is equal ignoring case with spaces read as hyphens, else, with
 * `near`, a row whose name is near; a row is created for a name that has
 * neither. Ids come back in the order of `names`, without repeats.
 */
async function resolve(
  db: D1Database,
  table: 'topics' | 'tags',
  userId: string,
  names: string[],
  { near = false }: ResolveOptions = {},
): Promise<string[]> {
  const rows = await db
    .prepare(`SELECT id, name FROM ${table} WHERE user_id = ? ORDER BY name`)
    .bind(userId)
    .all<{ id: string; name: string }>();
  const byKey = new Map(rows.results.map((r) => [nameKey(r.name), r.id]));
  const { add: addNear, find: nearId } = nearIndex(near ? rows.results : []);
  const ids: string[] = [];
  for (const name of names) {
    const key = nameKey(name);
    let id = byKey.get(key) ?? (near ? nearId(name) : undefined);
    if (!id) {
      const [, found] = await db.batch<{ id: string }>([
        db
          .prepare(`INSERT OR IGNORE INTO ${table} (id, user_id, name) VALUES (?, ?, ?)`)
          .bind(crypto.randomUUID(), userId, name),
        db
          .prepare(`SELECT id FROM ${table} WHERE user_id = ? AND name = ? COLLATE NOCASE`)
          .bind(userId, name),
      ]);
      id = found!.results[0]!.id;
      byKey.set(key, id);
      if (near) addNear(name, id);
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Rows by their near keys (nearKeys): each row under its own, the first in
 * order winning a shared key, and a name's id found under any of its keys.
 */
function nearIndex(rows: { id: string; name: string }[]) {
  const byNearKey = new Map<string, string>();
  const add = (name: string, id: string) => {
    const [own = ''] = nearKeys(name);
    if (!byNearKey.has(own)) byNearKey.set(own, id);
  };
  for (const r of rows) add(r.name, r.id);
  const find = (name: string) => {
    const k = nearKeys(name).find((key) => byNearKey.has(key));
    return k === undefined ? undefined : byNearKey.get(k);
  };
  return { add, find };
}

/** The deepest level of the topic tree: a top-level topic is level 1. */
export const TOPIC_LEVELS = 3;

/**
 * The id of the topic a path of names leads to in the user's topic tree,
 * resolving the names from the first. A name equal to a topic's name or to an
 * alias (nameKey), or with `near` a near name, is that topic wherever it is
 * in the tree, and the next name belongs under it. Any other name is created
 * as given under the topic the name before it led to (at the top level for
 * the first), or, where that would be below the third level, beside it.
 */
export async function resolveTopicPath(
  db: D1Database,
  userId: string,
  names: string[],
  { near = false }: ResolveOptions = {},
): Promise<string> {
  const [rows, aliases] = await db.batch<{ id: string; name: string; parent_id: string | null }>([
    db
      .prepare('SELECT id, name, parent_id FROM topics WHERE user_id = ? ORDER BY name')
      .bind(userId),
    db
      .prepare(
        'SELECT name, topic_id AS id, NULL AS parent_id FROM topic_aliases WHERE user_id = ?',
      )
      .bind(userId),
  ]);
  const topics = rows?.results ?? [];
  const parents = new Map(topics.map((t) => [t.id, t.parent_id]));
  const byKey = new Map(topics.map((t) => [nameKey(t.name), t.id]));
  const byAlias = new Map((aliases?.results ?? []).map((a) => [nameKey(a.name), a.id]));
  const { add: addNear, find: nearId } = nearIndex(near ? topics : []);
  const level = (id: string | null): number => {
    let n = 0;
    for (let at = id; at !== null && at !== undefined; at = parents.get(at) ?? null) n++;
    return n;
  };

  let parent: string | null = null;
  const created: string[] = [];
  for (const name of names) {
    const key = nameKey(name);
    let id = byKey.get(key) ?? byAlias.get(key) ?? (near ? nearId(name) : undefined);
    if (!id) {
      const under: string | null =
        parent !== null && level(parent) >= TOPIC_LEVELS ? (parents.get(parent) ?? null) : parent;
      const [inserted, found]: D1Result<{ id: string; parent_id: string | null }>[] =
        await db.batch<{
          id: string;
          parent_id: string | null;
        }>([
          db
            .prepare(
              'INSERT OR IGNORE INTO topics (id, user_id, name, parent_id) VALUES (?, ?, ?, ?)',
            )
            .bind(crypto.randomUUID(), userId, name, under),
          db
            .prepare(
              'SELECT id, parent_id FROM topics WHERE user_id = ? AND name = ? COLLATE NOCASE',
            )
            .bind(userId, name),
        ]);
      const row: { id: string; parent_id: string | null } = found!.results[0]!;
      id = row.id;
      if (inserted!.meta.changes > 0) created.push(id);
      parents.set(id, row.parent_id);
      byKey.set(key, id);
      if (near) addNear(name, id);
    }
    parent = id;
  }
  // A topic created for an earlier name is left empty when a later name
  // matched a topic elsewhere in the tree, or went beside it at the third
  // level: it goes again, the deepest first, so that nothing empty is left.
  const unused = created.filter((id) => id !== parent).reverse();
  if (unused.length > 0) {
    await db.batch(
      unused.map((id) =>
        db
          .prepare(
            `DELETE FROM topics WHERE id = ?1
               AND NOT EXISTS (SELECT 1 FROM links WHERE topic_id = ?1)
               AND NOT EXISTS (SELECT 1 FROM topics k WHERE k.parent_id = ?1)`,
          )
          .bind(id),
      ),
    );
  }
  return parent!;
}

/**
 * The ids of the user's tags named `names` (or, with `near`, near names), in
 * order and without repeats, created where there are none.
 */
export function resolveTags(
  db: D1Database,
  userId: string,
  names: string[],
  options: ResolveOptions = {},
): Promise<string[]> {
  return resolve(db, 'tags', userId, names, options);
}

/**
 * The statements that give one of the user's links exactly the tags `tagIds`,
 * in that order. Tags the link keeps are never removed on the way, so that a
 * kept tag is not deleted as unused in between.
 */
export function setTagsStatements(
  db: D1Database,
  userId: string,
  linkId: string,
  tagIds: string[],
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        'DELETE FROM link_tags WHERE link_id = ? AND tag_id NOT IN (SELECT value FROM json_each(?))',
      )
      .bind(linkId, JSON.stringify(tagIds)),
    ...tagIds.map((tagId, i) =>
      db
        .prepare(
          `INSERT INTO link_tags (link_id, tag_id, position)
           SELECT id, ?, ? FROM links WHERE id = ? AND user_id = ?
           ON CONFLICT (link_id, tag_id) DO UPDATE SET position = excluded.position`,
        )
        .bind(tagId, i, linkId, userId),
    ),
  ];
}

/**
 * The user's tag aliases, by nameKey, each with its survivor's name. An alias
 * that is also a current name is left out: a current name wins. (Topic
 * aliases are matched name by name as a topic path is resolved.)
 */
export async function listAliases(db: D1Database, userId: string): Promise<Aliases> {
  const rows = await db
    .prepare(
      `SELECT a.name, v.name AS survivor FROM tag_aliases a JOIN tags v ON v.id = a.tag_id
       WHERE a.user_id = ?1 AND NOT EXISTS (
         SELECT 1 FROM tags c WHERE c.user_id = ?1 AND c.name = a.name COLLATE NOCASE)`,
    )
    .bind(userId)
    .all<{ name: string; survivor: string }>();
  return { tags: new Map(rows.results.map((r) => [nameKey(r.name), r.survivor])) };
}

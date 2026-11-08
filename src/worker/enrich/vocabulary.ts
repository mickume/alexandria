import { nameKey, nearKeys, type Aliases, type VocabularyEntry } from './enrich';

/** How many of the user's topics and tags the provider is shown. */
export const PROMPT_TOPICS = 100;
export const PROMPT_TAGS = 300;

/** The user's most used topic and tag names with their link counts, for the provider to reuse. */
export async function listVocabulary(
  db: D1Database,
  userId: string,
): Promise<{ topics: VocabularyEntry[]; tags: VocabularyEntry[] }> {
  const [topics, tags] = await db.batch<VocabularyEntry>([
    db
      .prepare(
        `SELECT tp.name, COUNT(l.id) AS count FROM topics tp LEFT JOIN links l ON l.topic_id = tp.id
         WHERE tp.user_id = ? GROUP BY tp.id ORDER BY COUNT(l.id) DESC, tp.name LIMIT ?`,
      )
      .bind(userId, PROMPT_TOPICS),
    db
      .prepare(
        `SELECT t.name, COUNT(lt.link_id) AS count FROM tags t LEFT JOIN link_tags lt ON lt.tag_id = t.id
         WHERE t.user_id = ? GROUP BY t.id ORDER BY COUNT(lt.link_id) DESC, t.name LIMIT ?`,
      )
      .bind(userId, PROMPT_TAGS),
  ]);
  return { topics: topics?.results ?? [], tags: tags?.results ?? [] };
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
  // Each row under its own near key; the first name in order wins a shared key.
  const byNearKey = new Map<string, string>();
  const addNear = (name: string, id: string) => {
    const [own = ''] = nearKeys(name);
    if (!byNearKey.has(own)) byNearKey.set(own, id);
  };
  if (near) for (const r of rows.results) addNear(r.name, r.id);
  const nearId = (name: string) => {
    const k = nearKeys(name).find((key) => byNearKey.has(key));
    return k === undefined ? undefined : byNearKey.get(k);
  };
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

/** The id of the user's topic named `name` (or, with `near`, a near name), created when there is none. */
export async function resolveTopic(
  db: D1Database,
  userId: string,
  name: string,
  options: ResolveOptions = {},
): Promise<string> {
  const [id] = await resolve(db, 'topics', userId, [name], options);
  return id!;
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
 * The user's aliases of topics and tags, by nameKey, each with its survivor's
 * name. An alias that is also a current name is left out: a current name wins.
 */
export async function listAliases(db: D1Database, userId: string): Promise<Aliases> {
  const query = (kind: 'topic' | 'tag') =>
    db
      .prepare(
        `SELECT a.name, v.name AS survivor FROM ${kind}_aliases a JOIN ${kind}s v ON v.id = a.${kind}_id
         WHERE a.user_id = ?1 AND NOT EXISTS (
           SELECT 1 FROM ${kind}s c WHERE c.user_id = ?1 AND c.name = a.name COLLATE NOCASE)`,
      )
      .bind(userId);
  const [topics, tags] = await db.batch<{ name: string; survivor: string }>([
    query('topic'),
    query('tag'),
  ]);
  const byKey = (rows: { name: string; survivor: string }[] = []) =>
    new Map(rows.map((r) => [nameKey(r.name), r.survivor]));
  return { topics: byKey(topics?.results), tags: byKey(tags?.results) };
}

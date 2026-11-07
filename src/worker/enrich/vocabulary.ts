import { nameKey } from './enrich';

/** How many of the user's topics and tags the provider is shown. */
export const PROMPT_TOPICS = 100;
export const PROMPT_TAGS = 300;

/** The user's most used topic and tag names, for the provider to reuse. */
export async function listVocabulary(
  db: D1Database,
  userId: string,
): Promise<{ topics: string[]; tags: string[] }> {
  const [topics, tags] = await db.batch<{ name: string }>([
    db
      .prepare(
        `SELECT tp.name FROM topics tp LEFT JOIN links l ON l.topic_id = tp.id
         WHERE tp.user_id = ? GROUP BY tp.id ORDER BY COUNT(l.id) DESC, tp.name LIMIT ?`,
      )
      .bind(userId, PROMPT_TOPICS),
    db
      .prepare(
        `SELECT t.name FROM tags t LEFT JOIN link_tags lt ON lt.tag_id = t.id
         WHERE t.user_id = ? GROUP BY t.id ORDER BY COUNT(lt.link_id) DESC, t.name LIMIT ?`,
      )
      .bind(userId, PROMPT_TAGS),
  ]);
  return {
    topics: (topics?.results ?? []).map((r) => r.name),
    tags: (tags?.results ?? []).map((r) => r.name),
  };
}

/**
 * The ids of `names` in the user's `table` (topics or tags), reusing a row
 * whose name is equal ignoring case with spaces read as hyphens, and creating
 * a row for a name that has none. Ids come back in the order of `names`.
 */
async function resolve(
  db: D1Database,
  table: 'topics' | 'tags',
  userId: string,
  names: string[],
): Promise<string[]> {
  const rows = await db
    .prepare(`SELECT id, name FROM ${table} WHERE user_id = ?`)
    .bind(userId)
    .all<{ id: string; name: string }>();
  const byKey = new Map(rows.results.map((r) => [nameKey(r.name), r.id]));
  const ids: string[] = [];
  for (const name of names) {
    const key = nameKey(name);
    let id = byKey.get(key);
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
    }
    ids.push(id);
  }
  return ids;
}

/** The id of the user's topic named `name`, created when there is none. */
export async function resolveTopic(db: D1Database, userId: string, name: string): Promise<string> {
  const [id] = await resolve(db, 'topics', userId, [name]);
  return id!;
}

/** The ids of the user's tags named `names`, in order, created where there are none. */
export function resolveTags(db: D1Database, userId: string, names: string[]): Promise<string[]> {
  return resolve(db, 'tags', userId, names);
}

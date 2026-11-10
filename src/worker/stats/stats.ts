import { LIBRARY_LIMIT } from '../links/store';

/**
 * The owner's library statistics, computed at one instant from the rows the
 * library already stores. Every section's queries run in one batch, so the
 * numbers describe one moment and cost one round trip.
 */

/** Test seams of the statistics, as the clock is one. */
export const statsHooks: { beforeSection?: (name: string) => void } = {};

/** The SQL condition that a link `l` is in at least one workspace. */
export const IN_WORKSPACE = 'EXISTS (SELECT 1 FROM workspace_links wl WHERE wl.link_id = l.id)';

/** What a section knows when it is computed. */
export interface StatsContext {
  db: D1Database;
  userId: string;
  /** The instant of the request. */
  at: Date;
}

/** What a section is built from: the context and the links' own counts (linkCounts). */
export interface BuildContext extends StatsContext {
  links: Row;
}

type Row = Record<string, unknown>;

/**
 * One section of the statistics: the statements it reads, bound to the user,
 * and how it turns their rows (one result per statement, in order) into its
 * part of the answer.
 */
export interface Section {
  name: string;
  statements: (ctx: StatsContext) => D1PreparedStatement[];
  build: (results: Row[][], ctx: BuildContext) => unknown;
}

/** A count from a row: SUM over no rows is null. */
export function n(row: Row | undefined, key: string): number {
  const v = row?.[key];
  return typeof v === 'number' ? v : 0;
}

/** The links' own counts, read once and shared by every section (BuildContext.links). */
function linkCounts(ctx: StatsContext): D1PreparedStatement {
  return ctx.db
    .prepare(
      `SELECT COUNT(*) AS total,
         SUM(l.state = 'pending') AS pending, SUM(l.state = 'active') AS active,
         SUM(l.state = 'unreachable') AS unreachable, SUM(l.state = 'expired') AS expired,
         SUM(l.state = 'archived') AS archived,
         SUM(l.pin_position IS NOT NULL) AS pinned, SUM(${IN_WORKSPACE}) AS in_workspace,
         SUM(l.content_kind = 'html') AS html, SUM(l.content_kind = 'pdf') AS pdf,
         SUM(l.content_kind = 'other') AS other, SUM(l.content_kind IS NULL) AS unfetched,
         SUM(l.has_snapshot = 1) AS with_snapshot, SUM(l.reader_empty = 1) AS reader_empty,
         SUM(l.topic_id IS NULL) AS without_topic,
         SUM(NOT EXISTS (SELECT 1 FROM link_tags lt WHERE lt.link_id = l.id)) AS without_tags,
         COUNT(DISTINCT l.host) AS hosts
       FROM links l WHERE l.user_id = ?`,
    )
    .bind(ctx.userId);
}

const library: Section = {
  name: 'library',
  statements: () => [],
  build: (_, { links: row }) => ({
    total: n(row, 'total'),
    by_state: {
      pending: n(row, 'pending'),
      active: n(row, 'active'),
      unreachable: n(row, 'unreachable'),
      expired: n(row, 'expired'),
      archived: n(row, 'archived'),
    },
    pinned: n(row, 'pinned'),
    in_workspace: n(row, 'in_workspace'),
    limit: LIBRARY_LIMIT,
  }),
};

const content: Section = {
  name: 'content',
  statements: () => [],
  build: (_, { links: row }) => ({
    by_kind: {
      html: n(row, 'html'),
      pdf: n(row, 'pdf'),
      other: n(row, 'other'),
      unfetched: n(row, 'unfetched'),
    },
    with_snapshot: n(row, 'with_snapshot'),
    reader_empty: n(row, 'reader_empty'),
  }),
};

const topics: Section = {
  name: 'topics',
  statements: (ctx) => [
    ctx.db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(t.parent_id IS NULL) AS l1,
           SUM(t.parent_id IS NOT NULL AND p.parent_id IS NULL) AS l2,
           SUM(p.parent_id IS NOT NULL) AS l3
         FROM topics t LEFT JOIN topics p ON p.id = t.parent_id WHERE t.user_id = ?`,
      )
      .bind(ctx.userId),
    ctx.db
      .prepare(
        `SELECT t.id, t.name, p.name AS parent, g.name AS grandparent, COUNT(*) AS count
         FROM topics t JOIN links l ON l.topic_id = t.id
           LEFT JOIN topics p ON p.id = t.parent_id LEFT JOIN topics g ON g.id = p.parent_id
         WHERE t.user_id = ?
         GROUP BY t.id ORDER BY count DESC, t.name COLLATE NOCASE, t.name LIMIT 10`,
      )
      .bind(ctx.userId),
  ],
  build: ([[levels], largest = []], { links }) => ({
    total: n(levels, 'total'),
    by_level: { '1': n(levels, 'l1'), '2': n(levels, 'l2'), '3': n(levels, 'l3') },
    links_without_topic: n(links, 'without_topic'),
    largest: largest.map((t) => ({
      id: t.id,
      name: t.name,
      path: [t.grandparent, t.parent, t.name].filter((x) => typeof x === 'string'),
      count: t.count,
    })),
  }),
};

const tags: Section = {
  name: 'tags',
  statements: (ctx) => [
    ctx.db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(uses = 1) AS used_once FROM (
           SELECT (SELECT COUNT(*) FROM link_tags lt WHERE lt.tag_id = t.id) AS uses
           FROM tags t WHERE t.user_id = ?)`,
      )
      .bind(ctx.userId),
    ctx.db
      .prepare(
        `SELECT t.id, t.name, COUNT(*) AS count FROM tags t JOIN link_tags lt ON lt.tag_id = t.id
         WHERE t.user_id = ?
         GROUP BY t.id ORDER BY count DESC, t.name COLLATE NOCASE, t.name LIMIT 10`,
      )
      .bind(ctx.userId),
  ],
  build: ([[totals], top = []], { links }) => ({
    total: n(totals, 'total'),
    used_once: n(totals, 'used_once'),
    links_without_tags: n(links, 'without_tags'),
    top: top.map((t) => ({ id: t.id, name: t.name, count: t.count })),
  }),
};

const workspaces: Section = {
  name: 'workspaces',
  statements: (ctx) => [
    ctx.db.prepare('SELECT COUNT(*) AS total FROM workspaces WHERE user_id = ?').bind(ctx.userId),
    ctx.db
      .prepare(
        `SELECT w.id, w.name, COUNT(*) AS count
         FROM workspaces w JOIN workspace_links wl ON wl.workspace_id = w.id
         WHERE w.user_id = ?
         GROUP BY w.id ORDER BY count DESC, w.name_key, w.name LIMIT 10`,
      )
      .bind(ctx.userId),
  ],
  build: ([[totals], largest = []]) => ({
    total: n(totals, 'total'),
    largest: largest.map((w) => ({ id: w.id, name: w.name, count: w.count })),
  }),
};

const hosts: Section = {
  name: 'hosts',
  statements: (ctx) => [
    ctx.db
      .prepare(
        `SELECT host, COUNT(*) AS count FROM links WHERE user_id = ?
         GROUP BY host ORDER BY count DESC, host LIMIT 10`,
      )
      .bind(ctx.userId),
  ],
  build: ([top = []], { links }) => ({
    distinct: n(links, 'hosts'),
    top: top.map((h) => ({ host: h.host, count: h.count })),
  }),
};

/** Every section of the answer, in its order. */
export const SECTIONS: Section[] = [library, content, topics, tags, workspaces, hosts];

/**
 * The statistics of the user's library at `at`: every section's statements in
 * one batch, then each section built from its own results. Any failure is
 * thrown, so the caller answers with no partial result.
 */
export async function computeStats(
  db: D1Database,
  userId: string,
  at: Date,
): Promise<Record<string, unknown>> {
  const ctx: StatsContext = { db, userId, at };
  const plans = SECTIONS.map((s) => ({ section: s, statements: s.statements(ctx) }));
  const results = await db.batch<Row>([linkCounts(ctx), ...plans.flatMap((p) => p.statements)]);
  const built: BuildContext = { ...ctx, links: results[0]?.results[0] ?? {} };
  const out: Record<string, unknown> = {};
  let i = 1;
  for (const { section, statements } of plans) {
    const own = results.slice(i, i + statements.length).map((r) => r.results);
    i += statements.length;
    statsHooks.beforeSection?.(section.name);
    out[section.name] = section.build(own, built);
  }
  return out;
}

import { epochMs } from '../decay/decay';
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

const DAY_MS = 86_400_000;

/**
 * The SQL expression of a link `l`'s points at the instant bound as `?2`, for
 * the user bound as `?1`: start points plus use count, minus the whole 24-hour
 * periods since the last use (none for a use after the instant), counted in
 * integer milliseconds as the decay expiry statement and pointsAt count them.
 */
const POINTS = `((SELECT start_points FROM users WHERE id = ?1) + l.use_count
  - MAX(0, (?2 - ${epochMs('l.last_used_at')}) / ${DAY_MS}))`;

/** The SQL condition that a link `l` is one decay can expire. */
const UNPROTECTED = `l.state IN ('active', 'pending', 'unreachable') AND l.pin_position IS NULL
  AND NOT ${IN_WORKSPACE}`;

/** The SQL condition that a link `l` is pinned or in a workspace. */
const PROTECTED = `(l.pin_position IS NOT NULL OR ${IN_WORKSPACE})`;

/** The 5 most common values of `column` among the user's links where `where` holds, as {reason, count}. */
function topReasons(ctx: StatsContext, column: string, where: string): D1PreparedStatement {
  return ctx.db
    .prepare(
      `SELECT ${column} AS reason, COUNT(*) AS count FROM links l
       WHERE l.user_id = ? AND ${where} AND ${column} IS NOT NULL
       GROUP BY ${column} ORDER BY count DESC, reason COLLATE NOCASE, reason LIMIT 5`,
    )
    .bind(ctx.userId);
}

/** {reason, count} rows as the answer gives them. */
function reasons(rows: Row[] = []) {
  return rows.map((r) => ({ reason: r.reason, count: r.count }));
}

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

/** A section's results, one list of rows per statement, padded with empty lists to eight. */
type Results = [Row[], Row[], Row[], Row[], Row[], Row[], Row[], Row[]];

/**
 * One section of the statistics: the statements it reads, bound to the user,
 * and how it turns their rows (one result per statement, in order) into its
 * part of the answer.
 */
export interface Section {
  name: string;
  statements: (ctx: StatsContext) => D1PreparedStatement[];
  build: (results: Results, ctx: BuildContext) => unknown;
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
  build: ([[levels], largest], { links }) => ({
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
  build: ([[totals], top], { links }) => ({
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
  build: ([[totals], largest]) => ({
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
  build: ([top], { links }) => ({
    distinct: n(links, 'hosts'),
    top: top.map((h) => ({ host: h.host, count: h.count })),
  }),
};

/** The ranges of the points histogram, in order, with the SQL condition on a link's points `p`. */
const RANGES: [string, string][] = [
  ['≤0', 'p <= 0'],
  ['1–7', 'p BETWEEN 1 AND 7'],
  ['8–30', 'p BETWEEN 8 AND 30'],
  ['31–60', 'p BETWEEN 31 AND 60'],
  ['61–90', 'p BETWEEN 61 AND 90'],
  ['>90', 'p > 90'],
];

const expiry: Section = {
  name: 'expiry',
  statements: (ctx) => {
    const t = ctx.at.getTime();
    return [
      ctx.db
        .prepare(
          `SELECT ${RANGES.map(([, cond], i) => `SUM(${cond}) AS r${i}`).join(', ')}
           FROM (SELECT ${POINTS} AS p FROM links l WHERE l.user_id = ?1 AND ${UNPROTECTED})`,
        )
        .bind(ctx.userId, t),
      ctx.db
        .prepare(
          `SELECT COUNT(*) AS n FROM links l
           WHERE l.user_id = ?1 AND l.state NOT IN ('expired', 'archived') AND ${PROTECTED}
             AND ${POINTS} <= 0`,
        )
        .bind(ctx.userId, t),
      ctx.db
        .prepare(
          `SELECT COUNT(*) AS total,
             SUM(removal <= ?2 + 7 * ${DAY_MS}) AS within_7_days,
             SUM(removal <= ?2 + 30 * ${DAY_MS}) AS within_30_days
           FROM (SELECT ${epochMs('l.expired_at')}
               + (SELECT remove_days FROM users WHERE id = ?1) * ${DAY_MS} AS removal
             FROM links l WHERE l.user_id = ?1 AND l.state = 'expired'
               AND l.pin_position IS NULL AND NOT ${IN_WORKSPACE})`,
        )
        .bind(ctx.userId, t),
      ctx.db.prepare('SELECT start_points, remove_days FROM users WHERE id = ?').bind(ctx.userId),
    ];
  },
  build: ([[ranges], [atRisk], [removal], [settings]]) => ({
    expiring: {
      today: n(ranges, 'r0'),
      within_7_days: n(ranges, 'r1'),
      within_30_days: n(ranges, 'r2'),
    },
    points_histogram: RANGES.map(([range], i) => ({ range, count: n(ranges, `r${i}`) })),
    protected_at_risk: n(atRisk, 'n'),
    awaiting_removal: {
      total: n(removal, 'total'),
      within_7_days: n(removal, 'within_7_days'),
      within_30_days: n(removal, 'within_30_days'),
    },
    settings: {
      start_points: n(settings, 'start_points'),
      remove_days: n(settings, 'remove_days'),
    },
  }),
};

/** The enrichment statuses, as stored; a link with none counts as 'none'. */
const ENRICHMENT_STATUSES = [
  'no_key',
  'queued',
  'enriched',
  'failed',
  'skipped',
  'waiting_for_key',
] as const;

const health: Section = {
  name: 'health',
  statements: (ctx) => [
    topReasons(ctx, 'l.state_reason', "l.state = 'unreachable'"),
    ctx.db
      .prepare(
        `SELECT SUM(liveness_failures > 0) AS dead,
           SUM(liveness_failures > 0 AND dead_since <= ?2) AS dead_over_30_days
         FROM links WHERE user_id = ?1`,
      )
      .bind(ctx.userId, new Date(ctx.at.getTime() - 30 * DAY_MS).toISOString()),
    ctx.db
      .prepare(
        `SELECT ${ENRICHMENT_STATUSES.map((s) => `SUM(enrichment_status = '${s}') AS ${s}`).join(', ')},
           SUM(enrichment_status IS NULL) AS none
         FROM links WHERE user_id = ?`,
      )
      .bind(ctx.userId),
    topReasons(ctx, 'l.enrichment_reason', "l.enrichment_status = 'failed'"),
    ctx.db
      .prepare(
        'SELECT ai_key_ciphertext IS NOT NULL AS has_key, ai_key_status FROM users WHERE id = ?',
      )
      .bind(ctx.userId),
  ],
  build: ([unreachable, [dead], [statuses], failed, [key]], { links }) => ({
    unreachable: { count: n(links, 'unreachable'), by_reason: reasons(unreachable) },
    dead: { count: n(dead, 'dead'), dead_over_30_days: n(dead, 'dead_over_30_days') },
    enrichment: {
      ...Object.fromEntries(ENRICHMENT_STATUSES.map((s) => [s, n(statuses, s)])),
      none: n(statuses, 'none'),
      failed_by_reason: reasons(failed),
    },
    ai_key: !n(key, 'has_key')
      ? 'none'
      : key?.ai_key_status === 'rejected'
        ? 'rejected'
        : 'verified',
  }),
};

/** Every section of the answer, in its order. */
export const SECTIONS: Section[] = [
  library,
  content,
  topics,
  tags,
  workspaces,
  hosts,
  expiry,
  health,
];

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
    while (own.length < 8) own.push([]);
    i += statements.length;
    statsHooks.beforeSection?.(section.name);
    out[section.name] = section.build(own as Results, built);
  }
  return out;
}

/**
 * A link's points, in one place: the constants, the computation the API
 * answers with, and the same quantity as SQL for the statements that rank,
 * expire and count by it.
 */

/** One day, in milliseconds. */
export const DAY_MS = 86_400_000;

/** The decay settings of a user who never changed them. */
export const DEFAULT_THRESHOLDS = { start_points: 60, remove_days: 180, use_boost: 50 } as const;

/**
 * A link's points at time `at`: its user's start points plus its use count,
 * minus the whole 24-hour periods since its decay start (none for a decay start
 * after `at`). They can be negative.
 */
export function pointsAt(
  startPoints: number,
  useCount: number,
  decayFrom: string,
  at: number,
): number {
  return startPoints + useCount - Math.max(0, Math.floor((at - Date.parse(decayFrom)) / DAY_MS));
}

/**
 * The SQL expression of a stored timestamp `column` as milliseconds since the
 * epoch, in integers, so that whole days are counted exactly as pointsAt counts
 * them.
 */
export function epochMs(column: string): string {
  return `(CAST(strftime('%s', ${column}) AS INTEGER) * 1000 + CAST(substr(${column}, 21, 3) AS INTEGER))`;
}

/**
 * The SQL expression of the integer milliseconds `ms` since the epoch as a
 * stored timestamp, to the millisecond: the inverse of epochMs.
 */
export function isoFromMs(ms: string): string {
  return `(strftime('%Y-%m-%dT%H:%M:%S', (${ms}) / 1000, 'unixepoch')
    || printf('.%03dZ', (${ms}) % 1000))`;
}

/**
 * The SQL expression of the points of the link aliased `l`, counted as pointsAt
 * counts them: `startPoints` is the SQL of its user's start points and `at` the
 * SQL of the instant, in integer milliseconds.
 */
export function pointsSql(l: string, startPoints: string, at: string): string {
  return `(${startPoints} + ${l}.use_count
    - MAX(0, (${at} - ${epochMs(`${l}.decay_from`)}) / ${DAY_MS}))`;
}

/** The SQL condition that a link `l` is in at least one workspace. */
export const IN_WORKSPACE = 'EXISTS (SELECT 1 FROM workspace_links wl WHERE wl.link_id = l.id)';

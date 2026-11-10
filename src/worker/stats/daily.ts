/**
 * The daily record: counters of what happened in a user's library on each UTC
 * day, written in the same batch as the change each one counts, so a change
 * that fails or is rolled back is never counted and a stored one always is.
 */

/** Test seams of the usage recorder, as the clock is one. */
export const usageHooks: { beforeRecord?: () => void } = {};

/** The events the daily record counts, one column each. */
export const COUNTERS = [
  'added',
  'used',
  'expired',
  'removed',
  'deleted',
  'archived',
  'unarchived',
  'restored',
  'fetch_ok',
  'fetch_failed',
  'enriched',
  'enrichment_failed',
  'asks',
] as const;

export type Counter = (typeof COUNTERS)[number];

/** The UTC day of a stored time or an instant, as 'YYYY-MM-DD'. */
export function dayOf(at: string | Date | number): string {
  const iso = typeof at === 'string' ? at : new Date(at).toISOString();
  return iso.slice(0, 10);
}

/** What one count statement adds, and when. */
export interface Count {
  userId: string;
  /** When the event happened: its UTC day is the day counted. */
  at: string | Date | number;
  counter: Counter;
  /** An SQL expression of how many to add; 1 by default. */
  amount?: string;
  /** An SQL condition the count is made on; the change's own result, read in the same batch. */
  when?: string;
  /** The values of `amount` and `when`'s parameters, numbered from ?3. */
  binds?: unknown[];
}

/**
 * The statement that adds to one counter of the user's day, to put in the
 * same batch as the change it counts. Nothing is added when `when` is false
 * or the amount is 0.
 */
export function countStatement(db: D1Database, c: Count): D1PreparedStatement {
  if (!COUNTERS.includes(c.counter)) throw new Error(`no counter ${c.counter}`);
  const amount = c.amount ?? '1';
  return db
    .prepare(
      `INSERT INTO daily_stats (user_id, day, ${c.counter})
       SELECT ?1, ?2, n FROM (SELECT ${amount} AS n) WHERE n > 0 AND (${c.when ?? 'true'})
       ON CONFLICT (user_id, day) DO UPDATE SET ${c.counter} = ${c.counter} + excluded.${c.counter}`,
    )
    .bind(c.userId, dayOf(c.at), ...(c.binds ?? []));
}

/** The size columns of the daily record, in the order the answer gives them. */
export const SIZE_STATES = ['pending', 'active', 'unreachable', 'expired', 'archived'] as const;

const DAY_MS = 86_400_000;

/** Why a call to the owner's AI provider was made. */
export type Purpose = 'enrich' | 'split' | 'ask' | 'key_test';

/** One provider call to record: when it ended, and the tokens its answer reported, if any. */
export interface UsageRecord {
  userId: string;
  purpose: Purpose;
  model: string;
  at: Date;
  tokens: { input: number; output: number } | null;
}

/**
 * Records one provider call under its UTC day, purpose and model: one more
 * call, and its tokens added, or one more call without usage when its answer
 * reported none (a failure, a timeout).
 */
export async function recordUsage(db: D1Database, u: UsageRecord): Promise<void> {
  usageHooks.beforeRecord?.();
  const input = u.tokens?.input ?? 0;
  const output = u.tokens?.output ?? 0;
  const without = u.tokens ? 0 : 1;
  await db
    .prepare(
      `INSERT INTO daily_ai_usage
         (user_id, day, purpose, model, calls, input_tokens, output_tokens, calls_without_usage)
       VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7)
       ON CONFLICT (user_id, day, purpose, model) DO UPDATE SET
         calls = calls + 1, input_tokens = input_tokens + ?5, output_tokens = output_tokens + ?6,
         calls_without_usage = calls_without_usage + ?7`,
    )
    .bind(u.userId, dayOf(u.at), u.purpose, u.model, input, output, without)
    .run();
}

/**
 * Records, at an hourly run starting between 00:00 and 01:00 UTC, every
 * owner's library size under the UTC day that just ended: the total and the
 * count in each state, for every owner not being deleted. A day's size is
 * written once and never filled in later; a run outside that hour records
 * nothing.
 */
export async function recordDaySizes(db: D1Database, t: Date): Promise<void> {
  if (t.getUTCHours() !== 0) return;
  const day = dayOf(t.getTime() - DAY_MS);
  const states = SIZE_STATES.map((s) => `COALESCE(SUM(l.state = '${s}'), 0)`).join(', ');
  const columns = SIZE_STATES.map((s) => `size_${s}`);
  await db
    .prepare(
      `INSERT INTO daily_stats (user_id, day, size_total, ${columns.join(', ')})
       SELECT u.id, ?1, COUNT(l.id), ${states}
       FROM users u LEFT JOIN links l ON l.user_id = u.id
       WHERE u.deletion_requested_at IS NULL
       GROUP BY u.id
       ON CONFLICT (user_id, day) DO UPDATE SET size_total = excluded.size_total,
         ${columns.map((c) => `${c} = excluded.${c}`).join(', ')}
       WHERE daily_stats.size_total IS NULL`,
    )
    .bind(day)
    .run();
}

type Row = Record<string, unknown>;

/** One day of the record as GET /api/v1/stats/history answers it. */
export interface HistoryDay {
  day: string;
  [counter: string]: unknown;
}

/**
 * The user's record for `days` (UTC days, oldest first): every day present,
 * days before the first recorded day with null counters, recorded days with 0
 * for an event that did not happen, size null until it is recorded.
 */
export async function readHistory(
  db: D1Database,
  userId: string,
  days: string[],
): Promise<{ recorded_since: string | null; days: HistoryDay[] }> {
  const first = days[0] ?? '';
  const last = days[days.length - 1] ?? '';
  const [stats, usage, since] = await db.batch<Row>([
    db
      .prepare('SELECT * FROM daily_stats WHERE user_id = ? AND day BETWEEN ? AND ?')
      .bind(userId, first, last),
    db
      .prepare(
        `SELECT day, purpose, model, calls, input_tokens, output_tokens, calls_without_usage
         FROM daily_ai_usage WHERE user_id = ? AND day BETWEEN ? AND ?
         ORDER BY purpose, model`,
      )
      .bind(userId, first, last),
    db
      .prepare(
        `SELECT MIN(day) AS day FROM (
           SELECT day FROM daily_stats WHERE user_id = ?1
           UNION ALL SELECT day FROM daily_ai_usage WHERE user_id = ?1)`,
      )
      .bind(userId),
  ]);
  const recordedSince = (since?.results[0]?.day as string | null | undefined) ?? null;
  const byDay = new Map((stats?.results ?? []).map((r) => [r.day as string, r]));
  const aiByDay = new Map<string, Row[]>();
  for (const u of usage?.results ?? []) {
    const list = aiByDay.get(u.day as string) ?? [];
    list.push(u);
    aiByDay.set(u.day as string, list);
  }
  return {
    recorded_since: recordedSince,
    days: days.map((day) => {
      const row = byDay.get(day);
      const recorded = recordedSince !== null && day >= recordedSince;
      const counters = Object.fromEntries(
        COUNTERS.map((c) => [c, recorded ? ((row?.[c] as number | undefined) ?? 0) : null]),
      );
      const size =
        row && row.size_total !== null && row.size_total !== undefined
          ? {
              total: row.size_total,
              ...Object.fromEntries(SIZE_STATES.map((s) => [s, row[`size_${s}`]])),
            }
          : null;
      const ai = (aiByDay.get(day) ?? []).map((u) => ({
        purpose: u.purpose,
        model: u.model,
        calls: u.calls,
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        calls_without_usage: u.calls_without_usage,
      }));
      return { day, ...counters, size, ai };
    }),
  };
}

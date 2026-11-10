import { Hono } from 'hono';
import { readJson, validationError } from '../api/errors';
import type { AppEnv } from '../env';

/** The bounds of the start points and the removal delay. */
export const THRESHOLD_MIN = 7;
export const THRESHOLD_MAX = 3650;

/** Each decay setting, in the order a body is checked, with its bounds. */
const FIELDS = [
  { field: 'start_points', min: THRESHOLD_MIN, max: THRESHOLD_MAX },
  { field: 'remove_days', min: THRESHOLD_MIN, max: THRESHOLD_MAX },
  { field: 'use_boost', min: 10, max: 100 },
] as const;

/**
 * A user's decay settings: the points a link starts from, the days from expiry
 * to removal, and the percent of the time decayed that the first use of a link
 * on a UTC day wins back.
 */
export interface Thresholds {
  start_points: number;
  remove_days: number;
  use_boost: number;
}

/** The user's decay settings. */
export async function getThresholds(db: D1Database, userId: string): Promise<Thresholds> {
  const row = await db
    .prepare('SELECT start_points, remove_days, use_boost FROM users WHERE id = ?')
    .bind(userId)
    .first<Thresholds>();
  return row ?? { start_points: 60, remove_days: 180, use_boost: 50 };
}

/** The decay settings, under /api/v1/settings. */
export const decaySettingsRoutes = new Hono<AppEnv>();

decaySettingsRoutes.get('/decay', async (c) =>
  c.json(await getThresholds(c.env.DB, c.get('user').id)),
);

decaySettingsRoutes.put('/decay', async (c) => {
  const parsed = await readJson(c);
  if (!parsed.ok) return parsed.response;
  for (const { field, min, max } of FIELDS) {
    const value = parsed.body[field];
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
      return validationError(
        c,
        'invalid_threshold',
        field,
        `${field} must be a whole number from ${min} to ${max}`,
      );
    }
  }
  const t = parsed.body as unknown as Thresholds;
  // A new use boost applies to later uses only: no link's decay start moves.
  await c.env.DB.prepare(
    'UPDATE users SET start_points = ?, remove_days = ?, use_boost = ? WHERE id = ?',
  )
    .bind(t.start_points, t.remove_days, t.use_boost, c.get('user').id)
    .run();
  return c.json({
    start_points: t.start_points,
    remove_days: t.remove_days,
    use_boost: t.use_boost,
  });
});

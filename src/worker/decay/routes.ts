import { Hono } from 'hono';
import { readJson, validationError } from '../api/errors';
import type { AppEnv } from '../env';

/** The bounds of every decay setting. */
export const THRESHOLD_MIN = 7;
export const THRESHOLD_MAX = 3650;
const FIELDS = ['start_points', 'remove_days'] as const;

/** A user's decay settings: the points a link starts from, and the days from expiry to removal. */
export interface Thresholds {
  start_points: number;
  remove_days: number;
}

/** The user's decay settings. */
export async function getThresholds(db: D1Database, userId: string): Promise<Thresholds> {
  const row = await db
    .prepare('SELECT start_points, remove_days FROM users WHERE id = ?')
    .bind(userId)
    .first<Thresholds>();
  return row ?? { start_points: 60, remove_days: 180 };
}

/** The decay settings, under /api/v1/settings. */
export const decaySettingsRoutes = new Hono<AppEnv>();

decaySettingsRoutes.get('/decay', async (c) =>
  c.json(await getThresholds(c.env.DB, c.get('user').id)),
);

decaySettingsRoutes.put('/decay', async (c) => {
  const parsed = await readJson(c);
  if (!parsed.ok) return parsed.response;
  for (const field of FIELDS) {
    const value = parsed.body[field];
    if (
      !Number.isInteger(value) ||
      (value as number) < THRESHOLD_MIN ||
      (value as number) > THRESHOLD_MAX
    ) {
      return validationError(
        c,
        'invalid_threshold',
        field,
        `${field} must be a whole number from ${THRESHOLD_MIN} to ${THRESHOLD_MAX}`,
      );
    }
  }
  const t = parsed.body as unknown as Thresholds;
  await c.env.DB.prepare('UPDATE users SET start_points = ?, remove_days = ? WHERE id = ?')
    .bind(t.start_points, t.remove_days, c.get('user').id)
    .run();
  return c.json({ start_points: t.start_points, remove_days: t.remove_days });
});

import { Hono } from 'hono';
import { readJson, validationError } from '../api/errors';
import type { AppEnv } from '../env';

/** The bounds of every decay threshold, in days. */
export const THRESHOLD_MIN = 7;
export const THRESHOLD_MAX = 3650;
const FIELDS = ['dormant_days', 'archive_days', 'remove_days'] as const;

/** A user's decay thresholds, in days. */
export interface Thresholds {
  dormant_days: number;
  archive_days: number;
  remove_days: number;
}

/** The user's decay thresholds. */
export async function getThresholds(db: D1Database, userId: string): Promise<Thresholds> {
  const row = await db
    .prepare('SELECT dormant_days, archive_days, remove_days FROM users WHERE id = ?')
    .bind(userId)
    .first<Thresholds>();
  return row ?? { dormant_days: 60, archive_days: 120, remove_days: 180 };
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
        `${field} must be a whole number of days from ${THRESHOLD_MIN} to ${THRESHOLD_MAX}`,
      );
    }
  }
  const t = parsed.body as unknown as Thresholds;
  if (t.dormant_days >= t.archive_days) {
    return validationError(
      c,
      'invalid_thresholds',
      'dormant_days',
      'the dormant threshold must be below the archive threshold',
    );
  }
  await c.env.DB.prepare(
    'UPDATE users SET dormant_days = ?, archive_days = ?, remove_days = ? WHERE id = ?',
  )
    .bind(t.dormant_days, t.archive_days, t.remove_days, c.get('user').id)
    .run();
  return c.json({
    dormant_days: t.dormant_days,
    archive_days: t.archive_days,
    remove_days: t.remove_days,
  });
});

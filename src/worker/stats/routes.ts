import { Hono } from 'hono';
import { validationError } from '../api/errors';
import { now } from '../clock';
import type { AppEnv } from '../env';
import { readHistory } from './daily';
import { computeStats, lastDays } from './stats';

/** The most days GET /api/v1/stats/history answers, and how many without `days`. */
export const HISTORY_MAX_DAYS = 365;
const HISTORY_DEFAULT_DAYS = 30;

/** The statistics of the owner's library, under /api/v1/stats. */
export const statsRoutes = new Hono<AppEnv>();

statsRoutes.get('/', async (c) => c.json(await computeStats(c.env.DB, c.get('user').id, now())));

statsRoutes.get('/history', async (c) => {
  const raw = c.req.query('days');
  const days = raw === undefined ? HISTORY_DEFAULT_DAYS : /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(days) || days < 1 || days > HISTORY_MAX_DAYS) {
    return validationError(c, 'invalid_days', 'days', 'days is a whole number from 1 to 365');
  }
  return c.json(await readHistory(c.env.DB, c.get('user').id, lastDays(now(), days)));
});

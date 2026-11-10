import { Hono } from 'hono';
import { now } from '../clock';
import type { AppEnv } from '../env';
import { computeStats } from './stats';

/** The statistics of the owner's library, under /api/v1/stats. */
export const statsRoutes = new Hono<AppEnv>();

statsRoutes.get('/', async (c) => c.json(await computeStats(c.env.DB, c.get('user').id, now())));

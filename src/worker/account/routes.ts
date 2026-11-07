import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { exportResponse } from './export';

/** The export, under /api/v1/export. */
export const exportRoutes = new Hono<AppEnv>();

exportRoutes.get('/', (c) => exportResponse(c.env, c.get('user')));

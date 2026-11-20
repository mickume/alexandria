import { Hono } from 'hono';
import { notFound } from '../api/errors';
import { now } from '../clock';
import type { AppEnv, Env } from '../env';
import { aiState, NO_AI_KEY_MESSAGE } from './keys';
import { getLink } from '../links/store';
import { setEnrichmentStatus } from './queue';
import { sendThrottled } from './throttle';

/** Enrichment states that count as waiting to be enriched. */
export const UNENRICHED_STATES = ['no_key', 'waiting_for_key', 'failed'];

/** Asking for enrichment of the user's links, under /api/v1/links. */
export const enrichLinkRoutes = new Hono<AppEnv>();

const NO_AI_KEY = { error: 'no_ai_key', message: NO_AI_KEY_MESSAGE };

/** Whether the deployment has an AI key its provider has not refused. */
async function hasVerifiedKey(env: Env): Promise<boolean> {
  return (await aiState(env)).status === 'verified';
}

enrichLinkRoutes.post('/enrich-unenriched', async (c) => {
  const userId = c.get('user').id;
  if (!(await hasVerifiedKey(c.env))) return c.json(NO_AI_KEY, 409);
  const rows = await c.env.DB.prepare(
    `UPDATE links SET enrichment_status = 'queued', enrichment_reason = NULL, updated_at = ?
     WHERE user_id = ? AND enrichment_status IN (${UNENRICHED_STATES.map(() => '?').join(', ')})
     RETURNING id`,
  )
    .bind(now().toISOString(), userId, ...UNENRICHED_STATES)
    .all<{ id: string }>();
  const ids = rows.results.map((r) => r.id);
  await sendThrottled(c.env, userId, ids);
  return c.json({ queued: ids.length }, 202);
});

enrichLinkRoutes.post('/:id/enrich', async (c) => {
  const userId = c.get('user').id;
  if (!(await hasVerifiedKey(c.env))) return c.json(NO_AI_KEY, 409);
  const link = await getLink(c.env.DB, userId, c.req.param('id'));
  if (!link) return notFound(c);
  if (
    link.state === 'pending' ||
    link.state === 'unreachable' ||
    link.enrichment_status === 'skipped'
  ) {
    return c.json({ error: 'nothing_to_enrich', message: 'this link has nothing to enrich' }, 409);
  }
  await setEnrichmentStatus(c.env.DB, link, 'queued');
  await c.env.ENRICH_QUEUE.send({ user_id: userId, link_id: link.id, manual: true });
  return c.json({ status: 'queued' }, 202);
});

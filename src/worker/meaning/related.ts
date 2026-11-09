/**
 * Related links: the owner's other links nearest in meaning to one link,
 * worked out when they are asked for. GET /api/v1/links/{id}/related returns them.
 */
import { Hono } from 'hono';
import { notFound, refusal } from '../api/errors';
import type { AppEnv, Env } from '../env';
import { getLink, toView, type LinkRow } from '../links/store';
import { findPassages, MeaningUnavailable } from './passages';

/** The most related links returned. */
export const RELATED_LINKS = 5;

/** A link near in meaning to another, with the similarity of its best passage. */
export interface RelatedLink {
  id: string;
  score: number;
}

/**
 * The user's links nearest in meaning to the link, best first: at most
 * RELATED_LINKS, each scoring at least the similarity threshold, expired
 * links left out. The link is matched by its first passage, which holds its
 * title, summary, topic, tags and note; a link not yet indexed has none, and
 * no related links. Throws MeaningUnavailable.
 */
export async function findRelated(
  env: Env,
  userId: string,
  linkId: string,
): Promise<RelatedLink[]> {
  const first = await env.DB.prepare(
    `SELECT text FROM link_passages WHERE link_id = ? AND user_id = ? AND position = 0
     ORDER BY version DESC LIMIT 1`,
  )
    .bind(linkId, userId)
    .first<{ text: string }>();
  if (!first) return [];
  // One passage per link; the link itself is among them, so ask for one more.
  const passages = await findPassages(env, userId, [first.text], {}, RELATED_LINKS + 1, {
    perLink: 1,
  });
  return passages
    .filter((p) => p.link_id !== linkId)
    .slice(0, RELATED_LINKS)
    .map((p) => ({ id: p.link_id, score: p.score }));
}

/** GET /api/v1/links/{id}/related. */
export const relatedRoutes = new Hono<AppEnv>();

relatedRoutes.get('/:id/related', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  if (!(await getLink(c.env.DB, userId, id))) return notFound(c);
  let related: RelatedLink[];
  try {
    related = await findRelated(c.env, userId, id);
  } catch (err) {
    if (!(err instanceof MeaningUnavailable)) throw err;
    console.error('search by meaning is unavailable', err);
    return refusal(c, 503, 'search_unavailable', 'search by meaning is unavailable, try again');
  }
  const rows = related.length
    ? (
        await c.env.DB.prepare(
          'SELECT * FROM link_views WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))',
        )
          .bind(userId, JSON.stringify(related.map((r) => r.id)))
          .all<LinkRow>()
      ).results
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  return c.json({
    items: related.flatMap((r) => {
      const row = byId.get(r.id);
      return row ? [{ ...toView(row), score: r.score }] : [];
    }),
  });
});

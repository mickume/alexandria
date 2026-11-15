import { now } from '../clock';
import type { Env } from '../env';

/** The name of the one-time job that removes the copies fetches stored before snapshots. */
export const LEGACY_SWEEP = 'legacy_snapshots';
/** Objects listed per page of the sweep. */
const PAGE_SIZE = 1000;
/** Pages swept per run, so that one run stays well within its limits. */
const PAGES_PER_RUN = 5;

/**
 * Whether `key` holds a copy that a fetch stored before snapshots: a reader
 * view, or a page's raw HTML. Neither is ever written again, so the sweep
 * cannot race a fetch; a PDF stored under the same old key is kept.
 */
function isLegacy(object: R2Object): boolean {
  if (object.key.endsWith('/reader.json')) return true;
  return (
    object.key.endsWith('/snapshot') &&
    (object.httpMetadata?.contentType ?? '').startsWith('text/html')
  );
}

/**
 * Removes the raw HTML and the reader views fetches stored before snapshots,
 * a few pages of SNAPSHOTS per run, from where the last run stopped, until it
 * has been through the whole bucket once. A run that fails part-way leaves
 * the cursor of the last page it finished, and the next run goes on from
 * there. Returns how many objects it removed.
 */
export async function sweepLegacySnapshots(env: Env): Promise<number> {
  const state = await env.DB.prepare('SELECT cursor, done_at FROM maintenance_state WHERE name = ?')
    .bind(LEGACY_SWEEP)
    .first<{ cursor: string | null; done_at: string | null }>();
  if (!state || state.done_at) return 0;
  let cursor = state.cursor ?? undefined;
  let removed = 0;
  for (let page = 0; page < PAGES_PER_RUN; page++) {
    const listing = await env.SNAPSHOTS.list({
      prefix: 'u/',
      cursor,
      limit: PAGE_SIZE,
      include: ['httpMetadata'],
    });
    const keys = listing.objects.filter(isLegacy).map((o) => o.key);
    if (keys.length > 0) await env.SNAPSHOTS.delete(keys);
    removed += keys.length;
    const done = !listing.truncated;
    cursor = listing.truncated ? listing.cursor : undefined;
    await env.DB.prepare('UPDATE maintenance_state SET cursor = ?, done_at = ? WHERE name = ?')
      .bind(cursor ?? null, done ? now().toISOString() : null, LEGACY_SWEEP)
      .run();
    if (done) break;
  }
  return removed;
}

import { now } from '../clock';

/** The most links one library holds, in any state. */
export const LIBRARY_LIMIT = 20_000;

/** A link as stored. */
export interface LinkRow {
  id: string;
  user_id: string;
  url: string;
  original_url: string;
  host: string;
  title: string;
  state: string;
  added_at: string;
  last_used_at: string;
  use_count: number;
  pin_position: number | null;
  final_url: string | null;
  http_status: number | null;
  description: string | null;
  favicon_url: string | null;
  language: string | null;
  fetched_at: string | null;
  fetch_attempts: number;
  state_reason: string | null;
  /** A JSON array of notes. */
  notes: string;
  content_kind: string | null;
  has_snapshot: number;
  reader_empty: number;
  refresh_requested_at: string | null;
  updated_at: string;
}

/** A link as the API shows it. */
export interface LinkView {
  id: string;
  url: string;
  original_url: string;
  host: string;
  title: string;
  state: string;
  added_at: string;
  last_used_at: string;
  use_count: number;
  pinned: boolean;
  pin_position: number | null;
  /** The URL of the last response of the latest successful fetch. */
  final_url: string | null;
  http_status: number | null;
  description: string | null;
  favicon_url: string | null;
  language: string | null;
  fetched_at: string | null;
  /** Why the link is in its state, such as "HTTP 503" for a pending or unreachable link. */
  state_reason: string | null;
  /** Short notes such as "truncated" or "not a web page (image/png)". */
  notes: string[];
  /** What the fetched resource is: 'html', 'pdf' or 'other'; null before the first fetch. */
  content_kind: string | null;
  /** Whether a snapshot is stored, so that Read and Snapshot can be offered. */
  has_snapshot: boolean;
}

/** A link's notes, parsed from their stored JSON. */
export function parseNotes(notes: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(notes ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

/** The API's view of a stored link. */
export function toView(row: LinkRow): LinkView {
  return {
    id: row.id,
    url: row.url,
    original_url: row.original_url,
    host: row.host,
    title: row.title,
    state: row.state,
    added_at: row.added_at,
    last_used_at: row.last_used_at,
    use_count: row.use_count,
    pinned: row.pin_position !== null,
    pin_position: row.pin_position,
    final_url: row.final_url,
    http_status: row.http_status,
    description: row.description,
    favicon_url: row.favicon_url,
    language: row.language,
    fetched_at: row.fetched_at,
    state_reason: row.state_reason,
    notes: parseNotes(row.notes),
    content_kind: row.content_kind,
    has_snapshot: row.has_snapshot === 1,
  };
}

/** What adding one URL did. */
export type AddOutcome =
  | { status: 'added'; link: LinkView }
  | { status: 'boosted'; link: LinkView }
  | { status: 'library_full' };

/** One URL to add: its normalised form and the input it came from. */
export interface NewLink {
  url: string;
  original: string;
}

/**
 * The statement that adds `link` for `userId` at time `at`, or boosts the link
 * the user already has for the same normalised URL. It relies on the unique
 * index on (user_id, url), so concurrent adds of one URL store one link; it
 * inserts only while the library is under LIBRARY_LIMIT, and returns no row
 * when the library is full.
 */
function addStatement(db: D1Database, userId: string, link: NewLink, at: string, id: string) {
  const host = new URL(link.url).host;
  return db
    .prepare(
      `INSERT INTO links (id, user_id, url, original_url, host, title, state, added_at, last_used_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?5, 'pending', ?6, ?6
       WHERE (SELECT COUNT(*) FROM links WHERE user_id = ?2) < ?7
          OR EXISTS (SELECT 1 FROM links WHERE user_id = ?2 AND url = ?3)
       ON CONFLICT (user_id, url) DO UPDATE SET last_used_at = excluded.last_used_at
       RETURNING *`,
    )
    .bind(id, userId, link.url, link.original, host, at, LIBRARY_LIMIT);
}

function outcome(row: LinkRow | undefined, id: string): AddOutcome {
  if (!row) return { status: 'library_full' };
  return { status: row.id === id ? 'added' : 'boosted', link: toView(row) };
}

/** Adds one link, or boosts the user's existing link for the same normalised URL. */
export async function addLink(db: D1Database, userId: string, link: NewLink): Promise<AddOutcome> {
  const id = crypto.randomUUID();
  const row = await addStatement(db, userId, link, now().toISOString(), id).first<LinkRow>();
  return outcome(row ?? undefined, id);
}

/**
 * Adds or boosts several links in one transaction. The first link gets the
 * current time as its last use and each later one a millisecond less, so that
 * the first of the batch ends highest in the stream.
 */
export async function addLinks(
  db: D1Database,
  userId: string,
  links: NewLink[],
): Promise<AddOutcome[]> {
  if (links.length === 0) return [];
  const t = now().getTime();
  const ids = links.map(() => crypto.randomUUID());
  const results = await db.batch<LinkRow>(
    links.map((link, i) =>
      addStatement(db, userId, link, new Date(t - i).toISOString(), ids[i] ?? ''),
    ),
  );
  return results.map((r, i) => outcome(r.results[0], ids[i] ?? ''));
}

/** One of the user's links, or null when the user has no link with this id. */
export async function getLink(db: D1Database, userId: string, id: string): Promise<LinkRow | null> {
  return db
    .prepare('SELECT * FROM links WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<LinkRow>();
}

/** The most links one user may pin. */
export const PIN_LIMIT = 30;

/** Statements that take a pinned link out of the pinned section and close the gap it leaves. */
function unpinStatements(db: D1Database, userId: string, id: string): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE links SET pin_position = pin_position - 1
         WHERE user_id = ?1 AND pin_position > (
           SELECT pin_position FROM links WHERE id = ?2 AND user_id = ?1)`,
      )
      .bind(userId, id),
    db
      .prepare('UPDATE links SET pin_position = NULL WHERE id = ? AND user_id = ?')
      .bind(id, userId),
  ];
}

/** What pinning a link did. */
export type PinOutcome =
  { status: 'pinned'; link: LinkView } | { status: 'not_found' } | { status: 'pin_limit' };

/**
 * Pins one of the user's links at `position` (1-based; past the end means the
 * end), or at the end of the pinned section when no position is given, keeping
 * the other pinned links in order. A link already pinned and given no position
 * stays where it is. The positions stay 1..n in one transaction; a new pin
 * past PIN_LIMIT changes nothing.
 */
export async function pinLink(
  db: D1Database,
  userId: string,
  id: string,
  position?: number,
): Promise<PinOutcome> {
  const current = await getLink(db, userId, id);
  if (!current) return { status: 'not_found' };
  if (position === undefined && current.pin_position !== null) {
    return { status: 'pinned', link: toView(current) };
  }
  // After the link is taken out, "others" is the number of other pinned links.
  const others = `(SELECT COUNT(*) FROM links WHERE user_id = ?1 AND pin_position IS NOT NULL)`;
  const target = `MIN(?3, ${others} + 1)`;
  await db.batch([
    ...unpinStatements(db, userId, id),
    db
      .prepare(
        `UPDATE links SET pin_position = pin_position + 1
         WHERE user_id = ?1 AND pin_position >= ${target} AND ${others} < ?4`,
      )
      .bind(userId, id, position ?? PIN_LIMIT + 1, PIN_LIMIT),
    db
      .prepare(
        `UPDATE links SET pin_position = ${target}
         WHERE id = ?2 AND user_id = ?1 AND ${others} < ?4`,
      )
      .bind(userId, id, position ?? PIN_LIMIT + 1, PIN_LIMIT),
  ]);
  const after = await getLink(db, userId, id);
  if (!after) return { status: 'not_found' };
  if (after.pin_position === null) return { status: 'pin_limit' };
  return { status: 'pinned', link: toView(after) };
}

/** Unpins one of the user's links, closing the gap in the pinned section. Null when there is no such link. */
export async function unpinLink(
  db: D1Database,
  userId: string,
  id: string,
): Promise<LinkView | null> {
  if (!(await getLink(db, userId, id))) return null;
  await db.batch(unpinStatements(db, userId, id));
  const after = await getLink(db, userId, id);
  return after ? toView(after) : null;
}

/**
 * Deletes one of the user's links, its use and fetch events and its text at once and for good,
 * closing the gap in the pinned section if it was pinned. Returns false when
 * the user has no such link.
 */
export async function deleteLink(db: D1Database, userId: string, id: string): Promise<boolean> {
  const results = await db.batch([
    ...unpinStatements(db, userId, id),
    db.prepare('DELETE FROM link_uses WHERE link_id = ? AND user_id = ?').bind(id, userId),
    db.prepare('DELETE FROM link_texts WHERE link_id = ? AND user_id = ?').bind(id, userId),
    db.prepare('DELETE FROM link_events WHERE link_id = ? AND user_id = ?').bind(id, userId),
    db.prepare('DELETE FROM links WHERE id = ? AND user_id = ?').bind(id, userId),
  ]);
  return (results.at(-1)?.meta.changes ?? 0) > 0;
}

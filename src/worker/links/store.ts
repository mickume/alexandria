import { now } from '../clock';
import { countStatement } from '../stats/daily';
import { decayFields } from '../decay/note';
import { notePreview } from '../workspaces/notes';
import { leaveAllWorkspaces } from '../workspaces/store';

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
  /** When the link's decay counts from. */
  decay_from: string;
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
  summary: string | null;
  topic_id: string | null;
  enriched_at: string | null;
  enrichment_status: string | null;
  enrichment_reason: string | null;
  /** A JSON array of the fields the owner has set by hand. */
  edited_fields: string;
  /** The topic's name, when read through link_views. */
  topic?: string | null;
  /** A JSON array of the topic path's names from the top level down, when read through link_views. */
  topic_path_json?: string;
  /** A JSON array of the tag names in order, when read through link_views. */
  tags_json?: string;
  /** The owner's Markdown note. */
  note: string;
  /** A JSON array of {id, name} of the link's workspaces, when read through link_views. */
  workspaces_json?: string;
  archived_at: string | null;
  /** When the link expired, while it is expired. */
  expired_at: string | null;
  dead_since: string | null;
  liveness_failures: number;
  last_checked_at: string | null;
  last_check_result: string | null;
  check_enqueued_at: string | null;
  last_manual_check_at: string | null;
  /** Read through link_views: the link's user's start points. */
  user_start_points?: number;
  /** Read through link_views: the link's user's removal delay. */
  user_remove_days?: number;
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
  /** When the link was last used or boosted. */
  last_used_at: string;
  /** When the link's decay counts from: its points lose one a day since then. */
  decay_from: string;
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
  /** When the link last changed in any way. */
  updated_at: string;
  summary: string | null;
  tags: string[];
  topic: string | null;
  /** The names from the link's top-level topic down to its own topic; [] without a topic. */
  topic_path: string[];
  /** no_key, queued, enriched, failed, skipped or waiting_for_key; null before the first fetch. */
  enrichment_status: string | null;
  enrichment_reason: string | null;
  /** The fields the owner has set by hand, which automatic work never overwrites. */
  edited_fields: string[];
  /** The note's first line as plain text, or null without a note. */
  note_preview: string | null;
  /** The workspaces the link is in, by name. */
  workspaces: { id: string; name: string }[];
  /** The whole note: only on the link read on its own. */
  note?: string;
  /**
   * Start points plus the use count, minus the whole days since the decay
   * start; null for an archived link, which decay leaves alone.
   */
  points: number | null;
  /** When the link was archived, while it is archived. */
  archived_at: string | null;
  /** When the link expired, while it is expired. */
  expired_at: string | null;
  /** When an expired link will be removed. */
  removal_at: string | null;
  dead_since: string | null;
  last_checked_at: string | null;
  last_check_result: string | null;
  /** One sentence: the link's points and when it expires, when it will be removed, or that it is kept. */
  decay_note: string;
}

/**
 * The SQL condition that the owner edited `field` of the link being written,
 * read from the row itself, so that a write decided before the edit still
 * keeps the owner's value.
 */
export function ownerEdited(field: 'title' | 'summary' | 'tags' | 'topic'): string {
  return `EXISTS (SELECT 1 FROM json_each(links.edited_fields) WHERE value = '${field}')`;
}

/** A stored JSON array of strings (notes, tags, edited fields), parsed; [] for anything else. */
export function parseStrings(notes: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(notes ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

function parseWorkspaces(json: string | undefined): { id: string; name: string }[] {
  try {
    const parsed: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter(
          (w): w is { id: string; name: string } =>
            typeof w?.id === 'string' && typeof w?.name === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

/** The API's view of a stored link, with its whole note when read on its own. */
export function toFullView(row: LinkRow): LinkView {
  return { ...toView(row), note: row.note ?? '' };
}

/** The API's view of a stored link, as lists show it: with a note preview, not the note. */
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
    decay_from: row.decay_from,
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
    notes: parseStrings(row.notes),
    content_kind: row.content_kind,
    has_snapshot: row.has_snapshot === 1,
    updated_at: row.updated_at,
    summary: row.summary ?? null,
    tags: parseStrings(row.tags_json),
    topic: row.topic ?? null,
    topic_path: parseStrings(row.topic_path_json),
    enrichment_status: row.enrichment_status ?? null,
    enrichment_reason: row.enrichment_reason ?? null,
    edited_fields: parseStrings(row.edited_fields),
    note_preview: notePreview(row.note ?? ''),
    workspaces: parseWorkspaces(row.workspaces_json),
    ...decayFields(row),
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
 * the user already has for the same normalised URL, making it active again
 * when it had expired. It relies on the unique
 * index on (user_id, url), so concurrent adds of one URL store one link; it
 * inserts only while the library is under LIBRARY_LIMIT, and returns no row
 * when the library is full.
 */
function addStatement(db: D1Database, userId: string, link: NewLink, at: string, id: string) {
  const host = new URL(link.url).host;
  return db
    .prepare(
      `INSERT INTO links (id, user_id, url, original_url, host, title, state, added_at, last_used_at,
         decay_from, updated_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?5, 'pending', ?6, ?6, ?6, ?6
       WHERE (SELECT COUNT(*) FROM links WHERE user_id = ?2) < ?7
          OR EXISTS (SELECT 1 FROM links WHERE user_id = ?2 AND url = ?3)
       ON CONFLICT (user_id, url) DO UPDATE SET last_used_at = excluded.last_used_at,
         decay_from = excluded.decay_from,
         updated_at = excluded.updated_at,
         state = CASE WHEN links.state = 'expired' THEN 'active' ELSE links.state END,
         expired_at = NULL
       RETURNING *`,
    )
    .bind(id, userId, link.url, link.original, host, at, LIBRARY_LIMIT);
}

function outcome(row: LinkRow | undefined, id: string): AddOutcome {
  if (!row) return { status: 'library_full' };
  return { status: row.id === id ? 'added' : 'boosted', link: toView(row) };
}

/** Reads the links of `outcomes` again through link_views, so they carry their tags and topic. */
async function withViews(db: D1Database, outcomes: AddOutcome[]): Promise<AddOutcome[]> {
  const ids = outcomes.flatMap((o) => (o.status === 'library_full' ? [] : [o.link.id]));
  if (ids.length === 0) return outcomes;
  const rows = await db
    .prepare(`SELECT * FROM link_views WHERE id IN (${ids.map(() => '?').join(', ')})`)
    .bind(...ids)
    .all<LinkRow>();
  const byId = new Map(rows.results.map((r) => [r.id, r]));
  return outcomes.map((o) => {
    if (o.status === 'library_full') return o;
    const row = byId.get(o.link.id);
    return row ? { status: o.status, link: toView(row) } : o;
  });
}

/** Adds one link, or boosts the user's existing link for the same normalised URL. */
export async function addLink(db: D1Database, userId: string, link: NewLink): Promise<AddOutcome> {
  const id = crypto.randomUUID();
  const row = await addStatement(db, userId, link, now().toISOString(), id).first<LinkRow>();
  const [result] = await withViews(db, [outcome(row ?? undefined, id)]);
  return result!;
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
  return withViews(
    db,
    results.map((r, i) => outcome(r.results[0], ids[i] ?? '')),
  );
}

/** One of the user's links, or null when the user has no link with this id. */
export async function getLink(db: D1Database, userId: string, id: string): Promise<LinkRow | null> {
  return db
    .prepare('SELECT * FROM link_views WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<LinkRow>();
}

/** The most links one user may pin. */
export const PIN_LIMIT = 30;

/** Statements that take a pinned link out of the pinned section and close the gap it leaves. */
export function unpinStatements(db: D1Database, userId: string, id: string): D1PreparedStatement[] {
  const at = now().toISOString();
  return [
    db
      .prepare(
        `UPDATE links SET pin_position = pin_position - 1, updated_at = ?3
         WHERE user_id = ?1 AND pin_position > (
           SELECT pin_position FROM links WHERE id = ?2 AND user_id = ?1)`,
      )
      .bind(userId, id, at),
    db
      .prepare('UPDATE links SET pin_position = NULL, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(at, id, userId),
  ];
}

/** What pinning a link did. */
export type PinOutcome =
  | { status: 'pinned'; link: LinkView }
  | { status: 'not_found' }
  | { status: 'pin_limit' }
  | { status: 'archived' };

/**
 * Pins one of the user's links at `position` (1-based; past the end means the
 * end), or at the end of the pinned section when no position is given, keeping
 * the other pinned links in order. A link already pinned and given no position
 * stays where it is. The positions stay 1..n in one transaction; a new pin
 * past PIN_LIMIT, or of an archived link, changes nothing.
 */
export async function pinLink(
  db: D1Database,
  userId: string,
  id: string,
  position?: number,
): Promise<PinOutcome> {
  const current = await getLink(db, userId, id);
  if (!current) return { status: 'not_found' };
  // The pinned section is part of the stream, which archived links are out of.
  if (current.state === 'archived') return { status: 'archived' };
  if (position === undefined && current.pin_position !== null) {
    return { status: 'pinned', link: toView(current) };
  }
  // After the link is taken out, "others" is the number of other pinned links.
  const others = `(SELECT COUNT(*) FROM links WHERE user_id = ?1 AND pin_position IS NOT NULL)`;
  const target = `MIN(?3, ${others} + 1)`;
  // Checked again in the statements: a link archived meanwhile is not pinned.
  const pinnable = `EXISTS (SELECT 1 FROM links WHERE id = ?2 AND user_id = ?1 AND state <> 'archived')`;
  await db.batch([
    ...unpinStatements(db, userId, id),
    db
      .prepare(
        `UPDATE links SET pin_position = pin_position + 1, updated_at = ?5
         WHERE user_id = ?1 AND pin_position >= ${target} AND ${others} < ?4 AND ${pinnable}`,
      )
      .bind(userId, id, position ?? PIN_LIMIT + 1, PIN_LIMIT, now().toISOString()),
    db
      .prepare(
        `UPDATE links SET pin_position = ${target}, updated_at = ?5
         WHERE id = ?2 AND user_id = ?1 AND ${others} < ?4 AND state <> 'archived'`,
      )
      .bind(userId, id, position ?? PIN_LIMIT + 1, PIN_LIMIT, now().toISOString()),
  ]);
  const after = await getLink(db, userId, id);
  if (!after) return { status: 'not_found' };
  if (after.state === 'archived') return { status: 'archived' };
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
 * Deletes one of the user's links, its use and fetch events, its text and its passages at once and for good,
 * closing the gap in the pinned section if it was pinned. Returns false when
 * the user has no such link.
 */
export async function deleteLink(db: D1Database, userId: string, id: string): Promise<boolean> {
  const results = await db.batch([
    // Counted first, while the link is still there to count.
    countStatement(db, {
      userId,
      at: now(),
      counter: 'deleted',
      when: 'EXISTS (SELECT 1 FROM links WHERE id = ?3 AND user_id = ?1)',
      binds: [id],
    }),
    ...unpinStatements(db, userId, id),
    db.prepare('DELETE FROM link_uses WHERE link_id = ? AND user_id = ?').bind(id, userId),
    db.prepare('DELETE FROM link_texts WHERE link_id = ? AND user_id = ?').bind(id, userId),
    // Its passages go with it; the trigger on them queues their vectors for deletion.
    db.prepare('DELETE FROM link_passages WHERE link_id = ? AND user_id = ?').bind(id, userId),
    ...leaveAllWorkspaces(db, userId, id),
    db.prepare('DELETE FROM link_events WHERE link_id = ? AND user_id = ?').bind(id, userId),
    db.prepare('DELETE FROM links WHERE id = ? AND user_id = ?').bind(id, userId),
  ]);
  return (results.at(-1)?.meta.changes ?? 0) > 0;
}

/** Stores the owner's note on one of their links, as given; '' clears it. */
export async function setLinkNote(
  db: D1Database,
  userId: string,
  id: string,
  note: string,
): Promise<void> {
  await db
    .prepare('UPDATE links SET note = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .bind(note, now().toISOString(), id, userId)
    .run();
}

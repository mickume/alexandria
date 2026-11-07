import { now } from '../clock';

/** The most workspaces one user may hold. */
export const WORKSPACE_LIMIT = 200;
export const NAME_MAX = 100;
export const DESCRIPTION_MAX = 1_000;

/** A workspace as stored, with its member count. */
export interface WorkspaceRow {
  id: string;
  user_id: string;
  name: string;
  name_key: string;
  description: string;
  note: string;
  created_at: string;
  link_count: number;
}

/** A workspace as the API shows it in a list: without its note. */
export interface WorkspaceSummary {
  id: string;
  name: string;
  description: string;
  link_count: number;
  created_at: string;
}

/** A workspace as the API shows it on its own: with its note. */
export type WorkspaceView = WorkspaceSummary & { note: string };

export function toSummary(row: WorkspaceRow): WorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    link_count: row.link_count,
    created_at: row.created_at,
  };
}

export function toWorkspaceView(row: WorkspaceRow): WorkspaceView {
  return { ...toSummary(row), note: row.note };
}

/** The key names are compared by: trimmed and lower-cased. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

const SELECT = `SELECT w.*, (SELECT COUNT(*) FROM workspace_links wl WHERE wl.workspace_id = w.id) AS link_count
  FROM workspaces w`;

/** One of the user's workspaces, or null. */
export async function getWorkspace(
  db: D1Database,
  userId: string,
  id: string,
): Promise<WorkspaceRow | null> {
  return db
    .prepare(`${SELECT} WHERE w.id = ? AND w.user_id = ?`)
    .bind(id, userId)
    .first<WorkspaceRow>();
}

/** What creating or renaming a workspace did. */
export type SaveOutcome =
  | { ok: true; row: WorkspaceRow }
  | { ok: false; error: 'name_taken' | 'workspace_limit' | 'not_found' };

/** Whether another workspace of the user carries `name`, compared ignoring case. */
async function nameTaken(
  db: D1Database,
  userId: string,
  name: string,
  except: string | null,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM workspaces WHERE user_id = ? AND name_key = ? AND id IS NOT ?')
    .bind(userId, nameKey(name), except)
    .first();
  return row !== null;
}

/** Creates a workspace with an empty note and no members, within the user's limit. */
export async function createWorkspace(
  db: D1Database,
  userId: string,
  name: string,
  description: string,
): Promise<SaveOutcome> {
  if (await nameTaken(db, userId, name, null)) return { ok: false, error: 'name_taken' };
  const id = crypto.randomUUID();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO workspaces (id, user_id, name, name_key, description, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE (SELECT COUNT(*) FROM workspaces WHERE user_id = ?2) < ?7`,
    )
    .bind(id, userId, name, nameKey(name), description, now().toISOString(), WORKSPACE_LIMIT)
    .run();
  if (result.meta.changes === 0) {
    return {
      ok: false,
      error: (await nameTaken(db, userId, name, null)) ? 'name_taken' : 'workspace_limit',
    };
  }
  return { ok: true, row: (await getWorkspace(db, userId, id))! };
}

/** Changes a workspace's name, description or note; the members stay as they are. */
export async function updateWorkspace(
  db: D1Database,
  userId: string,
  id: string,
  changes: { name?: string; description?: string; note?: string },
): Promise<SaveOutcome> {
  const current = await getWorkspace(db, userId, id);
  if (!current) return { ok: false, error: 'not_found' };
  if (changes.name !== undefined && (await nameTaken(db, userId, changes.name, id))) {
    return { ok: false, error: 'name_taken' };
  }
  const name = changes.name ?? current.name;
  await db
    .prepare(
      'UPDATE workspaces SET name = ?, name_key = ?, description = ?, note = ? WHERE id = ? AND user_id = ?',
    )
    .bind(
      name,
      nameKey(name),
      changes.description ?? current.description,
      changes.note ?? current.note,
      id,
      userId,
    )
    .run();
  return { ok: true, row: (await getWorkspace(db, userId, id))! };
}

/** Deletes a workspace and its memberships, never its links. False when there is no such workspace. */
export async function deleteWorkspace(
  db: D1Database,
  userId: string,
  id: string,
): Promise<boolean> {
  const [, deleted] = await db.batch([
    db
      .prepare(
        'DELETE FROM workspace_links WHERE workspace_id = (SELECT id FROM workspaces WHERE id = ? AND user_id = ?)',
      )
      .bind(id, userId),
    db.prepare('DELETE FROM workspaces WHERE id = ? AND user_id = ?').bind(id, userId),
  ]);
  return (deleted?.meta.changes ?? 0) > 0;
}

/** Where a page of the workspace list ends. */
export interface WorkspaceCursor {
  k: string;
  i: string;
}

export function isWorkspaceCursor(value: unknown): value is WorkspaceCursor {
  const c = value as Record<string, unknown> | null;
  return typeof c === 'object' && c !== null && typeof c.k === 'string' && typeof c.i === 'string';
}

/** One page of the user's workspaces by name ignoring case, and the cursor of the next. */
export async function listWorkspaces(
  db: D1Database,
  userId: string,
  limit: number,
  after: WorkspaceCursor | null,
): Promise<{ items: WorkspaceRow[]; next: WorkspaceCursor | null }> {
  const keyset = after ? 'AND (w.name_key > ?3 OR (w.name_key = ?3 AND w.id > ?4))' : '';
  const statement = db.prepare(
    `${SELECT} WHERE w.user_id = ?1 ${keyset} ORDER BY w.name_key, w.id LIMIT ?2`,
  );
  const rows = await (
    after ? statement.bind(userId, limit + 1, after.k, after.i) : statement.bind(userId, limit + 1)
  ).all<WorkspaceRow>();
  const items = rows.results.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    next: rows.results.length > limit && last ? { k: last.name_key, i: last.id } : null,
  };
}

/** What adding a link to a workspace did. */
export type AddMemberOutcome =
  { status: 'added' | 'moved' | 'unchanged'; position: number } | { status: 'no_link' };

/**
 * Adds one of the user's links to one of their workspaces, or moves it there:
 * without a position a new member goes to the bottom and an existing one
 * stays; with a position (1-based, past the end meaning the end) the link is
 * placed there and the others keep their order. Positions stay 1..n in one
 * transaction. The workspace must be the user's.
 */
export async function addMember(
  db: D1Database,
  userId: string,
  workspaceId: string,
  linkId: string,
  position?: number,
): Promise<AddMemberOutcome> {
  const [link, current, total] = await db.batch<{ v: number | null }>([
    db.prepare('SELECT 1 AS v FROM links WHERE id = ? AND user_id = ?').bind(linkId, userId),
    db
      .prepare('SELECT position AS v FROM workspace_links WHERE workspace_id = ? AND link_id = ?')
      .bind(workspaceId, linkId),
    db
      .prepare('SELECT COUNT(*) AS v FROM workspace_links WHERE workspace_id = ?')
      .bind(workspaceId),
  ]);
  if (!link?.results.length) return { status: 'no_link' };
  const was = current?.results[0]?.v ?? null;
  if (was !== null && position === undefined) return { status: 'unchanged', position: was };
  const others = (total?.results[0]?.v ?? 0) - (was === null ? 0 : 1);
  const target = Math.min(position ?? others + 1, others + 1);
  await db.batch([
    ...(was === null
      ? []
      : [
          db
            .prepare(
              'UPDATE workspace_links SET position = position - 1 WHERE workspace_id = ? AND position > ?',
            )
            .bind(workspaceId, was),
          db
            .prepare('DELETE FROM workspace_links WHERE workspace_id = ? AND link_id = ?')
            .bind(workspaceId, linkId),
        ]),
    db
      .prepare(
        'UPDATE workspace_links SET position = position + 1 WHERE workspace_id = ? AND position >= ?',
      )
      .bind(workspaceId, target),
    db
      .prepare('INSERT INTO workspace_links (workspace_id, link_id, position) VALUES (?, ?, ?)')
      .bind(workspaceId, linkId, target),
  ]);
  return { status: was === null ? 'added' : 'moved', position: target };
}

/** Removes a link from one workspace, closing the gap; false when it was not a member. */
export async function removeMember(
  db: D1Database,
  workspaceId: string,
  linkId: string,
): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE workspace_links SET position = position - 1 WHERE workspace_id = ?1 AND position > (
           SELECT position FROM workspace_links WHERE workspace_id = ?1 AND link_id = ?2)`,
      )
      .bind(workspaceId, linkId),
    db
      .prepare('DELETE FROM workspace_links WHERE workspace_id = ? AND link_id = ?')
      .bind(workspaceId, linkId),
  ]);
  return (results[1]?.meta.changes ?? 0) > 0;
}

/**
 * The statements that take a link out of every workspace it is in, closing
 * each gap; part of deleting the link.
 */
export function leaveAllWorkspaces(db: D1Database, linkId: string): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE workspace_links SET position = position - 1
         WHERE workspace_id IN (SELECT workspace_id FROM workspace_links WHERE link_id = ?1)
           AND position > (SELECT m.position FROM workspace_links m
                           WHERE m.workspace_id = workspace_links.workspace_id AND m.link_id = ?1)`,
      )
      .bind(linkId),
    db.prepare('DELETE FROM workspace_links WHERE link_id = ?').bind(linkId),
  ];
}

/** Where a page of a workspace's links ends. */
export interface MemberCursor {
  p: number;
}

export function isMemberCursor(value: unknown): value is MemberCursor {
  const c = value as Record<string, unknown> | null;
  return typeof c === 'object' && c !== null && Number.isInteger(c.p);
}

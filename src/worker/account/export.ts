/**
 * The export: the owner's whole library as one JSON document, streamed as it
 * is read, ending with "complete": true.
 */
import { now } from '../clock';
import type { AuthUser, Env } from '../env';
import { toFullView, type LinkRow } from '../links/store';

/** Links read per query while exporting. */
const PAGE = 100;

/** The address of an export content route of a link. */
function contentUrl(origin: string, id: string, kind: 'snapshot' | 'reader'): string {
  return `${origin}/api/v1/export/links/${encodeURIComponent(id)}/${kind}`;
}

/** Whether a link has a reader view to serve: a PDF's text, or a page's non-empty reader view. */
export function hasReader(row: LinkRow): boolean {
  return Boolean(row.has_snapshot) && (row.content_kind === 'pdf' || !row.reader_empty);
}

/** A link's export entry: its API representation and the URLs of its stored content. */
function linkEntry(origin: string, row: LinkRow): Record<string, unknown> {
  return {
    ...toFullView(row),
    snapshot_url: row.has_snapshot ? contentUrl(origin, row.id, 'snapshot') : null,
    reader_url: hasReader(row) ? contentUrl(origin, row.id, 'reader') : null,
  };
}

/** The user's links, page by page in id order, each as its export entry. */
async function* links(
  env: Env,
  userId: string,
  origin: string,
): AsyncGenerator<Record<string, unknown>> {
  let after = '';
  for (;;) {
    const page = await env.DB.prepare(
      `-- export links page
       SELECT * FROM link_views WHERE user_id = ? AND id > ? ORDER BY id LIMIT ?`,
    )
      .bind(userId, after, PAGE)
      .all<LinkRow>();
    for (const row of page.results) yield linkEntry(origin, row);
    if (page.results.length < PAGE) return;
    after = page.results.at(-1)!.id;
  }
}

/** The user's workspaces, each with the ids of its links in their manual order. */
async function workspaces(db: D1Database, userId: string) {
  const [rows, members] = await db.batch<Record<string, string>>([
    db
      .prepare(
        'SELECT id, name, description, note FROM workspaces WHERE user_id = ? ORDER BY name_key, id',
      )
      .bind(userId),
    db
      .prepare(
        `SELECT wl.workspace_id, wl.link_id FROM workspace_links wl
         JOIN workspaces w ON w.id = wl.workspace_id
         WHERE w.user_id = ? ORDER BY wl.workspace_id, wl.position`,
      )
      .bind(userId),
  ]);
  const byWorkspace = new Map<string, string[]>();
  for (const m of members?.results ?? []) {
    const list = byWorkspace.get(m.workspace_id!) ?? [];
    list.push(m.link_id!);
    byWorkspace.set(m.workspace_id!, list);
  }
  return (rows?.results ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    note: w.note,
    link_ids: byWorkspace.get(w.id!) ?? [],
  }));
}

/** The user's topics, each with its parent and its number of links, or tags with their number of links. */
async function vocabulary(db: D1Database, userId: string, kind: 'topics' | 'tags') {
  const columns =
    kind === 'topics'
      ? 'v.parent_id, (SELECT COUNT(*) FROM links l WHERE l.topic_id = v.id)'
      : '(SELECT COUNT(*) FROM link_tags lt WHERE lt.tag_id = v.id)';
  const rows = await db
    .prepare(
      `SELECT v.id, v.name, ${columns} AS link_count FROM ${kind} v WHERE v.user_id = ? ORDER BY v.name, v.id`,
    )
    .bind(userId)
    .all<{ id: string; name: string; parent_id?: string | null; link_count: number }>();
  return rows.results;
}

/** The document's text, piece by piece: the header, every link, then the rest and "complete". */
async function* pieces(
  env: Env,
  user: AuthUser,
  at: string,
  origin: string,
): AsyncGenerator<string> {
  const head = {
    format: 'alexandria-export',
    version: 1,
    exported_at: at,
    user: { email: user.email, name: user.name },
  };
  yield `${JSON.stringify(head).slice(0, -1)},"links":[`;
  let first = true;
  for await (const entry of links(env, user.id, origin)) {
    yield `${first ? '' : ','}${JSON.stringify(entry)}`;
    first = false;
  }
  yield `],"workspaces":${JSON.stringify(await workspaces(env.DB, user.id))}`;
  yield `,"topics":${JSON.stringify(await vocabulary(env.DB, user.id, 'topics'))}`;
  yield `,"tags":${JSON.stringify(await vocabulary(env.DB, user.id, 'tags'))}`;
  yield ',"complete":true}';
}

/**
 * The export as a download: the user's email and name, every link (its API
 * representation with its content URLs), workspaces, topics and tags, and
 * finally "complete": true. It is sent as it is read; a failure part-way
 * errors the stream, so a cut-off download never ends as a complete export.
 * Nothing else of the user is in it: no settings, key, token, session or import.
 */
export function exportResponse(env: Env, user: AuthUser, origin: string): Response {
  const at = now().toISOString();
  const encoder = new TextEncoder();
  const source = pieces(env, user, at, origin);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await source.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(value));
      } catch (err) {
        console.error('the export failed part-way', err);
        controller.error(err);
      }
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="alexandria-export-${at.slice(0, 10)}.json"`,
    },
  });
}

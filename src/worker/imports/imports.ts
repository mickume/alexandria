/** Imports: adding a file's URL lines to the library, and their report. */
import { now } from '../clock';
import { LIBRARY_LIMIT } from '../links/store';
import { normalizeUrl } from '../links/normalize';
import type { ImportLine } from './parse';

/** How many of each kind of URL line an import had. */
export interface ImportCounts {
  url_lines: number;
  added: number;
  duplicates: number;
  invalid: number;
  not_imported: number;
}

/** The workspace an import added its links to, and how many joined it. */
export interface ImportWorkspace {
  id: string;
  name: string;
  /** The file's links that became members; the others were members already. */
  added: number;
}

/** An import's report, as the API returns it. */
export interface ImportReport {
  id: string;
  created_at: string;
  counts: ImportCounts;
  invalid: { line: number; text: string }[];
  duplicates: { line: number; url: string }[];
  stopped_at_limit: { line: number } | null;
  /** The workspace the links were added to, or null (none chosen, or deleted since). */
  workspace: ImportWorkspace | null;
}

/** A new URL the import adds: its line, normalised URL and the word it came from. */
interface Addition {
  line: number;
  url: string;
  original: string;
}

/** What an import will do with each line, before anything is written. */
interface Plan {
  additions: Addition[];
  invalid: ImportReport['invalid'];
  duplicates: ImportReport['duplicates'];
  stoppedLine: number | null;
  notImported: number;
}

/** The normalised URLs among `urls` that the user's library already holds. */
async function existingUrls(db: D1Database, userId: string, urls: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < urls.length; i += 500) {
    const rows = await db
      .prepare(
        'SELECT url FROM links WHERE user_id = ? AND url IN (SELECT value FROM json_each(?))',
      )
      .bind(userId, JSON.stringify(urls.slice(i, i + 500)))
      .all<{ url: string }>();
    for (const r of rows.results) found.add(r.url);
  }
  return found;
}

/**
 * Sorts the lines in file order into invalid lines, duplicates (of the
 * library or of an earlier line) and additions, stopping at the first new URL
 * the library has no room for: that line and every later one is not imported.
 */
async function plan(db: D1Database, userId: string, lines: ImportLine[]): Promise<Plan> {
  const normalized = lines.map((l) => ({ ...l, result: normalizeUrl(l.url) }));
  const candidates = normalized.flatMap((l) => (l.result.ok ? [l.result.url] : []));
  const existing = await existingUrls(db, userId, [...new Set(candidates)]);
  const have = await db
    .prepare('SELECT COUNT(*) AS n FROM links WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>();
  let room = LIBRARY_LIMIT - (have?.n ?? 0);
  const p: Plan = { additions: [], invalid: [], duplicates: [], stoppedLine: null, notImported: 0 };
  const seen = new Set<string>();
  for (const [i, l] of normalized.entries()) {
    if (!l.result.ok) {
      p.invalid.push({ line: l.line, text: l.url });
    } else if (existing.has(l.result.url) || seen.has(l.result.url)) {
      p.duplicates.push({ line: l.line, url: l.result.url });
    } else if (room <= 0) {
      p.stoppedLine = l.line;
      p.notImported = normalized.length - i;
      break;
    } else {
      seen.add(l.result.url);
      room -= 1;
      p.additions.push({ line: l.line, url: l.result.url, original: l.url });
    }
  }
  return p;
}

/**
 * The statement that adds one new URL as a pending link, last used `at`:
 * nothing when the user already has the URL (it is then a duplicate, never
 * boosted) or the library is full.
 */
function insertStatement(
  db: D1Database,
  userId: string,
  a: Addition,
  id: string,
  added: string,
  at: string,
) {
  return db
    .prepare(
      `INSERT INTO links (id, user_id, url, original_url, host, title, state, added_at, last_used_at,
         updated_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?5, 'pending', ?6, ?7, ?6
       WHERE (SELECT COUNT(*) FROM links WHERE user_id = ?2) < ?8
       ON CONFLICT (user_id, url) DO NOTHING
       RETURNING id`,
    )
    .bind(id, userId, a.url, a.original, new URL(a.url).host, added, at, LIBRARY_LIMIT);
}

/**
 * The last-used time of an import's first line, in milliseconds: the import
 * time, or later when a link was used so shortly before it that the import's
 * last line, a millisecond per line below the first, would fall under it.
 */
async function lastUsedBase(db: D1Database, userId: string, t: number, lastLine: number) {
  const row = await db
    .prepare('SELECT MAX(last_used_at) AS latest FROM links WHERE user_id = ?')
    .bind(userId)
    .first<{ latest: string | null }>();
  const latest = row?.latest ? Date.parse(row.latest) : 0;
  return Math.max(t, latest + 1 + (lastLine - 1));
}

/**
 * Adds the links of `urls` (the user's, by normalised URL) to the bottom of
 * the workspace in the given order, leaving those already in it where they
 * are; returns how many joined. Nothing is added once the workspace is gone.
 */
async function addToWorkspace(
  db: D1Database,
  userId: string,
  workspaceId: string,
  urls: string[],
): Promise<number> {
  let joined = 0;
  for (let i = 0; i < urls.length; i += 500) {
    const results = await db.batch(
      urls.slice(i, i + 500).map((url) =>
        db
          .prepare(
            `INSERT INTO workspace_links (workspace_id, link_id, position)
             SELECT ?1, l.id, (SELECT COUNT(*) FROM workspace_links WHERE workspace_id = ?1) + 1
             FROM links l
             WHERE l.user_id = ?2 AND l.url = ?3
               AND EXISTS (SELECT 1 FROM workspaces WHERE id = ?1 AND user_id = ?2)
             ON CONFLICT (workspace_id, link_id) DO NOTHING`,
          )
          .bind(workspaceId, userId, url),
      ),
    );
    joined += results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }
  return joined;
}

/**
 * Adds an import's lines to the user's library and records the import:
 * every new URL as a pending link, last used from the import time downwards
 * one millisecond per line, so that the stream lists them in file order;
 * duplicates and invalid lines reported, nothing boosted; the library limit
 * stopping the import at a line. With a workspace, every link of the file in
 * the library (added or a duplicate) joins it, in file order. The links are
 * not sent to the fetch worker here: the import's dispatcher sends them
 * through the throttle.
 */
export async function importLines(
  db: D1Database,
  userId: string,
  lines: ImportLine[],
  workspace: { id: string; name: string } | null = null,
): Promise<ImportReport> {
  const p = await plan(db, userId, lines);
  const t = now();
  const createdAt = t.toISOString();
  const base = await lastUsedBase(db, userId, t.getTime(), p.additions.at(-1)?.line ?? 1);
  const id = crypto.randomUUID();
  const added: { line: number; id: string }[] = [];
  for (let i = 0; i < p.additions.length; i += 500) {
    const chunk = p.additions.slice(i, i + 500);
    const ids = chunk.map(() => crypto.randomUUID());
    const results = await db.batch<{ id: string }>(
      chunk.map((a, k) =>
        insertStatement(
          db,
          userId,
          a,
          ids[k]!,
          createdAt,
          new Date(base - (a.line - 1)).toISOString(),
        ),
      ),
    );
    results.forEach((r, k) => {
      const a = chunk[k]!;
      if (r.results.length > 0) added.push({ line: a.line, id: ids[k]! });
      // Added meanwhile by another request: a duplicate after all.
      else p.duplicates.push({ line: a.line, url: a.url });
    });
  }
  p.duplicates.sort((a, b) => a.line - b.line);
  let joined = 0;
  if (workspace) {
    const inFileOrder = [
      ...p.additions.map((a) => ({ line: a.line, url: a.url })),
      ...p.duplicates,
    ].sort((a, b) => a.line - b.line);
    joined = await addToWorkspace(db, userId, workspace.id, [
      ...new Set(inFileOrder.map((l) => l.url)),
    ]);
  }
  const report: ImportReport = {
    id,
    created_at: createdAt,
    counts: {
      url_lines: lines.length,
      added: added.length,
      duplicates: p.duplicates.length,
      invalid: p.invalid.length,
      not_imported: p.notImported,
    },
    invalid: p.invalid,
    duplicates: p.duplicates,
    stopped_at_limit: p.stoppedLine === null ? null : { line: p.stoppedLine },
    workspace: workspace && { ...workspace, added: joined },
  };
  await recordImport(db, userId, report, added);
  return report;
}

/** Stores the import's report and its added links, in line order. */
async function recordImport(
  db: D1Database,
  userId: string,
  report: ImportReport,
  added: { line: number; id: string }[],
): Promise<void> {
  const c = report.counts;
  await db
    .prepare(
      `INSERT INTO imports (id, user_id, created_at, url_lines, added, duplicates, invalid,
         not_imported, invalid_lines, duplicate_lines, stopped_line, workspace_id, workspace_added)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      report.id,
      userId,
      report.created_at,
      c.url_lines,
      c.added,
      c.duplicates,
      c.invalid,
      c.not_imported,
      JSON.stringify(report.invalid),
      JSON.stringify(report.duplicates),
      report.stopped_at_limit?.line ?? null,
      report.workspace?.id ?? null,
      report.workspace?.added ?? null,
    )
    .run();
  for (let i = 0; i < added.length; i += 500) {
    await db.batch(
      added
        .slice(i, i + 500)
        .map((a) =>
          db
            .prepare('INSERT INTO import_links (import_id, link_id, line) VALUES (?, ?, ?)')
            .bind(report.id, a.id, a.line),
        ),
    );
  }
}

/** The stored row of an import. */
interface ImportRow {
  id: string;
  created_at: string;
  url_lines: number;
  added: number;
  duplicates: number;
  invalid: number;
  not_imported: number;
  invalid_lines: string;
  duplicate_lines: string;
  stopped_line: number | null;
  workspace_id: string | null;
  workspace_added: number | null;
  /** The workspace's current name; null once it is deleted. */
  workspace_name: string | null;
}

/** One of the user's imports' reports, or null when the user has no such import. */
export async function getImport(
  db: D1Database,
  userId: string,
  id: string,
): Promise<ImportReport | null> {
  const row = await db
    .prepare(
      `SELECT i.*, w.name AS workspace_name FROM imports i
       LEFT JOIN workspaces w ON w.id = i.workspace_id AND w.user_id = i.user_id
       WHERE i.id = ? AND i.user_id = ?`,
    )
    .bind(id, userId)
    .first<ImportRow>();
  if (!row) return null;
  return {
    id: row.id,
    created_at: row.created_at,
    counts: {
      url_lines: row.url_lines,
      added: row.added,
      duplicates: row.duplicates,
      invalid: row.invalid,
      not_imported: row.not_imported,
    },
    invalid: JSON.parse(row.invalid_lines) as ImportReport['invalid'],
    duplicates: JSON.parse(row.duplicate_lines) as ImportReport['duplicates'],
    stopped_at_limit: row.stopped_line === null ? null : { line: row.stopped_line },
    workspace:
      row.workspace_id && row.workspace_name !== null
        ? { id: row.workspace_id, name: row.workspace_name, added: row.workspace_added ?? 0 }
        : null,
  };
}

/** Where an import's added links stand. */
export interface ImportProgress {
  /** Not yet sent to the fetch worker. */
  waiting: number;
  /** Sent, and still pending. */
  in_progress: number;
  /** Fetched (or given up on): no longer pending. */
  done: number;
  /** Done and enriched. */
  enriched: number;
}

/** The progress of one import's links still in the library. */
export async function importProgress(db: D1Database, importId: string): Promise<ImportProgress> {
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(il.dispatched_at IS NULL), 0) AS waiting,
         COALESCE(SUM(il.dispatched_at IS NOT NULL AND l.state = 'pending'), 0) AS in_progress,
         COALESCE(SUM(l.state <> 'pending'), 0) AS done,
         COALESCE(SUM(l.state <> 'pending' AND l.enrichment_status = 'enriched'), 0) AS enriched
       FROM import_links il JOIN links l ON l.id = il.link_id
       WHERE il.import_id = ?`,
    )
    .bind(importId)
    .first<ImportProgress>();
  return row ?? { waiting: 0, in_progress: 0, done: 0, enriched: 0 };
}

/** The report as the downloadable text file says it. */
export function reportText(report: ImportReport): string {
  const c = report.counts;
  const out = [
    `Alexandria import of ${report.created_at.slice(0, 10)}`,
    '',
    `url lines: ${c.url_lines}`,
    `added: ${c.added}`,
    `duplicates: ${c.duplicates}`,
    `invalid: ${c.invalid}`,
    `not imported: ${c.not_imported}`,
  ];
  if (report.workspace) {
    out.push(`workspace: ${report.workspace.name} (${report.workspace.added} links added to it)`);
  }
  if (report.stopped_at_limit) {
    out.push(
      '',
      `library full (20,000 links): stopped at line ${report.stopped_at_limit.line}, ${c.not_imported} lines not imported`,
    );
  }
  if (report.invalid.length > 0) {
    out.push('', 'Invalid lines:', ...report.invalid.map((l) => `line ${l.line}: ${l.text}`));
  }
  if (report.duplicates.length > 0) {
    out.push(
      '',
      'Duplicates:',
      ...report.duplicates.map((d) => `line ${d.line}: duplicate of ${d.url}`),
    );
  }
  return `${out.join('\n')}\n`;
}

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

/** An import's report, as the API returns it. */
export interface ImportReport {
  id: string;
  created_at: string;
  counts: ImportCounts;
  invalid: { line: number; text: string }[];
  duplicates: { line: number; url: string }[];
  stopped_at_limit: { line: number } | null;
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
 * Adds an import's lines to the user's library and records the import:
 * every new URL as a pending link, last used from the import time downwards
 * one millisecond per line, so that the stream lists them in file order;
 * duplicates and invalid lines reported, nothing boosted; the library limit
 * stopping the import at a line. The links are not sent to the fetch worker
 * here: the import's dispatcher sends them through the throttle.
 */
export async function importLines(
  db: D1Database,
  userId: string,
  lines: ImportLine[],
): Promise<ImportReport> {
  const p = await plan(db, userId, lines);
  const t = now();
  const createdAt = t.toISOString();
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
          new Date(t.getTime() - (a.line - 1)).toISOString(),
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
         not_imported, invalid_lines, duplicate_lines, stopped_line)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
}

/** One of the user's imports' reports, or null when the user has no such import. */
export async function getImport(
  db: D1Database,
  userId: string,
  id: string,
): Promise<ImportReport | null> {
  const row = await db
    .prepare('SELECT * FROM imports WHERE id = ? AND user_id = ?')
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
  };
}

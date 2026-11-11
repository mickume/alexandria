/**
 * Title rules: for the pages of some hosts, the parts of the title that are
 * the site's own name rather than the page's, such as GitHub's "GitHub - " and
 * " · GitHub", and the rewrites that make a long title short, such as an
 * issue's "· Issue #1 · owner/repo" as "· owner/repo#1". The rules live in title-rules.json, which is bundled with the
 * Worker, so a change to them deploys like any change to the code. They clean
 * every title a fetch stores, and, once after each change to them, the titles
 * already stored.
 */
import { z } from 'zod';
import { sha256Hex } from '../auth/crypto';
import { now } from '../clock';
import type { Env } from '../env';
import { ownerEdited } from '../links/store';
import rulesFile from './title-rules.json';

const rulesSchema = z.object({
  rules: z.array(
    z
      .object({
        /** What the rule is for; documentation only. */
        description: z.string().optional(),
        /** The hosts whose pages the rule applies to; each also covers its subdomains. */
        hosts: z.array(z.string().min(1)).min(1),
        /** Regular expressions of which the page's path must match one; any path without them. */
        paths: z.array(z.string().min(1)).min(1).optional(),
        /** Regular expressions (JavaScript syntax) whose every match is removed from the title. */
        remove: z.array(z.string().min(1)).optional(),
        /** Regular expressions whose every match is replaced, `$1` and the like naming its groups. */
        replace: z
          .array(z.strictObject({ pattern: z.string().min(1), with: z.string() }))
          .optional(),
      })
      .refine((rule) => (rule.remove?.length ?? 0) + (rule.replace?.length ?? 0) > 0, {
        message: 'a rule removes or replaces something',
      }),
  ),
});

/** One rule, ready to apply: its removals as replacements with nothing, first. */
export interface TitleRule {
  hosts: string[];
  /** The page's path must match one of these; null for any path. */
  paths: RegExp[] | null;
  edits: { pattern: RegExp; replacement: string }[];
}

/**
 * The rules of a rules file's content, compiled. Throws on a file that does
 * not have the expected shape or holds an invalid regular expression, so that
 * a broken rules file fails the Worker's start, and with it the deploy, rather
 * than titles.
 */
export function compileTitleRules(file: unknown): TitleRule[] {
  return rulesSchema.parse(file).rules.map((rule) => ({
    hosts: rule.hosts.map((h) => h.toLowerCase()),
    paths: rule.paths?.map((pattern) => new RegExp(pattern, 'u')) ?? null,
    edits: [
      ...(rule.remove ?? []).map((pattern) => ({
        pattern: new RegExp(pattern, 'gu'),
        replacement: '',
      })),
      ...(rule.replace ?? []).map((r) => ({
        pattern: new RegExp(r.pattern, 'gu'),
        replacement: r.with,
      })),
    ],
  }));
}

/** The rules of title-rules.json. */
const TITLE_RULES = compileTitleRules(rulesFile);

/**
 * `title` cleaned by the rules that apply to `url`: those whose hosts cover
 * its host (the host itself or a subdomain of it) and, for a rule with paths,
 * one of whose paths matches its path. Each rule, in order, removes every
 * match of its `remove` patterns and then replaces every match of its
 * `replace` patterns; then runs of whitespace are made one space and the ends
 * trimmed. A title the rules would leave empty is kept as it is.
 */
export function cleanTitle(title: string, url: string, rules: TitleRule[] = TITLE_RULES): string {
  let host: string;
  let path: string;
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname;
  } catch {
    return title;
  }
  let cleaned = title;
  let matched = false;
  for (const rule of rules) {
    if (!rule.hosts.some((h) => host === h || host.endsWith(`.${h}`))) continue;
    if (rule.paths && !rule.paths.some((p) => p.test(path))) continue;
    matched = true;
    for (const edit of rule.edits) cleaned = cleaned.replace(edit.pattern, edit.replacement);
  }
  if (!matched) return title;
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned || title;
}

/** How many links the backfill reads at a time. */
const PAGE_SIZE = 500;

/**
 * Cleans the titles already stored, once for each version of the rules: when
 * the hash of the rules file differs from the one recorded in
 * title_rules_state, every link's title is cleaned (except a title the owner
 * edited), the links whose title changes are marked as changed, and the new
 * hash is recorded. A run that fails records nothing, and the next one starts
 * again; cleaning a title twice changes nothing more. Returns how many titles
 * changed.
 */
export async function applyTitleRules(env: Env, file: unknown = rulesFile): Promise<number> {
  const hash = await sha256Hex(JSON.stringify(file));
  const applied = await env.DB.prepare(
    'SELECT rules_hash FROM title_rules_state WHERE id = 1',
  ).first<{ rules_hash: string }>();
  if (applied?.rules_hash === hash) return 0;
  const rules = compileTitleRules(file);
  let changed = 0;
  let after = '';
  for (;;) {
    const { results } = await env.DB.prepare(
      `SELECT id, title, url, final_url FROM links
       WHERE id > ? AND NOT ${ownerEdited('title')}
       ORDER BY id LIMIT ?`,
    )
      .bind(after, PAGE_SIZE)
      .all<{ id: string; title: string; url: string; final_url: string | null }>();
    const at = now().toISOString();
    const updates: D1PreparedStatement[] = [];
    for (const row of results) {
      const title = cleanTitle(row.title, row.final_url ?? row.url, rules);
      if (title === row.title) continue;
      // Written only over the title read, so a fetch or an edit meanwhile wins.
      updates.push(
        env.DB.prepare(
          `UPDATE links SET title = ?1, updated_at = ?2
           WHERE id = ?3 AND title = ?4 AND NOT ${ownerEdited('title')}`,
        ).bind(title, at, row.id, row.title),
      );
    }
    if (updates.length > 0) {
      await env.DB.batch(updates);
      changed += updates.length;
    }
    const last = results.at(-1);
    if (!last || results.length < PAGE_SIZE) break;
    after = last.id;
  }
  await env.DB.prepare(
    `INSERT INTO title_rules_state (id, rules_hash, applied_at) VALUES (1, ?1, ?2)
     ON CONFLICT (id) DO UPDATE SET rules_hash = ?1, applied_at = ?2`,
  )
    .bind(hash, now().toISOString())
    .run();
  return changed;
}

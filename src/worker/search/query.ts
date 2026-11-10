/** The search query language: free words and prefix filters, and what the filters select. */
import { nameKey } from '../workspaces/store';

/** The longest query, in characters. */
export const QUERY_MAX = 200;

/** The prefix filters, by name. */
export const FILTER_NAMES = ['tag', 'topic', 'host', 'state', 'in', 'is'] as const;
export type FilterName = (typeof FILTER_NAMES)[number];

/** The filters of a query, each with every value given for it, in order. */
export type Filters = Partial<Record<FilterName, string[]>>;

/** The values `state:` accepts. */
export const STATE_VALUES = ['pending', 'active', 'unreachable', 'expired', 'archived', 'any'];
/** The values `is:` accepts. */
export const IS_VALUES = ['pinned', 'dead'];

/**
 * Why a filter's value is refused, or null when it is accepted: `state:` and
 * `is:` take only their own values.
 */
export function refusal(name: FilterName, value: string): string | null {
  const allowed = name === 'state' ? STATE_VALUES : name === 'is' ? IS_VALUES : null;
  return allowed && !allowed.includes(value) ? `${name}: takes ${allowed.join(', ')}` : null;
}

/** A parsed query, or why it was refused. */
export type ParsedQuery =
  | { ok: true; words: string[]; filters: Filters }
  | { ok: false; error: 'query_too_long' | 'invalid_filter'; message: string };

/**
 * The terms of a query: split on whitespace, except inside a double-quoted
 * phrase. A quote that is never closed is an ordinary character.
 */
function terms(q: string): string[] {
  return q.match(/[^\s"]*"[^"]*"\S*|\S+/g) ?? [];
}

/** A filter's name and value, or null when the term is a free word. */
function asFilter(term: string): { name: FilterName; value: string } | null {
  const m = /^([a-z]+):(.*)$/is.exec(term);
  if (!m) return null;
  const name = m[1]!.toLowerCase() as FilterName;
  if (!FILTER_NAMES.includes(name)) return null;
  const raw = m[2]!;
  let value: string;
  if (/^"[^"]*"$/.test(raw)) value = raw.slice(1, -1);
  else if (raw.includes('"')) return null;
  else value = raw;
  if (name === 'state' || name === 'is') return { name, value: value.toLowerCase() };
  // An empty tag:, topic:, host: or in: names nothing: it is a free word.
  return value.trim() ? { name, value } : null;
}

/**
 * Splits a query into free words and prefix filters: `tag:`, `topic:`,
 * `host:`, `state:`, `in:` and `is:`, case-insensitive, each followed by one
 * word or a double-quoted phrase. Every other term, another `word:value` and
 * an unclosed quote included, is a free word. Refuses a query over `max`
 * characters (200 unless given), and a `state:` or `is:` value the filter does not take;
 * with `prose`, for a question written as a sentence ("what I mean is: …"),
 * such a term is a free word instead.
 */
export function parseQuery(q: string, max = QUERY_MAX, { prose = false } = {}): ParsedQuery {
  if (q.length > max) {
    return {
      ok: false,
      error: 'query_too_long',
      message: `a query of at most ${max} characters`,
    };
  }
  const words: string[] = [];
  const filters: Filters = {};
  for (const term of terms(q)) {
    const filter = asFilter(term);
    if (!filter) {
      words.push(term);
      continue;
    }
    const refused = refusal(filter.name, filter.value);
    if (refused && prose) {
      words.push(term);
      continue;
    }
    if (refused) {
      return { ok: false, error: 'invalid_filter', message: `${term} is not a filter: ${refused}` };
    }
    (filters[filter.name] ??= []).push(filter.value);
  }
  return { ok: true, words, filters };
}

/** Conditions on the links (aliased l) a search or list is restricted to, with their parameters. */
export interface Conditions {
  sql: string[];
  params: unknown[];
}

/** The conditions as SQL to append to a WHERE clause that already has a condition. */
export function andAll(where: Conditions): string {
  return where.sql.map((c) => `AND ${c}`).join(' ');
}

/**
 * The SQL condition that the topic aliased `d` is the topic `root` (the SQL of
 * its id) or beneath it: the tree has three levels, so at most two down.
 */
export function inSubtree(d: string, root: string): string {
  return `(${d}.id = ${root} OR ${d}.parent_id = ${root}
    OR ${d}.parent_id IN (SELECT c.id FROM topics c WHERE c.parent_id = ${root}))`;
}

/**
 * The conditions that select the links satisfying every filter: a tag with
 * that name, a topic with that name or a topic beneath it, and the workspace
 * with that name, ignoring case; a
 * host equal to the value or ending in '.' and the value; pinned; dead.
 * Expired links are left out unless a `state:` filter is given: `expired`
 * selects only them, `any` every state, another value that state.
 */
export function filterConditions(filters: Filters): Conditions {
  const sql: string[] = [];
  const params: unknown[] = [];
  for (const tag of filters.tag ?? []) {
    sql.push(`EXISTS (SELECT 1 FROM link_tags lt JOIN tags t ON t.id = lt.tag_id
      WHERE lt.link_id = l.id AND t.name = ? COLLATE NOCASE)`);
    params.push(tag);
  }
  for (const topic of filters.topic ?? []) {
    // The named topic and the topics beneath it, at most two levels down.
    sql.push(
      `l.topic_id IN (SELECT d.id FROM topics t JOIN topics d ON ${inSubtree('d', 't.id')}
        WHERE t.user_id = l.user_id AND t.name = ? COLLATE NOCASE)`,
    );
    params.push(topic);
  }
  for (const host of filters.host ?? []) {
    const value = host.toLowerCase();
    sql.push('(lower(l.host) = ? OR substr(lower(l.host), -?) = ?)');
    params.push(value, value.length + 1, `.${value}`);
  }
  for (const name of filters.in ?? []) {
    sql.push(`EXISTS (SELECT 1 FROM workspace_links wl JOIN workspaces w ON w.id = wl.workspace_id
      WHERE wl.link_id = l.id AND w.user_id = l.user_id AND w.name_key = ?)`);
    params.push(nameKey(name));
  }
  for (const value of filters.is ?? []) {
    sql.push(value === 'pinned' ? 'l.pin_position IS NOT NULL' : 'l.dead_since IS NOT NULL');
  }
  const states = filters.state ?? [];
  if (states.length === 0) sql.push("l.state <> 'expired'");
  for (const state of states.filter((s) => s !== 'any')) {
    sql.push('l.state = ?');
    params.push(state);
  }
  return { sql, params };
}

/**
 * The filters of the link list's query parameters, which have the meaning of
 * the prefix filters: `values(name)` gives every value of a parameter. Empty
 * tag, topic, host and in values are ignored; a refused state or is value is
 * named with its parameter.
 */
export function filtersFromParams(
  values: (name: FilterName) => string[] | undefined,
): { ok: true; filters: Filters } | { ok: false; field: FilterName; message: string } {
  const filters: Filters = {};
  for (const name of FILTER_NAMES) {
    for (const raw of values(name) ?? []) {
      const value = name === 'state' || name === 'is' ? raw.toLowerCase() : raw;
      const refused = refusal(name, value);
      if (refused)
        return { ok: false, field: name, message: `${name}=${raw} is not a filter: ${refused}` };
      if (value.trim()) (filters[name] ??= []).push(value);
    }
  }
  return { ok: true, filters };
}

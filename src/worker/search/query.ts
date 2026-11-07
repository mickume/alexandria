/** The search query language: free words and prefix filters. */

/** The longest query, in characters. */
export const QUERY_MAX = 200;

/** The prefix filters, by name. */
export const FILTER_NAMES = ['tag', 'topic', 'host', 'state', 'in', 'is'] as const;
export type FilterName = (typeof FILTER_NAMES)[number];

/** The filters of a query, each with every value given for it, in order. */
export type Filters = Partial<Record<FilterName, string[]>>;

/** The values `state:` accepts. */
export const STATE_VALUES = ['pending', 'active', 'unreachable', 'dormant', 'archived', 'any'];
/** The values `is:` accepts. */
export const IS_VALUES = ['pinned', 'dead'];

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
 * an unclosed quote included, is a free word. Refuses a query over 200
 * characters, and a `state:` or `is:` value the filter does not take.
 */
export function parseQuery(q: string): ParsedQuery {
  if (q.length > QUERY_MAX) {
    return {
      ok: false,
      error: 'query_too_long',
      message: `a query of at most ${QUERY_MAX} characters`,
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
    const allowed =
      filter.name === 'state' ? STATE_VALUES : filter.name === 'is' ? IS_VALUES : null;
    if (allowed && !allowed.includes(filter.value)) {
      return {
        ok: false,
        error: 'invalid_filter',
        message: `${term} is not a filter: ${filter.name}: takes ${allowed.join(', ')}`,
      };
    }
    (filters[filter.name] ??= []).push(filter.value);
  }
  return { ok: true, words, filters };
}

/** An enrichment, normalised: what is stored on a link. */
export interface Enrichment {
  summary: string;
  tags: string[];
  topic: string;
}

/** The most page text sent to the provider, in characters. */
export const MAX_PROMPT_TEXT = 20_000;
/** The most words a summary keeps. */
export const MAX_SUMMARY_WORDS = 60;
/**
 * The fewest and the most tags an enrichment keeps. A low floor lets a page
 * that fits one or two existing tags keep just those, rather than pushing the
 * model to invent more and scatter the vocabulary.
 */
export const MIN_TAGS = 1;
export const MAX_TAGS = 5;

/** A tag name as it is stored: lower-case, hyphens for spaces, only a-z, 0-9 and '-'. */
export function normalizeTag(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/** The key two names are compared by: case ignored, spaces read as hyphens. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-');
}

/** Words whose plural-looking form names something else, so they are never varied by number. */
const NOT_PLURALS = new Set(['news', 'windows', 'canvas', 'ios', 'macos', 'series', 'species']);
/** The shortest word that is varied by number, and the shortest variant kept. */
const MIN_VARIED = 3;

/** A word's likely singular and plural forms, besides itself. */
function numberVariants(word: string): string[] {
  if (word.length < MIN_VARIED || NOT_PLURALS.has(word)) return [];
  const out: string[] = [];
  if (word.endsWith('ies')) out.push(`${word.slice(0, -3)}y`);
  if (/(s|x|z|ch|sh)es$/.test(word)) out.push(word.slice(0, -2));
  if (word.endsWith('s') && !word.endsWith('ss')) out.push(word.slice(0, -1));
  if (/[^aeiou]y$/.test(word)) out.push(`${word.slice(0, -1)}ies`);
  out.push(/(s|x|z|ch|sh)$/.test(word) ? `${word}es` : `${word}s`);
  return out.filter((v) => v.length >= MIN_VARIED && !NOT_PLURALS.has(v));
}

/**
 * The keys a name is close enough to share a tag or topic with: its own key
 * first (nameKey with the hyphens dropped, so "web-dev" meets "webdev"), then
 * the same with its last word made singular or plural ("databases" meets
 * "database", "library" meets "libraries"). Two names are near when the own
 * key of one is among the keys of the other.
 */
export function nearKeys(name: string): string[] {
  const words = nameKey(name).split('-').filter(Boolean);
  const last = words.pop() ?? '';
  const head = words.join('');
  return [head + last, ...numberVariants(last).map((v) => head + v)];
}

/** Tags normalised, without empties or repeats, in their order. */
export function normalizeTags(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const tag = normalizeTag(name);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/**
 * Normalises a provider's raw result: tags as normalizeTags makes them, the
 * first 5 kept; the summary cut to its first 60 words. Returns null for a
 * result that is unusable: not the right shape, no tags, or an empty summary
 * or topic.
 */
export function normalizeResult(raw: unknown): Enrichment | null {
  if (!raw || typeof raw !== 'object') return null;
  const { summary, tags, topic } = raw as Record<string, unknown>;
  if (typeof summary !== 'string' || typeof topic !== 'string' || !Array.isArray(tags)) return null;
  const words = summary.trim().split(/\s+/).filter(Boolean);
  const cleanSummary =
    words.length > MAX_SUMMARY_WORDS ? words.slice(0, MAX_SUMMARY_WORDS).join(' ') : summary.trim();
  const cleanTags = normalizeTags(tags.filter((t): t is string => typeof t === 'string')).slice(
    0,
    MAX_TAGS,
  );
  const cleanTopic = topic.replace(/\s+/g, ' ').trim();
  if (!cleanSummary || !cleanTopic || cleanTags.length < MIN_TAGS) return null;
  return { summary: cleanSummary, tags: cleanTags, topic: cleanTopic };
}

/** A topic or tag name with the number of the user's links that carry it. */
export interface VocabularyEntry {
  name: string;
  count: number;
}

/** What the request about one link is built from. */
export interface PromptInput {
  title: string;
  host: string;
  /** The reader-view text, or '' when the reader view is empty. */
  text: string;
  description: string | null;
  /** The topics' paths, such as 'Software engineering > Testing'. */
  topics: string[];
  tags: VocabularyEntry[];
}

/** Tags as the request lists them: each name with its link count. */
function listEntries(entries: VocabularyEntry[]): string {
  return entries.length ? entries.map((e) => `${e.name} (${e.count})`).join(', ') : '(none)';
}

/**
 * The request sent to the provider: instructions, the link's title and host,
 * the user's topic paths, one per line, and tag names with how many links
 * carry each, and the first 20,000 characters of the page
 * text, or its title and description when it has none. Nothing else of the
 * page or of the user.
 */
export function buildPrompt(input: PromptInput): string {
  const lines = [
    'You file links in a personal library of web pages.',
    'From the page below, give:',
    '- summary: what the page is about, in at most 60 words;',
    '- tags: 1 to 5 lower-case tags, each a single word or a hyphenated phrase;',
    '- topic: the path of the one topic the page belongs to: one to three names from the most general to the most specific, separated by " > ".',
    'File the page under the most specific topic that fits, existing or new, and put a new topic under the existing topic it belongs to.',
    'Reuse an existing tag when one fits, preferring the more used ones;',
    'make a new one only when none does. A few tags that fit well beat many that fit loosely.',
    'Each existing tag is followed by the number of links that carry it.',
    'Existing topics:',
    ...(input.topics.length ? input.topics : ['(none)']),
    `Existing tags: ${listEntries(input.tags)}`,
    '',
    `Title: ${input.title}`,
    `Host: ${input.host}`,
  ];
  if (input.text) {
    lines.push('', 'Page text:', input.text.slice(0, MAX_PROMPT_TEXT));
  } else {
    lines.push(`Description: ${input.description ?? '(none)'}`);
  }
  return lines.join('\n');
}

/** The user's aliases: each former name's key (nameKey) with the name of its survivor. */
export interface Aliases {
  topics: Map<string, string>;
  tags: Map<string, string>;
}

/**
 * An enrichment result with every topic or tag that is an alias replaced by
 * its survivor, compared ignoring case; tags that become repeats are dropped.
 */
export function applyAliases(result: Enrichment, aliases: Aliases): Enrichment {
  const topic = aliases.topics.get(nameKey(result.topic)) ?? result.topic;
  const tags = normalizeTags(result.tags.map((t) => aliases.tags.get(nameKey(t)) ?? t));
  return { ...result, topic, tags };
}

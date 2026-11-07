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
/** The fewest and the most tags an enrichment keeps. */
export const MIN_TAGS = 3;
export const MAX_TAGS = 8;

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
 * first 8 kept; the summary cut to its first 60 words. Returns null for a
 * result that is unusable: not the right shape, fewer than 3 tags, or an
 * empty summary or topic.
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

/** What the request about one link is built from. */
export interface PromptInput {
  title: string;
  host: string;
  /** The reader-view text, or '' when the reader view is empty. */
  text: string;
  description: string | null;
  topics: string[];
  tags: string[];
}

/**
 * The request sent to the provider: instructions, the link's title and host,
 * the user's topic and tag names, and the first 20,000 characters of the page
 * text, or its title and description when it has none. Nothing else of the
 * page or of the user.
 */
export function buildPrompt(input: PromptInput): string {
  const lines = [
    'You file links in a personal library of web pages.',
    'From the page below, give:',
    '- summary: what the page is about, in at most 60 words;',
    '- tags: 3 to 8 lower-case tags, each a single word or a hyphenated phrase;',
    '- topic: the one topic the page belongs to.',
    'Reuse an existing topic or tag when one fits; make a new one only when none does.',
    `Existing topics: ${input.topics.length ? input.topics.join(', ') : '(none)'}`,
    `Existing tags: ${input.tags.length ? input.tags.join(', ') : '(none)'}`,
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

/** Cutting a link's text into the passages the index matches and returns. */

/** The longest passage, in characters. */
export const PASSAGE_MAX = 1_500;
/** How much of a link's reader text is cut into passages, in characters. */
export const READER_TEXT_MAX = 200_000;
/** The most a reader passage repeats of the passage before it, in characters. */
export const OVERLAP_MAX = 200;

/** The text of a link that is indexed besides its reader text. */
export interface LinkText {
  title: string;
  summary: string | null;
  topic: string | null;
  tags: string[];
  note: string;
}

/** A cut closer to the start of a passage than this makes a passage too short to be worth having. */
const MIN_CUT = PASSAGE_MAX / 3;

/** Whether the UTF-16 unit at `index` is the first half of a surrogate pair. */
function startsPair(text: string, index: number): boolean {
  const unit = text.charCodeAt(index);
  return unit >= 0xd800 && unit <= 0xdbff;
}

/**
 * Where to cut `text`, which is longer than PASSAGE_MAX: at the last paragraph
 * break, else the last sentence end, else the last space that falls in the
 * window, and by hard count when the window holds none. A cut never splits a
 * character that takes two UTF-16 units.
 */
function cutPoint(text: string): number {
  const window = text.slice(0, PASSAGE_MAX + 1);
  const lastEnd = (pattern: RegExp, length: (m: RegExpMatchArray) => number): number => {
    let end = -1;
    for (const m of window.matchAll(pattern)) {
      const at = m.index + length(m);
      if (at >= MIN_CUT && at <= PASSAGE_MAX) end = at;
    }
    return end;
  };
  const paragraph = lastEnd(/\n[ \t\r]*\n/g, () => 0);
  if (paragraph >= 0) return paragraph;
  const sentence = lastEnd(/[.!?]+["')\]]*(?=\s)/g, (m) => m[0].length);
  if (sentence >= 0) return sentence;
  const space = lastEnd(/\s/g, () => 0);
  if (space >= 0) return space;
  return startsPair(text, PASSAGE_MAX - 1) ? PASSAGE_MAX - 1 : PASSAGE_MAX;
}

/** Cuts `text` into passages of at most PASSAGE_MAX characters, none of them blank. */
export function cutText(text: string): string[] {
  const passages: string[] = [];
  let rest = text.trim();
  while (rest.length > PASSAGE_MAX) {
    const end = cutPoint(rest);
    const piece = rest.slice(0, end).trim();
    if (piece) passages.push(piece);
    rest = rest.slice(end).trimStart();
  }
  if (rest) passages.push(rest);
  return passages;
}

/**
 * The last sentence of `piece`, or '' when it is the whole piece or longer
 * than OVERLAP_MAX: what the next passage starts with, so that a sentence
 * that leans on the one before it is not cut off from it.
 */
function lastSentence(piece: string): string {
  let start = -1;
  for (const m of piece.matchAll(/[.!?]+["')\]]*\s+|\n\s*/g)) {
    if (m.index + m[0].length < piece.length) start = m.index + m[0].length;
  }
  if (start < 0) return '';
  const sentence = piece.slice(start).trim();
  return sentence.length > 0 && sentence.length <= OVERLAP_MAX ? sentence : '';
}

/**
 * Cuts `text` as cutText does, each passage after the first starting with the
 * last sentence of the one before it (at most OVERLAP_MAX characters of it).
 */
export function cutOverlapping(text: string): string[] {
  const passages: string[] = [];
  let rest = text.trim();
  while (rest.length > PASSAGE_MAX) {
    const end = cutPoint(rest);
    const piece = rest.slice(0, end).trim();
    if (piece) passages.push(piece);
    const after = rest.slice(end).trimStart();
    if (!after) return passages;
    const overlap = piece ? lastSentence(piece) : '';
    rest = overlap ? `${overlap} ${after}` : after;
  }
  if (rest) passages.push(rest);
  return passages;
}

/**
 * `next` without what it repeats of `previous`: the text to append when two
 * consecutive passages of a link are read as one.
 */
export function withoutOverlap(previous: string, next: string): string {
  const overlap = lastSentence(previous);
  return overlap && next.startsWith(overlap) ? next.slice(overlap.length).trimStart() : next;
}

/** What a passage was cut from: the link's metadata or its reader text. */
export type PassageKind = 'metadata' | 'reader';

/** A passage of a link and what it was cut from. */
export interface CutPassage {
  text: string;
  kind: PassageKind;
}

/**
 * The text a passage is embedded as: a reader passage after its link's title
 * and topic path, so that a passage that never names its subject is still
 * near a question about it. The stored passage stays the passage alone.
 */
export function embeddedText(link: LinkText, passage: CutPassage): string {
  if (passage.kind !== 'reader') return passage.text;
  const heading = [link.title, link.topic].filter((part) => !!part && part.trim() !== '');
  return heading.length > 0 ? `${heading.join('\n')}\n\n${passage.text}` : passage.text;
}

/**
 * The passages of a link: first its title, summary, topic, tags and note, then
 * the first READER_TEXT_MAX characters of its reader text, overlapping.
 */
export function cutPassages(link: LinkText, readerText: string | null): CutPassage[] {
  const metadata = [link.title, link.summary, link.topic, link.tags.join(' '), link.note]
    .filter((part): part is string => !!part && part.trim() !== '')
    .join('\n');
  let reader = (readerText ?? '').slice(0, READER_TEXT_MAX);
  if (reader && startsPair(reader, reader.length - 1)) reader = reader.slice(0, -1);
  return [
    ...cutText(metadata).map((text) => ({ text, kind: 'metadata' as const })),
    ...cutOverlapping(reader).map((text) => ({ text, kind: 'reader' as const })),
  ];
}

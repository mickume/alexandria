/** Cutting a link's text into the passages the index matches and returns. */

/** The longest passage, in characters. */
export const PASSAGE_MAX = 1_500;
/** How much of a link's reader text is cut into passages, in characters. */
export const READER_TEXT_MAX = 50_000;

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
 * The passages of a link: first its title, summary, topic, tags and note, then
 * the first READER_TEXT_MAX characters of its reader text.
 */
export function cutPassages(link: LinkText, readerText: string | null): string[] {
  const metadata = [link.title, link.summary, link.topic, link.tags.join(' '), link.note]
    .filter((part): part is string => !!part && part.trim() !== '')
    .join('\n');
  let reader = (readerText ?? '').slice(0, READER_TEXT_MAX);
  if (reader && startsPair(reader, reader.length - 1)) reader = reader.slice(0, -1);
  return [...cutText(metadata), ...cutText(reader)];
}

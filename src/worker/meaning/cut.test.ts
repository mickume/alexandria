import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  cutOverlapping,
  cutPassages,
  cutText,
  embeddedText,
  PASSAGE_MAX,
  READER_TEXT_MAX,
  withoutOverlap,
  type LinkText,
} from './cut';

const LINK: LinkText = { title: 'Title', summary: null, topic: null, tags: [], note: '' };

/** The text without any whitespace: cuts may drop or add whitespace, never anything else. */
const letters = (s: string) => s.replace(/\s+/g, '');

/** The passages read as one text: each without what it repeats of the one before it. */
const asOne = (passages: string[]) =>
  passages.map((p, i) => (i === 0 ? p : withoutOverlap(passages[i - 1]!, p))).join(' ');

/** Reader text made of words, sentences and paragraph breaks, so cuts find natural places. */
const prose = fc
  .array(
    fc.oneof(fc.stringMatching(/^[a-z]{1,12}$/), fc.constantFrom('. ', '.\n\n', ', ', '\n', '? ')),
    { maxLength: 60_000 },
  )
  .map((parts) => parts.join(' '));

describe('cutting reader text into passages', () => {
  const reader = (text: string) =>
    cutPassages(LINK, text)
      .filter((p) => p.kind === 'reader')
      .map((p) => p.text);

  it('keeps every passage non-empty and short, and loses nothing of the first 200,000 characters', () => {
    fc.assert(
      fc.property(prose, (text) => {
        const passages = reader(text);
        expect(passages.every((p) => p.length >= 1 && p.length <= PASSAGE_MAX)).toBe(true);
        expect(letters(asOne(passages))).toBe(letters(text.slice(0, READER_TEXT_MAX)));
      }),
      { numRuns: 25 },
    );
  });

  it.each([1_499, 1_500, 1_501, 200_000, 200_001])('cuts a text of %i characters', (length) => {
    const text = 'word '.repeat(length).slice(0, length);
    const passages = reader(text);
    expect(passages.every((p) => p.length >= 1 && p.length <= PASSAGE_MAX)).toBe(true);
    expect(letters(asOne(passages))).toBe(letters(text.slice(0, READER_TEXT_MAX)));
  });

  it('never shows a character past the 200,000th', () => {
    const text = `${'a '.repeat(100_000)}Z`;
    expect(text.length).toBeGreaterThan(READER_TEXT_MAX);
    expect(reader(text).join(' ')).not.toContain('Z');
    expect(reader(`${'a '.repeat(99_999)}Z`).join(' ')).toContain('Z');
  });

  it('starts each passage with the last sentence of the one before it, when that is at most 200 characters', () => {
    const sentence = (n: number) => `Sentence ${n} of the page ends here.`;
    const text = Array.from({ length: 120 }, (_, n) => sentence(n)).join(' ');
    const passages = cutOverlapping(text);
    expect(passages.length).toBeGreaterThan(2);
    for (let i = 1; i < passages.length; i++) {
      const last = /Sentence \d+ of the page ends here\.$/.exec(passages[i - 1]!)![0];
      expect(passages[i]!.startsWith(last)).toBe(true);
      expect(passages[i]!.length).toBeLessThanOrEqual(PASSAGE_MAX);
      // Read as one, the two passages hold the sentence once.
      const joined = `${passages[i - 1]} ${withoutOverlap(passages[i - 1]!, passages[i]!)}`;
      expect(joined.split(last)).toHaveLength(2);
    }
    // A last sentence longer than 200 characters is not repeated.
    const long = `${'a'.repeat(900)}. ${'b '.repeat(150)}. ${'c'.repeat(900)}`;
    const [, second] = cutOverlapping(long);
    expect(second!.startsWith('c')).toBe(true);
  });

  it('embeds a reader passage after its link’s title and topic path, and a metadata passage as it is', () => {
    const link = {
      title: 'Alarms',
      summary: null,
      topic: 'Platform > Workers',
      tags: [],
      note: '',
    };
    expect(embeddedText(link, { kind: 'reader', text: 'It wakes the object.' })).toBe(
      'Alarms\nPlatform > Workers\n\nIt wakes the object.',
    );
    expect(embeddedText(link, { kind: 'metadata', text: 'Alarms' })).toBe('Alarms');
    expect(embeddedText({ ...link, topic: null }, { kind: 'reader', text: 'x' })).toBe(
      'Alarms\n\nx',
    );
  });

  it('cuts at the last paragraph break, else sentence end, else space, else hard', () => {
    const para = `${'a'.repeat(900)}\n\n${'b'.repeat(900)}`;
    expect(cutText(para)).toEqual(['a'.repeat(900), 'b'.repeat(900)]);
    const sentence = `${'a'.repeat(900)}. ${'b'.repeat(900)}`;
    expect(cutText(sentence)).toEqual([`${'a'.repeat(900)}.`, 'b'.repeat(900)]);
    const words = `${'a'.repeat(900)} ${'b'.repeat(900)}`;
    expect(cutText(words)).toEqual(['a'.repeat(900), 'b'.repeat(900)]);
    const solid = 'c'.repeat(3_200);
    expect(cutText(solid).map((p) => p.length)).toEqual([1_500, 1_500, 200]);
  });

  it('does not split a character made of two UTF-16 units', () => {
    const emoji = '😀'.repeat(1_000);
    const passages = cutText(emoji);
    expect(passages.every((p) => p.length <= PASSAGE_MAX)).toBe(true);
    expect(passages.join('')).toBe(emoji);
  });

  it('gives no passage for blank text', () => {
    expect(cutText('')).toEqual([]);
    expect(cutText(' \n\t ')).toEqual([]);
  });
});

describe('the passages of a link', () => {
  it('start with its title, summary, topic, tags and note, in one passage when they are short', () => {
    const passages = cutPassages(
      {
        title: 'Durable Object alarms',
        summary: 'Run code later.',
        topic: 'Cloudflare',
        tags: ['workers', 'alarms'],
        note: 'Read before the migration.',
      },
      'The body of the article.',
    );
    expect(passages).toEqual([
      {
        text: 'Durable Object alarms\nRun code later.\nCloudflare\nworkers alarms\nRead before the migration.',
        kind: 'metadata',
      },
      { text: 'The body of the article.', kind: 'reader' },
    ]);
  });

  it('is its metadata alone for a link without reader text', () => {
    expect(cutPassages(LINK, null)).toEqual([{ text: 'Title', kind: 'metadata' }]);
    expect(cutPassages(LINK, '')).toEqual([{ text: 'Title', kind: 'metadata' }]);
  });

  it('spreads a long note over several passages', () => {
    const note = Array.from({ length: 2_000 }, (_, i) => `note${i}`).join(' ');
    const passages = cutPassages({ ...LINK, note }, null);
    expect(passages.length).toBeGreaterThan(1);
    expect(passages.every((p) => p.kind === 'metadata' && p.text.length <= PASSAGE_MAX)).toBe(true);
    expect(passages[0]!.text.startsWith('Title\n')).toBe(true);
  });
});

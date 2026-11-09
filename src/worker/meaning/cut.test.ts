import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cutPassages, cutText, PASSAGE_MAX, READER_TEXT_MAX, type LinkText } from './cut';

const LINK: LinkText = { title: 'Title', summary: null, topic: null, tags: [], note: '' };

/** The text without any whitespace: cuts may drop or add whitespace, never anything else. */
const letters = (s: string) => s.replace(/\s+/g, '');

/** Reader text made of words, sentences and paragraph breaks, so cuts find natural places. */
const prose = fc
  .array(
    fc.oneof(fc.stringMatching(/^[a-z]{1,12}$/), fc.constantFrom('. ', '.\n\n', ', ', '\n', '? ')),
    { maxLength: 60_000 },
  )
  .map((parts) => parts.join(' '));

describe('cutting reader text into passages', () => {
  const reader = (text: string) => cutPassages(LINK, text).slice(1);

  it('keeps every passage non-empty and short, and loses nothing of the first 50,000 characters', () => {
    fc.assert(
      fc.property(prose, (text) => {
        const passages = reader(text);
        expect(passages.every((p) => p.length >= 1 && p.length <= PASSAGE_MAX)).toBe(true);
        expect(letters(passages.join(' '))).toBe(letters(text.slice(0, READER_TEXT_MAX)));
      }),
      { numRuns: 25 },
    );
  });

  it.each([1_499, 1_500, 1_501, 50_000, 50_001])('cuts a text of %i characters', (length) => {
    const text = 'word '.repeat(length).slice(0, length);
    const passages = reader(text);
    expect(passages.every((p) => p.length >= 1 && p.length <= PASSAGE_MAX)).toBe(true);
    expect(letters(passages.join(' '))).toBe(letters(text.slice(0, READER_TEXT_MAX)));
  });

  it('never shows a character past the 50,000th', () => {
    const text = `${'a '.repeat(25_000)}Z`;
    expect(text.length).toBeGreaterThan(READER_TEXT_MAX);
    expect(reader(text).join(' ')).not.toContain('Z');
    expect(reader(`${'a '.repeat(24_999)}Z`).join(' ')).toContain('Z');
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
    expect(passages).toHaveLength(2);
    expect(passages[0]).toBe(
      'Durable Object alarms\nRun code later.\nCloudflare\nworkers alarms\nRead before the migration.',
    );
    expect(passages[1]).toBe('The body of the article.');
  });

  it('is its metadata alone for a link without reader text', () => {
    expect(cutPassages(LINK, null)).toEqual(['Title']);
    expect(cutPassages(LINK, '')).toEqual(['Title']);
  });

  it('spreads a long note over several passages', () => {
    const note = Array.from({ length: 2_000 }, (_, i) => `note${i}`).join(' ');
    const passages = cutPassages({ ...LINK, note }, null);
    expect(passages.length).toBeGreaterThan(1);
    expect(passages.every((p) => p.length <= PASSAGE_MAX)).toBe(true);
    expect(passages[0]!.startsWith('Title\n')).toBe(true);
  });
});

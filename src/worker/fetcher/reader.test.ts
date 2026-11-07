import fc from 'fast-check';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import {
  articleWithText,
  blogArticle,
  docsPage,
  imagesOnly,
  longArticle,
  relativeArticle,
} from './fixtures/pages';
import { capText, extractReader } from './reader';

describe('the reader view', () => {
  it('keeps the article of a blog page and drops the site around it', () => {
    const r = extractReader(blogArticle, 'https://blog.example/posts/keep');
    expect(r.title).toBe('Why We Keep Links');
    expect(r.byline).toContain('Ada Writer');
    expect(r.html).toContain('The first reason');
    expect(r.html).toContain('<li>First point to remember</li>');
    for (const chrome of [
      'NAVIGATION-ONLY-TEXT',
      'SIDEBAR-ONLY-TEXT',
      'COMMENTS-ONLY-TEXT',
      'FOOTER-ONLY-TEXT',
    ]) {
      expect(r.html).not.toContain(chrome);
      expect(r.text).not.toContain(chrome);
    }
    expect(r.empty).toBe(false);
  });

  it('keeps code blocks and nested lists', () => {
    const r = extractReader(docsPage, 'https://docs.example/install');
    expect(r.html).toContain('<h2>Steps</h2>');
    expect(r.html).toMatch(
      /<pre><code>npm install --global the-tool\s+the-tool --version<\/code><\/pre>/,
    );
    expect(r.html).toMatch(/<li>on Linux<\/li>/);
  });

  it('makes every link and image address absolute against the final URL', () => {
    const r = extractReader(relativeArticle, 'https://rel.example/posts/one');
    const { document } = parseHTML(`<div>${r.html}</div>`);
    expect(document.querySelector('img')?.getAttribute('src')).toBe(
      'https://rel.example/posts/img/a.png',
    );
    expect(document.querySelector('a')?.getAttribute('href')).toBe('https://rel.example/b');
  });

  it.each([
    { label: '199 characters of text', html: articleWithText(199), empty: true },
    { label: 'exactly 200 characters', html: articleWithText(200), empty: false },
    { label: 'only images', html: imagesOnly, empty: true },
  ])('is empty for a page with $label when under 200 characters', ({ html, empty }) => {
    const r = extractReader(html, 'https://short.example/');
    expect(r.empty).toBe(empty);
    if (empty) {
      expect(r.html).toBeNull();
      expect(r.text).toBe('');
    }
  });

  it.each([
    { label: '600,000 characters', chars: 600_000 },
    { label: '1,000 characters', chars: 1_000 },
  ])('keeps at most 500,000 characters of an article of $label', ({ chars }) => {
    const r = extractReader(longArticle(chars), 'https://long.example/');
    const stored = capText(r.text);
    expect(stored.length).toBe(Math.min(r.text.length, 500_000));
    expect(r.text.startsWith(stored)).toBe(true);
  });

  it('never contains active content or unsafe addresses, whatever the page holds', () => {
    const dangerous = fc.constantFrom(
      '<script>alert(1)</script>',
      '<SCRIPT SRC="https://evil.example/x.js"></SCRIPT>',
      '<style>body{display:none}</style>',
      '<iframe src="https://evil.example"></iframe>',
      '<frame src="https://evil.example">',
      '<form action="https://evil.example"><input name="q"><button>Go</button></form>',
      '<object data="x.swf"></object>',
      '<embed src="x.swf">',
      '<img src="x.png" onerror="alert(1)">',
      '<p onclick="alert(1)">click</p>',
      '<a href="javascript:alert(1)">js</a>',
      '<a href="JaVaScRiPt:alert(1)">js</a>',
      '<a href="&#106;avascript:alert(1)">js</a>',
      '<a href="vbscript:msgbox(1)">vb</a>',
      '<img src="data:text/html,<script>alert(1)</script>">',
      '<body onload="alert(1)">',
    );
    const paragraph = fc.constant(
      '<p>A paragraph of the article that is long enough to be kept by the reader extraction step.</p>',
    );
    const page = fc
      .array(fc.oneof(paragraph, dangerous), { minLength: 6, maxLength: 30 })
      .map(
        (parts) =>
          `<html><head><title>T</title></head><body><article><h1>T</h1>${parts.join('')}${'<p>Plenty of ordinary words make this article long enough to read as one.</p>'.repeat(6)}</article></body></html>`,
      );
    const banned = 'script, style, iframe, frame, form, input, button, object, embed';
    fc.assert(
      fc.property(page, (html) => {
        const out = extractReader(html, 'https://safe.example/a').html ?? '';
        const { document } = parseHTML(`<div id="root">${out}</div>`);
        const root = document.getElementById('root')!;
        expect(root.querySelectorAll(banned)).toHaveLength(0);
        for (const el of root.querySelectorAll('*')) {
          for (const attr of el.getAttributeNames()) {
            expect(attr.toLowerCase().startsWith('on')).toBe(false);
            if (attr === 'href' || attr === 'src') {
              const value = el.getAttribute(attr) ?? '';
              expect(/^(https?:|data:image\/)/i.test(value)).toBe(true);
            }
          }
        }
      }),
      { numRuns: 150 },
    );
  });
});

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { collapse, parsePage } from './html';

/** The reader view of a page: its article alone, safe to show. */
export interface ReaderView {
  title: string | null;
  byline: string | null;
  /** The article's sanitised HTML, or null when the view is empty. */
  html: string | null;
  /** The article's plain text, whitespace collapsed; '' when the view is empty. */
  text: string;
  /** Too little text was extracted to make a reader view of. */
  empty: boolean;
}

/** The most reader-view text stored per link, in characters. */
export const MAX_TEXT = 500_000;
/** Less article text than this makes the reader view empty. */
export const MIN_TEXT = 200;

/** Elements the reader view may contain; any other element is unwrapped or dropped. */
const ALLOWED = new Set([
  'article',
  'section',
  'div',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'pre',
  'code',
  'blockquote',
  'a',
  'img',
  'figure',
  'figcaption',
  'em',
  'strong',
  'b',
  'i',
  'u',
  's',
  'sub',
  'sup',
  'br',
  'hr',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'span',
  'dl',
  'dt',
  'dd',
  'small',
  'mark',
  'abbr',
  'cite',
  'q',
  'time',
  'del',
  'ins',
  'kbd',
  'samp',
  'var',
]);

/** Elements dropped with everything inside them. */
const DROPPED = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'object',
  'embed',
  'noscript',
  'template',
  'svg',
  'math',
  'link',
  'meta',
  'base',
  'canvas',
  'video',
  'audio',
  'source',
  'track',
  'applet',
  'dialog',
]);

/** Attributes kept, per element; every other attribute is removed. */
const ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  th: new Set(['colspan', 'rowspan']),
  td: new Set(['colspan', 'rowspan']),
  time: new Set(['datetime']),
};

/** `value` made absolute against `base`, or null when it is not a safe address for `attr`. */
function safeUrl(value: string, base: string, attr: string): string | null {
  const trimmed = value.trim();
  if (attr === 'src' && /^data:image\//i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Sanitises `root`'s descendants in place by the allow-list: dangerous
 * elements go with their content, unknown elements are replaced by their
 * children, attributes outside the list and unsafe addresses are removed.
 */
function sanitize(root: Element, base: string): void {
  // Comments go: a browser ends one where this parser does not (at --!>), so
  // what follows inside one here could become an element there.
  const comments: Node[] = [];
  const collect = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 8) comments.push(child);
      else collect(child);
    }
  };
  collect(root);
  for (const comment of comments) comment.parentNode?.removeChild(comment);
  for (const el of [...root.querySelectorAll('*')]) {
    const tag = el.tagName.toLowerCase();
    if (DROPPED.has(tag)) {
      el.remove();
      continue;
    }
    if (!ALLOWED.has(tag)) {
      // One by one: an element can hold more children than a call takes arguments.
      while (el.firstChild) el.parentNode?.insertBefore(el.firstChild, el);
      el.remove();
      continue;
    }
    const allowed = ATTRIBUTES[tag];
    for (const name of el.getAttributeNames()) {
      if (!allowed?.has(name)) {
        el.removeAttribute(name);
        continue;
      }
      if (name === 'href' || name === 'src') {
        const url = safeUrl(el.getAttribute(name) ?? '', base, name);
        if (url === null) el.removeAttribute(name);
        else el.setAttribute(name, url);
      }
    }
  }
}

/**
 * The deepest nesting of elements a page may have to be read. Readability's
 * time grows steeply with depth: a page nested thousands deep would use the
 * whole CPU limit and never be stored. No page written to be read comes near.
 */
export const MAX_DEPTH = 256;

/** Whether any node under `root` lies more than `limit` levels below it. */
function nestedDeeperThan(root: Node, limit: number): boolean {
  const pending: [Node, number][] = [[root, 0]];
  for (let next = pending.pop(); next; next = pending.pop()) {
    const [node, depth] = next;
    if (depth > limit) return true;
    for (const child of node.childNodes) pending.push([child, depth + 1]);
  }
  return false;
}

const EMPTY: ReaderView = { title: null, byline: null, html: null, text: '', empty: true };

/**
 * The reader view of a stored page: Readability's article over a DOM of the
 * HTML, sanitised by an allow-list, with every link and image address made
 * absolute against the page's final URL. Under 200 characters of article text
 * the view is empty.
 */
export function extractReader(page: string | Document, finalUrl: string): ReaderView {
  // Readability takes the document apart: whatever else reads it reads it first.
  const document = typeof page === 'string' ? parsePage(page) : page;
  if (nestedDeeperThan(document, MAX_DEPTH)) {
    throw new Error(`the page nests its elements deeper than ${MAX_DEPTH} levels`);
  }
  const article = new Readability(document, { keepClasses: false }).parse();
  if (!article?.content) return EMPTY;

  const { document: out } = parseHTML(
    '<!doctype html><html><body><div id="reader"></div></body></html>',
  );
  const root = out.getElementById('reader')!;
  root.innerHTML = article.content;
  sanitize(root, finalUrl);
  const text = collapse(root.textContent ?? '');
  if (text.length < MIN_TEXT) return EMPTY;
  return {
    title: article.title ? collapse(article.title) : null,
    byline: article.byline ? collapse(article.byline) : null,
    html: root.innerHTML,
    text,
    empty: false,
  };
}

/** The part of a reader view's text that is stored: its first MAX_TEXT characters. */
export function capText(text: string): string {
  return text.slice(0, MAX_TEXT);
}

import createDOMPurify from 'dompurify';
import { Marked } from 'marked';

/** The tags Markdown produces; nothing else from a note reaches the page. */
const MARKDOWN_TAGS = [
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'input',
];
const SAFE_URL = /^(?:https?:|mailto:)/i;

/** Makes every http or https link a sanitiser keeps open in a new tab, as a card's links do. */
export function openWebLinksInNewTab(sanitiser: ReturnType<typeof createDOMPurify>): void {
  sanitiser.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href')?.trim() ?? '')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

/** A link page of the website, which an answer's citation points to. */
const LINK_PAGE = /^\/links\/[\w-]+$/;

/** A sanitiser of its own that keeps only the URLs `safe` accepts, so that its rule reaches no other sanitising on the page. */
function sanitiser(safe: (url: string) => boolean): ReturnType<typeof createDOMPurify> {
  const purifier = createDOMPurify(window);
  openWebLinksInNewTab(purifier);
  purifier.addHook('uponSanitizeAttribute', (_node, data) => {
    if ((data.attrName === 'href' || data.attrName === 'src') && !safe(data.attrValue.trim())) {
      data.keepAttr = false;
    }
  });
  return purifier;
}

const purifier = sanitiser((url) => SAFE_URL.test(url));
/** An answer may also link to the website's link pages, its citations. */
const answerPurifier = sanitiser((url) => SAFE_URL.test(url) || LINK_PAGE.test(url));

/** Markdown with raw HTML reduced to its text: a note's own HTML never becomes an element. */
const markdown = new Marked({ async: false, gfm: true });
markdown.use({
  renderer: {
    html({ text }) {
      return purifier.sanitize(text, { ALLOWED_TAGS: [], KEEP_CONTENT: true });
    },
  },
});

const SANITISE = {
  ALLOWED_TAGS: MARKDOWN_TAGS,
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'type', 'checked', 'disabled'],
};

/** A note as HTML: Markdown rendered, raw HTML removed, only http, https and mailto URLs kept. */
export function renderNote(source: string): string {
  return purifier.sanitize(markdown.parse(source, { async: false }), SANITISE);
}

/**
 * An answer is written from stored page text, which may carry instructions of
 * its own: it gets no images, so nothing in it is fetched without a click.
 */
const SANITISE_ANSWER = {
  ...SANITISE,
  ALLOWED_TAGS: MARKDOWN_TAGS.filter((tag) => tag !== 'img'),
};

/**
 * An answer as HTML, rendered as a note is but without images, with each
 * citation [n] that `citation` gives a link page for made a link to that page.
 */
export function renderAnswer(source: string, citation: (n: number) => string | undefined): string {
  const cited = source.replace(/\[(\d+)\](?!\()/g, (match, n: string) => {
    const page = citation(Number(n));
    return page && LINK_PAGE.test(page) ? `[\\[${n}\\]](${page})` : match;
  });
  return answerPurifier.sanitize(markdown.parse(cited, { async: false }), SANITISE_ANSWER);
}

/** A rendered note. */
export function Markdown({ source }: { source: string }) {
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: renderNote(source) }} />;
}

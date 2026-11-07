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

/** A sanitiser of its own, so that its URL rule does not reach other sanitising on the page. */
const purifier = createDOMPurify(window);
purifier.addHook('uponSanitizeAttribute', (_node, data) => {
  if (
    (data.attrName === 'href' || data.attrName === 'src') &&
    !SAFE_URL.test(data.attrValue.trim())
  ) {
    data.keepAttr = false;
  }
});

/** Markdown with raw HTML reduced to its text: a note's own HTML never becomes an element. */
const markdown = new Marked({ async: false, gfm: true });
markdown.use({
  renderer: {
    html({ text }) {
      return purifier.sanitize(text, { ALLOWED_TAGS: [], KEEP_CONTENT: true });
    },
  },
});

/** A note as HTML: Markdown rendered, raw HTML removed, only http, https and mailto URLs kept. */
export function renderNote(source: string): string {
  const html = markdown.parse(source, { async: false });
  return purifier.sanitize(html, {
    ALLOWED_TAGS: MARKDOWN_TAGS,
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'type', 'checked', 'disabled'],
  });
}

/** A rendered note. */
export function Markdown({ source }: { source: string }) {
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: renderNote(source) }} />;
}

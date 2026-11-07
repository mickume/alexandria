import { parseHTML } from 'linkedom';

/** What a web page says about itself. */
export interface PageMetadata {
  title: string;
  description: string | null;
  faviconUrl: string;
  language: string | null;
}

function collapse(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function metaContent(document: Document, selector: string): string {
  return collapse(document.querySelector(selector)?.getAttribute('content'));
}

/**
 * Reads a page's metadata: the title from <title>, else og:title, else the
 * host; the description from og:description, else the meta description; the
 * favicon from the first link whose rel contains "icon", else /favicon.ico at
 * the origin; the language from <html lang>. Whitespace is collapsed.
 */
export function extractMetadata(html: string, finalUrl: string): PageMetadata {
  const { document } = parseHTML(html) as unknown as { document: Document };
  const url = new URL(finalUrl);
  const title =
    collapse(document.querySelector('title')?.textContent) ||
    metaContent(document, 'meta[property="og:title"]') ||
    url.host;
  const description =
    metaContent(document, 'meta[property="og:description"]') ||
    metaContent(document, 'meta[name="description"]') ||
    null;
  let faviconUrl = `${url.origin}/favicon.ico`;
  for (const link of document.querySelectorAll('link[rel][href]')) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    if (!rel.includes('icon')) continue;
    try {
      faviconUrl = new URL(link.getAttribute('href') ?? '', url).href;
      break;
    } catch {
      // An unusable href: look at the next icon link.
    }
  }
  const language = collapse(document.documentElement?.getAttribute('lang')) || null;
  return { title, description, faviconUrl, language };
}

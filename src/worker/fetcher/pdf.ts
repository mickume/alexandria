import { extractText, getDocumentProxy, getMeta } from 'unpdf';

/** What a PDF says about itself. */
export interface PdfContent {
  /** The Title of its document information, if it has one. */
  title: string | null;
  /** Its text, pages joined, spaces collapsed and blank lines kept; '' when it has none. */
  text: string;
}

/** Collapses runs of spaces, keeps line breaks and at most one blank line between blocks. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Reads a PDF's title and text with pdf.js (through unpdf). A PDF that cannot
 * be parsed reads as one without title or text.
 */
export async function readPdf(bytes: Uint8Array): Promise<PdfContent> {
  try {
    // pdf.js takes ownership of the buffer it is given, so each call gets a copy.
    const pdf = await getDocumentProxy(bytes.slice());
    const [{ info }, { text }] = await Promise.all([
      getMeta(pdf),
      extractText(pdf, { mergePages: true }),
    ]);
    const rawTitle = (info as unknown as Record<string, unknown> | undefined)?.Title;
    const title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : null;
    return { title, text: tidy(text) };
  } catch {
    return { title: null, text: '' };
  }
}

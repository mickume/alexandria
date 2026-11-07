import { extractText, getDocumentProxy, getMeta } from 'unpdf';

/** What a PDF says about itself. */
export interface PdfContent {
  /** The Title of its document information, if it has one. */
  title: string | null;
  /** Its text, pages joined, whitespace collapsed; '' when it has none. */
  text: string;
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
    return { title, text: text.replace(/\s+/g, ' ').trim() };
  } catch {
    return { title: null, text: '' };
  }
}

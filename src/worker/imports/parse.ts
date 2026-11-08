/** Reading an import file: a text or Markdown file, of which each line holding a web address counts. */

/** The largest import file, in bytes (2 MB). */
export const MAX_IMPORT_BYTES = 2_097_152;
/** The most URL lines one import may hold. */
export const MAX_IMPORT_URLS = 5_000;

/** One URL line of an import file: its 1-based line number and the address found in it. */
export interface ImportLine {
  line: number;
  url: string;
}

/** The URL lines of an accepted file, or why the file was refused. */
export type ParsedFile =
  | { ok: true; lines: ImportLine[] }
  | { ok: false; error: 'unsupported_file' | 'import_too_large' | 'no_urls' };

/** The declared media types an import file may have. */
const ACCEPTED_TYPES = new Set(['text/plain', 'text/markdown', 'text/x-markdown']);
/** The file names accepted whatever their declared type, which browsers often leave empty or generic. */
const ACCEPTED_NAME = /\.(txt|md)$/i;

/** Whether a file with this declared type (or none) and name may be imported. */
function accepted(declaredType: string | null, fileName: string | null): boolean {
  if (fileName && ACCEPTED_NAME.test(fileName)) return true;
  if (!declaredType) return true;
  return ACCEPTED_TYPES.has(declaredType.split(';')[0]!.trim().toLowerCase());
}

/** The file's text, or null when it is not valid UTF-8. */
function decode(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Where a web address starts. */
const URL_START = /https?:\/\//i;
/** What ends an address: whitespace, quotes, angle and square brackets, backticks and pipes. */
const URL_END = /[\s<>"'`[\]|]/;
/** Punctuation that closes a sentence or Markdown emphasis, never taken as an address's last character. */
const TRAILING = /[.,;:!?*_~]$/;

/** How often `char` occurs in `text`. */
function occurrences(text: string, char: string): number {
  return text.split(char).length - 1;
}

/**
 * The first http or https address in a line, or null when it has none. The
 * address runs to the first whitespace, quote, bracket, backtick or pipe;
 * trailing punctuation and an unbalanced closing parenthesis are dropped, so
 * that `[docs](https://a.example/x).` and `<https://a.example/x>` both give
 * `https://a.example/x`.
 */
export function findUrl(line: string): string | null {
  const start = line.search(URL_START);
  if (start < 0) return null;
  let url = line.slice(start);
  const end = url.search(URL_END);
  if (end >= 0) url = url.slice(0, end);
  for (;;) {
    if (TRAILING.test(url)) url = url.slice(0, -1);
    else if (url.endsWith(')') && occurrences(url, ')') > occurrences(url, '(')) {
      url = url.slice(0, -1);
    } else return url;
  }
}

/**
 * Reads an import file. Refuses a declared type other than text/plain or
 * text/markdown (unless the file is named *.txt or *.md), bytes that are not
 * UTF-8 and a NUL byte (unsupported_file); a file over 2 MB or 5,000 URL lines
 * (import_too_large); and a file with no URL line (no_urls). Otherwise drops
 * a byte-order mark, splits at '\n' or '\r\n', skips lines whose first
 * non-blank character is '#', and takes from each other line its first http
 * or https address (findUrl), with its line number. Lines without one are
 * ignored.
 */
export function parseImportFile(
  bytes: Uint8Array,
  declaredType: string | null,
  fileName: string | null = null,
): ParsedFile {
  if (!accepted(declaredType, fileName)) return { ok: false, error: 'unsupported_file' };
  if (bytes.length > MAX_IMPORT_BYTES) return { ok: false, error: 'import_too_large' };
  const decoded = decode(bytes);
  if (decoded === null || decoded.includes('\u0000')) {
    return { ok: false, error: 'unsupported_file' };
  }
  const text = decoded.startsWith('\ufeff') ? decoded.slice(1) : decoded;
  const lines: ImportLine[] = [];
  text.split('\n').forEach((raw, i) => {
    if (raw.trimStart().startsWith('#')) return;
    const url = findUrl(raw);
    if (url) lines.push({ line: i + 1, url });
  });
  if (lines.length > MAX_IMPORT_URLS) return { ok: false, error: 'import_too_large' };
  if (lines.length === 0) return { ok: false, error: 'no_urls' };
  return { ok: true, lines };
}

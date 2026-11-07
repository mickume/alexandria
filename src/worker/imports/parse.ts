/** Reading an import file: a plain-text list of URLs, one per line. */

/** The largest import file, in bytes (2 MB). */
export const MAX_IMPORT_BYTES = 2_097_152;
/** The most URL lines one import may hold. */
export const MAX_IMPORT_URLS = 5_000;

/** One URL line of an import file: its 1-based line number and its first word. */
export interface ImportLine {
  line: number;
  url: string;
}

/** The URL lines of an accepted file, or why the file was refused. */
export type ParsedFile =
  | { ok: true; lines: ImportLine[] }
  | { ok: false; error: 'unsupported_file' | 'import_too_large' | 'no_urls' };

/** Whether a declared media type is plain text, or absent. */
function plainOrAbsent(declaredType: string | null): boolean {
  if (!declaredType) return true;
  return declaredType.split(';')[0]!.trim().toLowerCase() === 'text/plain';
}

/** The file's text, or null when it is not valid UTF-8. */
function decode(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Whether the text is markup (its first non-blank character is '<') or a JSON object or array. */
function looksStructured(text: string): boolean {
  const start = text.trimStart();
  if (start.startsWith('<')) return true;
  if (!start.startsWith('{') && !start.startsWith('[')) return false;
  try {
    const value: unknown = JSON.parse(start);
    return typeof value === 'object' && value !== null;
  } catch {
    return false;
  }
}

/**
 * Reads an import file. Refuses a declared type other than text/plain, bytes
 * that are not UTF-8, a NUL byte, markup and JSON (unsupported_file); a file
 * over 2 MB or 5,000 URL lines (import_too_large); and a file with no URL line
 * (no_urls). Otherwise drops a byte-order mark, splits at '\n' or '\r\n',
 * skips blank lines and lines whose first non-blank character is '#', and
 * takes each other line's first whitespace-separated word, with its line number.
 */
export function parseImportFile(bytes: Uint8Array, declaredType: string | null): ParsedFile {
  if (!plainOrAbsent(declaredType)) return { ok: false, error: 'unsupported_file' };
  if (bytes.length > MAX_IMPORT_BYTES) return { ok: false, error: 'import_too_large' };
  const decoded = decode(bytes);
  if (decoded === null || decoded.includes('\u0000')) {
    return { ok: false, error: 'unsupported_file' };
  }
  const text = decoded.startsWith('﻿') ? decoded.slice(1) : decoded;
  if (looksStructured(text)) return { ok: false, error: 'unsupported_file' };
  const lines: ImportLine[] = [];
  text.split('\n').forEach((raw, i) => {
    const word = raw.trim().split(/\s+/)[0] ?? '';
    if (word && !word.startsWith('#')) lines.push({ line: i + 1, url: word });
  });
  if (lines.length > MAX_IMPORT_URLS) return { ok: false, error: 'import_too_large' };
  if (lines.length === 0) return { ok: false, error: 'no_urls' };
  return { ok: true, lines };
}

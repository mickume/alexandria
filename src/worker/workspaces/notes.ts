/** The longest note, in Unicode code points. */
export const NOTE_MAX = 20_000;
/** The longest note preview, in characters. */
export const PREVIEW_MAX = 200;

/** A valid note, or why the value is refused. */
export type NoteCheck =
  | { ok: true; note: string }
  | { ok: false; error: 'note_too_long' | 'invalid_note'; message: string };

/** Checks a note: a string of at most 20,000 code points; '' clears the note. */
export function checkNote(value: unknown): NoteCheck {
  if (typeof value !== 'string') {
    return { ok: false, error: 'invalid_note', message: 'a note must be text' };
  }
  if ([...value].length > NOTE_MAX) {
    return { ok: false, error: 'note_too_long', message: 'note too long (20,000 characters)' };
  }
  return { ok: true, note: value };
}

/**
 * A note's first non-empty line as plain text: raw HTML elements removed
 * (with the content of script and style elements), then a leading Markdown
 * heading or list marker; trimmed and cut to 200 characters. Null for an
 * empty note.
 */
export function notePreview(note: string): string | null {
  const plain = note
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '');
  for (const raw of plain.split(/\r?\n/)) {
    const line = raw
      .trim()
      .replace(/^#{1,6}\s+/, '')
      .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
      .trim();
    if (line) return [...line].slice(0, PREVIEW_MAX).join('');
  }
  return null;
}

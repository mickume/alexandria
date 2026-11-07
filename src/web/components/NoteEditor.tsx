import { useState } from 'react';
import { ApiError } from '../api';
import { Markdown } from './Markdown';

/**
 * A note shown rendered, with in-place editing: Save sends the text, and a
 * refusal (such as 'note too long (20,000 characters)') is shown while the
 * editor keeps the text.
 */
export function NoteEditor({
  note,
  onSave,
}: {
  note: string;
  onSave: (note: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      await onSave(text);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'could not save the note, try again');
    }
  }

  if (!editing) {
    return (
      <div className="note">
        {note ? <Markdown source={note} /> : <p className="muted">No note yet.</p>}
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setText(note);
            setEditing(true);
          }}
        >
          Edit note
        </button>
      </div>
    );
  }
  return (
    <div className="note note-editing">
      <label htmlFor="note-text">Note</label>
      <textarea id="note-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="button primary" onClick={() => void save()}>
          Save note
        </button>
        <button type="button" className="button" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

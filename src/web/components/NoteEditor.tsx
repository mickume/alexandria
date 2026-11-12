import { useState } from 'react';
import { ApiError } from '../api';
import { Markdown } from './Markdown';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

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
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-xs font-normal text-muted-foreground not-italic hover:text-foreground"
          onClick={() => {
            setText(note);
            setEditing(true);
          }}
        >
          Edit note
        </Button>
      </div>
    );
  }
  return (
    <div className="note note-editing">
      <Label htmlFor="note-text">Note</Label>
      <Textarea id="note-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <Button type="button" onClick={() => void save()}>
          Save note
        </Button>
        <Button type="button" variant="outline" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

import { useState, type ReactNode } from 'react';
import { ApiError, links, type Link } from '../api';

type Field = 'title' | 'summary' | 'tags' | 'topic';

const LABELS: Record<Field, string> = {
  title: 'Title',
  summary: 'Summary',
  tags: 'Tags',
  topic: 'Topic',
};

function asText(link: Link, field: Field): string {
  if (field === 'tags') return link.tags.join(', ');
  return link[field] ?? '';
}

/**
 * One of a link's editable fields on its detail page: its value, an 'edited'
 * marker when the owner set it, and in-place editing that sends only this
 * field and shows a refusal beside it.
 */
export function EditableField({
  link,
  field,
  onSaved,
  children,
}: {
  link: Link;
  field: Field;
  onSaved: (link: Link) => void;
  children?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const label = LABELS[field];
  const inputId = `edit-${field}`;

  function start() {
    setValue(asText(link, field));
    setError(null);
    setEditing(true);
  }

  async function save() {
    const sent =
      field === 'tags'
        ? {
            tags: value
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          }
        : { [field]: value };
    try {
      onSaved(await links.edit(link.id, sent));
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'could not save, try again');
    }
  }

  return (
    <div className="field" data-testid={`field-${field}`}>
      <div className="field-head">
        <span className="muted">{label}</span>
        {link.edited_fields.includes(field) && (
          <span className="q-label q-label--accent">edited</span>
        )}
        {!editing && (
          <button type="button" className="q-btn-link" onClick={start} aria-label={`Edit ${field}`}>
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <div className="field-edit">
          <label htmlFor={inputId} className="visually-hidden">
            {label}
          </label>
          {field === 'summary' ? (
            <textarea
              id={inputId}
              rows={4}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          ) : (
            <input id={inputId} value={value} onChange={(e) => setValue(e.target.value)} />
          )}
          <div className="actions">
            <button type="button" className="q-btn q-btn--primary" onClick={() => void save()}>
              Save
            </button>
            <button type="button" className="q-btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="field-value">
          {children ?? (asText(link, field) || <span className="muted">none</span>)}
        </div>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

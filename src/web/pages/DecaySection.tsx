import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, decay, type Thresholds } from '../api';

const FIELDS: { key: keyof Thresholds; label: string; meaning: string }[] = [
  {
    key: 'start_points',
    label: 'Start points',
    meaning:
      'Points a link starts with and goes back to when used, plus one per use; it loses one a day',
  },
  {
    key: 'remove_days',
    label: 'Remove after expiring (days)',
    meaning: 'An expired link is deleted for good, with its snapshot.',
  },
];

/** The decay section of the settings page: the two settings, and a refusal beside its field. */
export function DecaySection() {
  const [values, setValues] = useState<Record<keyof Thresholds, string> | null>(null);
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    decay
      .get()
      .then((t) => {
        if (!live) return;
        setValues({ start_points: String(t.start_points), remove_days: String(t.remove_days) });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!values) return;
    setError(null);
    setSaved(false);
    try {
      await decay.save({
        start_points: Number(values.start_points),
        remove_days: Number(values.remove_days),
      });
      setSaved(true);
    } catch (err) {
      const field =
        err instanceof ApiError && typeof err.body.field === 'string' ? err.body.field : null;
      setError({
        field,
        message: err instanceof ApiError ? err.message : 'could not save, try again',
      });
    }
  }

  if (!values) return null;
  return (
    <section className="decay-settings">
      <h2>Decay</h2>
      <p className="muted">
        A link loses a point a day it is not used. At 0 it expires and leaves the stream; it is
        removed later unless you use or restore it.
      </p>
      <form className="stacked-form" onSubmit={save}>
        {FIELDS.map(({ key, label, meaning }) => (
          <div key={key} className="field" data-field={key}>
            <label htmlFor={`decay-${key}`}>{label}</label>
            <input
              id={`decay-${key}`}
              type="number"
              min={7}
              max={3650}
              value={values[key]}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
            <span className="muted">{meaning}</span>
            {error?.field === key && (
              <span className="notice" role="alert">
                {error.message}
              </span>
            )}
          </div>
        ))}
        {error && error.field === null && (
          <p className="notice" role="alert">
            {error.message}
          </p>
        )}
        <button type="submit" className="q-btn q-btn--primary">
          Save
        </button>
        {saved && <span role="status">Saved</span>}
      </form>
    </section>
  );
}

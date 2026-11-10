import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, decay, type Thresholds } from '../api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const FIELDS: {
  key: keyof Thresholds;
  label: string;
  meaning: string;
  min: number;
  max: number;
}[] = [
  {
    key: 'start_points',
    label: 'Start points',
    meaning: 'Points a link starts with, plus one per use. It loses one a day.',
    min: 7,
    max: 3650,
  },
  {
    key: 'remove_days',
    label: 'Remove after expiring (days)',
    meaning: 'An expired link is deleted for good, with its snapshot.',
    min: 7,
    max: 3650,
  },
  {
    key: 'use_boost',
    label: 'Use boost (%)',
    meaning:
      'Share of the points a link has lost that a use wins back, once a day. At 100, a use gives back all of them.',
    min: 10,
    max: 100,
  },
];

/** The settings as the form holds them, one string per field. */
function asValues(t: Thresholds): Record<keyof Thresholds, string> {
  return {
    start_points: String(t.start_points),
    remove_days: String(t.remove_days),
    use_boost: String(t.use_boost),
  };
}

/** The decay section of the settings page: the three settings, and a refusal beside its field. */
export function DecaySection() {
  const [values, setValues] = useState<Record<keyof Thresholds, string> | null>(null);
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    decay
      .get()
      .then((t) => {
        if (live) setValues(asValues(t));
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
      const stored = await decay.save({
        start_points: Number(values.start_points),
        remove_days: Number(values.remove_days),
        use_boost: Number(values.use_boost),
      });
      setValues(asValues(stored));
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
      {/* The API checks the values, and its refusal is shown beside the field it names. */}
      <form className="stacked-form" onSubmit={save} noValidate>
        {FIELDS.map(({ key, label, meaning, min, max }) => (
          <div key={key} className="field" data-field={key}>
            <Label htmlFor={`decay-${key}`}>{label}</Label>
            <Input
              id={`decay-${key}`}
              type="number"
              min={min}
              max={max}
              value={values[key]}
              aria-describedby={`decay-${key}-help`}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
            <span id={`decay-${key}-help`} className="muted">
              {meaning}
            </span>
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
        <Button type="submit">Save</Button>
        {saved && <span role="status">Saved</span>}
      </form>
    </section>
  );
}

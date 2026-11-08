import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, firecrawl, type FirecrawlSettings } from '../api';

/**
 * The Firecrawl section of the settings page: the stored key by its last 4
 * characters (or its rejection), Replace and Remove, and the form that saves
 * a key. The key input is emptied after any save.
 */
export function FirecrawlSection() {
  const [settings, setSettings] = useState<FirecrawlSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    firecrawl
      .get()
      .then((s) => live && setSettings(s))
      .catch(() => live && setSettings({ configured: false }));
    return () => {
      live = false;
    };
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      setSettings(await firecrawl.save(apiKey));
      setMessage('key verified');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'could not save the key, try again');
    } finally {
      setApiKey('');
    }
  }

  async function remove() {
    setMessage(null);
    try {
      await firecrawl.remove();
      setSettings({ configured: false });
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'could not remove the key, try again');
    }
  }

  if (!settings) return null;
  return (
    <section className="firecrawl-settings">
      <h2>Firecrawl</h2>
      <p className="muted">
        Some sites answer Alexandria with a bot check instead of their page. With your own Firecrawl
        key, those pages, and only those, are fetched through Firecrawl, which loads them in a
        browser; each one uses credits of your Firecrawl plan. Without a key, such links stay
        unreachable.
      </p>
      {settings.configured && (
        <div className="panel q-box q-box-body">
          {settings.status === 'rejected' && (
            <p className="notice" role="alert">
              your Firecrawl key was rejected: {settings.rejected_message ?? 'no reason given'}
            </p>
          )}
          <p>
            Firecrawl · <code>…{settings.key_last4}</code>
          </p>
          <div className="actions">
            <button
              type="button"
              className="q-btn"
              aria-label="Replace Firecrawl key"
              onClick={() => document.getElementById('firecrawl-key')?.focus()}
            >
              Replace
            </button>
            <button
              type="button"
              className="q-btn"
              aria-label="Remove Firecrawl key"
              onClick={() => void remove()}
            >
              Remove
            </button>
          </div>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <form className="stacked-form" onSubmit={save}>
        <label htmlFor="firecrawl-key">Firecrawl API key</label>
        <input
          id="firecrawl-key"
          type="password"
          autoComplete="off"
          required
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <button type="submit" className="q-btn q-btn--primary">
          Save Firecrawl key
        </button>
      </form>
    </section>
  );
}

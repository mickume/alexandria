import { useEffect, useState, type FormEvent } from 'react';
import { ai, ApiError, type AiSettings } from '../api';

/** The default Anthropic model, shown as the model input's placeholder. */
const DEFAULT_MODEL = 'claude-opus-5-5';

/**
 * The AI section of the settings page: the provider (Anthropic preselected),
 * the key and the model, 'key verified' or the provider's refusal, the stored
 * key by its last 4 characters, and Replace and Remove.
 */
export function AiKeySection() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [provider, setProvider] = useState<'anthropic' | 'openrouter'>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    ai.get()
      .then((s) => live && setSettings(s))
      .catch(() => live && setSettings({ configured: false, unenriched_count: 0 }));
    return () => {
      live = false;
    };
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      const saved = await ai.save({
        provider,
        api_key: apiKey,
        ...(model.trim() ? { model: model.trim() } : {}),
      });
      setSettings({ ...saved, unenriched_count: settings?.unenriched_count ?? 0 } as AiSettings);
      setMessage('key verified');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'could not save the key, try again');
    } finally {
      setApiKey('');
    }
  }

  async function enrichAll() {
    setMessage(null);
    try {
      const { queued } = await ai.enrichUnenriched();
      setMessage(`queued ${queued} links`);
      setSettings((s) => (s ? { ...s, unenriched_count: 0 } : s));
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'could not queue the links, try again');
    }
  }

  async function remove() {
    setMessage(null);
    try {
      await ai.remove();
      setSettings({ configured: false, unenriched_count: settings?.unenriched_count ?? 0 });
    } catch {
      setMessage('could not remove the key, try again');
    }
  }

  if (!settings) return null;
  return (
    <section className="ai-settings">
      <h2>AI provider</h2>
      <p className="muted">
        Links are summarised, tagged and given a topic with your own AI key. Without one, everything
        else works and links are simply not enriched.
      </p>
      {settings.configured && (
        <div className="panel">
          <p>
            {settings.provider === 'anthropic' ? 'Anthropic' : 'OpenRouter'} · {settings.model} ·{' '}
            <code>…{settings.key_last4}</code>
          </p>
          <div className="actions">
            <button
              type="button"
              className="button"
              onClick={() => document.getElementById('ai-key')?.focus()}
            >
              Replace
            </button>
            <button type="button" className="button" onClick={() => void remove()}>
              Remove
            </button>
          </div>
          {settings.status === 'verified' && settings.unenriched_count > 0 && (
            <button type="button" className="button primary" onClick={() => void enrichAll()}>
              Enrich all unenriched links ({settings.unenriched_count})
            </button>
          )}
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <form className="stacked-form" onSubmit={save}>
        <label htmlFor="ai-provider">Provider</label>
        <select
          id="ai-provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value as 'anthropic' | 'openrouter')}
        >
          <option value="anthropic">Anthropic</option>
          <option value="openrouter">OpenRouter</option>
        </select>
        <label htmlFor="ai-key">API key</label>
        <input
          id="ai-key"
          type="password"
          autoComplete="off"
          required
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <label htmlFor="ai-model">Model</label>
        <input
          id="ai-model"
          placeholder={provider === 'anthropic' ? DEFAULT_MODEL : 'provider/model'}
          required={provider === 'openrouter'}
          maxLength={200}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        <button type="submit" className="button primary">
          Save key
        </button>
      </form>
    </section>
  );
}

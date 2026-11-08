import { useEffect, useState, type FormEvent } from 'react';
import { ai, ApiError, type AiSettings } from '../api';

/** The default Anthropic model, shown as the model input's placeholder. */
const DEFAULT_MODEL = 'claude-opus-5-5';

type Provider = 'anthropic' | 'openrouter';

/**
 * The form that saves a key: the provider (Anthropic preselected), the key and
 * the model, which OpenRouter requires. The key input is emptied after any save.
 */
function KeyForm({
  onSaved,
  onMessage,
}: {
  onSaved: (settings: AiSettings) => void;
  onMessage: (message: string) => void;
}) {
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      const body = { provider, api_key: apiKey, ...(model.trim() ? { model: model.trim() } : {}) };
      onSaved(await ai.save(body));
      onMessage('key verified');
    } catch (err) {
      onMessage(err instanceof ApiError ? err.message : 'could not save the key, try again');
    } finally {
      setApiKey('');
    }
  }

  return (
    <form className="stacked-form" onSubmit={save}>
      <label htmlFor="ai-provider">Provider</label>
      <select
        id="ai-provider"
        value={provider}
        onChange={(e) => setProvider(e.target.value as Provider)}
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
      <button type="submit" className="q-btn q-btn--primary">
        Save key
      </button>
    </form>
  );
}

/**
 * The AI section of the settings page: the stored key by its last 4
 * characters (or its rejection), Replace and Remove, 'Enrich all unenriched
 * links', and the form that saves a key.
 */
export function AiKeySection() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
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

  async function act(action: () => Promise<string | null>, failure: string) {
    setMessage(null);
    try {
      setMessage(await action());
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : failure);
    }
  }

  const enrichAll = () =>
    act(async () => {
      const { queued } = await ai.enrichUnenriched();
      setSettings((s) => (s ? { ...s, unenriched_count: 0 } : s));
      return `queued ${queued} links`;
    }, 'could not queue the links, try again');

  const remove = () =>
    act(async () => {
      await ai.remove();
      setSettings((s) => ({ configured: false, unenriched_count: s?.unenriched_count ?? 0 }));
      return null;
    }, 'could not remove the key, try again');

  if (!settings) return null;
  return (
    <section className="ai-settings">
      <h2>AI provider</h2>
      <p className="muted">
        Links are summarised, tagged and given a topic with your own AI key. Without one, everything
        else works and links are simply not enriched.
      </p>
      {settings.configured && (
        <div className="panel q-box q-box-body">
          {settings.status === 'rejected' && (
            <p className="notice" role="alert">
              your AI key was rejected: {settings.rejected_message ?? 'no reason given'}
            </p>
          )}
          <p>
            {settings.provider === 'anthropic' ? 'Anthropic' : 'OpenRouter'} · {settings.model} ·{' '}
            <code>…{settings.key_last4}</code>
          </p>
          <div className="actions">
            <button
              type="button"
              className="q-btn"
              onClick={() => document.getElementById('ai-key')?.focus()}
            >
              Replace
            </button>
            <button type="button" className="q-btn" onClick={() => void remove()}>
              Remove
            </button>
          </div>
          {settings.status === 'verified' && settings.unenriched_count > 0 && (
            <button type="button" className="q-btn q-btn--primary" onClick={() => void enrichAll()}>
              Enrich all unenriched links ({settings.unenriched_count})
            </button>
          )}
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <KeyForm
        onSaved={(saved) =>
          setSettings(
            (s) => ({ ...saved, unenriched_count: s?.unenriched_count ?? 0 }) as AiSettings,
          )
        }
        onMessage={setMessage}
      />
    </section>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, tokens, type Token } from '../api';
import { formatDate } from '../format';

/** The secret of a token just created, shown until the owner dismisses it. */
function NewSecret({ secret, onDone }: { secret: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="panel" role="status">
      <p>Copy this secret now. It will not be shown again.</p>
      <code className="secret">{secret}</code>
      <div className="actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            void navigator.clipboard?.writeText(secret).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="button" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

/** The settings page: personal access tokens. */
export function Settings() {
  const [list, setList] = useState<Token[] | null>(null);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    tokens
      .list()
      .then((items) => live && setList(items))
      .catch(() => live && setError('could not load the tokens'));
    return () => {
      live = false;
    };
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { secret: created, ...token } = await tokens.create(name);
      setSecret(created);
      setName('');
      setList((current) => [token, ...(current ?? [])]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'could not create the token');
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await tokens.revoke(id);
      setList((current) => (current ?? []).filter((t) => t.id !== id));
    } catch {
      setError('could not revoke the token, try again');
    }
  }

  return (
    <section className="settings">
      <h1>Settings</h1>
      <h2>Personal access tokens</h2>
      <p className="muted">
        A token lets a script or an app use the API as you. Send it as{' '}
        <code>Authorization: Bearer &lt;secret&gt;</code>.
      </p>
      <form className="inline-form" onSubmit={create}>
        <label htmlFor="token-name">Token name</label>
        <input
          id="token-name"
          value={name}
          maxLength={100}
          required
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="button primary">
          Create token
        </button>
      </form>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {secret && <NewSecret secret={secret} onDone={() => setSecret(null)} />}
      <ul className="token-list">
        {(list ?? []).map((t) => (
          <li key={t.id} aria-label={t.name}>
            <div>
              <strong>{t.name}</strong>
              <div className="muted">
                Created {formatDate(t.created_at)} · Last used{' '}
                {t.last_used_at ? formatDate(t.last_used_at) : 'never'}
              </div>
            </div>
            <button type="button" className="button" onClick={() => void revoke(t.id)}>
              Revoke
            </button>
          </li>
        ))}
      </ul>
      {list?.length === 0 && <p className="muted">No tokens yet.</p>}
    </section>
  );
}

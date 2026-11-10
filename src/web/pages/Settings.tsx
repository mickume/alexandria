import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, tokens, type Token } from '../api';
import { formatDate } from '../format';
import { AiKeySection } from './AiKeySection';
import { DecaySection } from './DecaySection';
import { DeleteAccountSection } from './DeleteAccountSection';
import { FirecrawlSection } from './FirecrawlSection';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

/** The secret of a token just created, shown until the owner dismisses it. */
function NewSecret({ secret, onDone }: { secret: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card className="panel gap-3 p-4 shadow-none" role="status">
      <p>Copy this secret now. It will not be shown again.</p>
      <code className="secret">{secret}</code>
      <div className="actions">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(secret).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          Done
        </Button>
      </div>
    </Card>
  );
}

/** The export section: the whole library as one file. */
function ExportSection() {
  return (
    <section aria-labelledby="export-heading">
      <h2 id="export-heading">Export</h2>
      <p className="muted">
        Your whole library as one JSON file: every link, workspace, topic and tag, with the
        addresses of each link’s stored copies.
      </p>
      <a className={buttonVariants({ variant: 'outline' })} href="/api/v1/export" download>
        Export library
      </a>
    </section>
  );
}

/** The settings page: tokens, the AI key, decay, importing, exporting and leaving. */
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
        <Label htmlFor="token-name">Token name</Label>
        <Input
          id="token-name"
          value={name}
          maxLength={100}
          required
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit">Create token</Button>
      </form>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {secret && <NewSecret secret={secret} onDone={() => setSecret(null)} />}
      <ul className="token-list list-box">
        {(list ?? []).map((t) => (
          <li key={t.id} className="list-row" aria-label={t.name}>
            <div>
              <strong>{t.name}</strong>
              <div className="muted">
                Created {formatDate(t.created_at)} · Last used{' '}
                {t.last_used_at ? formatDate(t.last_used_at) : 'never'}
              </div>
            </div>
            <Button type="button" variant="outline" onClick={() => void revoke(t.id)}>
              Revoke
            </Button>
          </li>
        ))}
      </ul>
      {list?.length === 0 && <p className="muted">No tokens yet.</p>}
      <AiKeySection />
      <FirecrawlSection />
      <DecaySection />
      <ExportSection />
      <DeleteAccountSection />
    </section>
  );
}

import { useEffect, useState } from 'react';
import { navigate } from '../App';
import { account, ApiError } from '../api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Whether the typed text is the email, ignoring case and surrounding whitespace. */
function matches(typed: string, email: string | null): boolean {
  return email !== null && typed.trim().toLowerCase() === email.toLowerCase();
}

/**
 * The delete-account section of the settings page: the warning, the email to
 * type, and 'Delete account', enabled only once the email matches.
 */
export function DeleteAccountSection() {
  const [email, setEmail] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    account
      .me()
      .then((me) => live && setEmail(me.email))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      await account.remove(typed);
      navigate('/signin?deleted=1');
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof ApiError && err.status < 500 && err.message !== err.code
          ? err.message
          : 'could not delete the account, try again',
      );
    }
  }

  return (
    <section aria-labelledby="delete-heading" className="danger-zone">
      <h2 id="delete-heading">Delete account</h2>
      <p>
        Deleting your account removes every link, snapshot, workspace, token and the AI key. It
        cannot be undone.
      </p>
      <Label htmlFor="delete-confirm">Type your email address to confirm</Label>
      <Input
        id="delete-confirm"
        type="email"
        autoComplete="off"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
      <Button
        type="button"
        variant="destructive"
        disabled={!matches(typed, email) || busy}
        onClick={() => void remove()}
      >
        Delete account
      </Button>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

import { useState } from 'react';
import { links, type Link, type SearchMode } from '../api';
import { ByMeaning, KeywordOnlyNotice } from '../components/ByMeaning';
import { useStateList } from '../stateList';
import { useUndoableDelete } from '../undo';
import { Button } from '@/components/ui/button';

/**
 * The Expired page: expired links, most recently expired first, each with the
 * day it will be removed, to restore or delete; with a query (from the search
 * box), the expired links matching it.
 */
export function Expired({ query = '', mode }: { query?: string; mode?: SearchMode }) {
  const { items, setItems, loaded, failed, byMeaning, keywordOnly } = useStateList(
    'expired',
    query,
    mode,
  );
  const [failure, setFailure] = useState<string | null>(null);
  const error = failure ?? (failed ? 'could not load the expired links' : null);
  const setError = setFailure;
  const deletes = useUndoableDelete(items, setItems);

  async function restore(link: Link) {
    setError(null);
    try {
      await links.restore(link.id);
      setItems((current) => current.filter((l) => l.id !== link.id));
    } catch {
      setError('could not restore, try again');
    }
  }

  return (
    <section className="expired">
      <h1 className="visually-hidden">Expired</h1>
      <p className="muted">
        Links whose points ran out. Each is removed on the day shown; restore one, or use it, to put
        it back in the stream.
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {keywordOnly && <KeywordOnlyNotice />}
      <div className="cards">
        {deletes.shown.map((link) => (
          <article key={link.id} className="card" aria-label={link.title}>
            <div className="card-top">
              <div className="card-head">
                <span className="card-title">{link.title}</span>
              </div>
              <div className="card-actions">
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => void restore(link)}
                >
                  Restore
                </Button>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => deletes.remove(link)}
                >
                  Delete
                </Button>
              </div>
            </div>
            <div className="card-meta muted">
              <span>{link.host}</span>
              {byMeaning.has(link.id) && <ByMeaning />}
              {link.removal_at && <span>removed on {link.removal_at.slice(0, 10)}</span>}
            </div>
          </article>
        ))}
      </div>
      {loaded && deletes.shown.length === 0 && (
        <p className="muted">
          {query.trim() ? `nothing found for ${query.trim()}` : 'Nothing has expired.'}
        </p>
      )}
    </section>
  );
}

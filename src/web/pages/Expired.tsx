import { useEffect, useState } from 'react';
import { links, search, type Link, type SearchMode } from '../api';
import { ByMeaning, KeywordOnlyNotice } from '../components/ByMeaning';
import { Toast } from '../components/Toast';
import { useUndoableDelete } from './Stream';

/** Expired links as the page lists them, and how a search by meaning found them. */
interface Listed {
  list: Link[];
  /** The ids of the links found by meaning alone. */
  byMeaning: Set<string>;
  /** Whether a search by meaning could not use meaning. */
  keywordOnly: boolean;
}

/** The expired links matching `query`: the search, limited to expired links. */
async function searchExpired(query: string, mode?: SearchMode): Promise<Listed> {
  const page = await search(`${query.trim()} state:expired`, undefined, mode);
  return {
    list: page.items.map((i) => i.link),
    byMeaning: new Set(page.items.filter((i) => i.match === 'meaning').map((i) => i.link.id)),
    keywordOnly: page.meaning === 'unavailable',
  };
}

/**
 * The Expired page: expired links, most recently expired first, each with the
 * day it will be removed, to restore or delete; with a query (from the search
 * box), the expired links matching it.
 */
export function Expired({ query = '', mode }: { query?: string; mode?: SearchMode }) {
  const [items, setItems] = useState<Link[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [byMeaning, setByMeaning] = useState<Set<string>>(new Set());
  const [keywordOnly, setKeywordOnly] = useState(false);
  const deletes = useUndoableDelete(items, setItems);

  useEffect(() => {
    let live = true;
    (query.trim()
      ? searchExpired(query, mode)
      : links.expired().then((list) => ({ list, byMeaning: new Set<string>(), keywordOnly: false }))
    )
      .then((listed) => {
        if (!live) return;
        setItems(listed.list);
        setByMeaning(listed.byMeaning);
        setKeywordOnly(listed.keywordOnly);
        setLoaded(true);
      })
      .catch(() => live && setError('could not load the expired links'));
    return () => {
      live = false;
    };
  }, [query, mode]);

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
      <h1>Expired</h1>
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
        {items.map((link) => (
          <article key={link.id} className="card" aria-label={link.title}>
            <div className="card-top">
              <div className="card-head">
                <span className="card-title">{link.title}</span>
              </div>
              <div className="card-actions">
                <button type="button" className="q-btn-link" onClick={() => void restore(link)}>
                  Restore
                </button>
                <button type="button" className="q-btn-link" onClick={() => deletes.remove(link)}>
                  Delete
                </button>
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
      {loaded && items.length === 0 && (
        <p className="muted">
          {query.trim() ? `nothing found for ${query.trim()}` : 'Nothing has expired.'}
        </p>
      )}
      <div className="toasts">
        {deletes.undoable.map((link) => (
          <Toast
            key={link.id}
            message={`Deleted ${link.title}`}
            action={{ label: 'Undo', onClick: () => deletes.undo(link.id) }}
          />
        ))}
        {deletes.failure && <Toast message={deletes.failure} />}
      </div>
    </section>
  );
}

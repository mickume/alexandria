import { useEffect, useState } from 'react';
import { links, type Link, type SearchMode } from '../api';
import { ByMeaning, KeywordOnlyNotice } from '../components/ByMeaning';
import { Toast } from '../components/Toast';
import { searchInState } from './Expired';
import { useUndoableDelete } from './Stream';

/**
 * The Archive page: the links the owner chose to keep, most recently archived
 * first, dimmed, each with the day it was archived, to unarchive or delete;
 * with a query (from the search box), the archived links matching it.
 */
export function Archive({ query = '', mode }: { query?: string; mode?: SearchMode }) {
  const [items, setItems] = useState<Link[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [byMeaning, setByMeaning] = useState<Set<string>>(new Set());
  const [keywordOnly, setKeywordOnly] = useState(false);
  const deletes = useUndoableDelete(items, setItems);

  useEffect(() => {
    let live = true;
    (query.trim()
      ? searchInState('archived', query, mode)
      : links
          .archived()
          .then((list) => ({ list, byMeaning: new Set<string>(), keywordOnly: false }))
    )
      .then((listed) => {
        if (!live) return;
        setItems(listed.list);
        setByMeaning(listed.byMeaning);
        setKeywordOnly(listed.keywordOnly);
        setLoaded(true);
      })
      .catch(() => live && setError('could not load the archive'));
    return () => {
      live = false;
    };
  }, [query, mode]);

  async function unarchive(link: Link) {
    setError(null);
    try {
      await links.unarchive(link.id);
      setItems((current) => current.filter((l) => l.id !== link.id));
    } catch {
      setError('could not unarchive, try again');
    }
  }

  return (
    <section className="archive">
      <h1>Archive</h1>
      <p className="muted">
        Links you chose to keep. They stay out of the stream and never expire; search and Ask still
        find them. Unarchive one to put it back in the stream.
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {keywordOnly && <KeywordOnlyNotice />}
      <div className="cards">
        {items.map((link) => (
          <article key={link.id} className="card archived" aria-label={link.title}>
            <div className="card-top">
              <div className="card-head">
                <span className="card-title">{link.title}</span>
              </div>
              <div className="card-actions">
                <button type="button" className="q-btn-link" onClick={() => void unarchive(link)}>
                  Unarchive
                </button>
                <button type="button" className="q-btn-link" onClick={() => deletes.remove(link)}>
                  Delete
                </button>
              </div>
            </div>
            <div className="card-meta muted">
              <span>{link.host}</span>
              {byMeaning.has(link.id) && <ByMeaning />}
              {link.archived_at && <span>archived on {link.archived_at.slice(0, 10)}</span>}
            </div>
          </article>
        ))}
      </div>
      {loaded && items.length === 0 && (
        <p className="muted">
          {query.trim() ? `nothing found for ${query.trim()}` : 'Nothing is archived.'}
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

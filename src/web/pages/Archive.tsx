import { useEffect, useState } from 'react';
import { links, type Link } from '../api';
import { Toast } from '../components/Toast';
import { useUndoableDelete } from './Stream';

/** The Archive page: archived links, most recently archived first, to restore or delete. */
export function Archive() {
  const [items, setItems] = useState<Link[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deletes = useUndoableDelete(items, setItems);

  useEffect(() => {
    let live = true;
    links
      .archived()
      .then((list) => {
        if (!live) return;
        setItems(list);
        setLoaded(true);
      })
      .catch(() => live && setError('could not load the archive'));
    return () => {
      live = false;
    };
  }, []);

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
    <section className="archive">
      <h1>Archive</h1>
      <p className="muted">
        Links you have not used for a long time. Restore one to put it back in the stream.
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <div className="cards">
        {items.map((link) => (
          <article key={link.id} className="card" aria-label={link.title}>
            <div className="card-head">
              <span className="card-title">{link.title}</span>
            </div>
            <div className="card-meta muted">
              <span>{link.host}</span>
              {link.removal_at && <span>removed on {link.removal_at.slice(0, 10)}</span>}
            </div>
            <div className="card-actions">
              <button type="button" className="link-button" onClick={() => void restore(link)}>
                Restore
              </button>
              <button type="button" className="link-button" onClick={() => deletes.remove(link)}>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
      {loaded && items.length === 0 && <p className="muted">Nothing is archived.</p>}
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

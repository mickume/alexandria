import { useEffect, useRef, useState } from 'react';
import { ApiError, links as linksApi, type Link } from '../api';
import { LinkCard, type CardActions } from '../components/LinkCard';
import { useUndoableDelete } from '../undo';

/**
 * The Pinned page: the pinned links, in pin order, listed as a search lists
 * its results. Dropping a dragged card on another moves it to that place;
 * Unpin and Archive take a link off the page.
 */
export function Pinned() {
  const [items, setItems] = useState<Link[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deletes = useUndoableDelete(items, setItems);
  const dragged = useRef<Link | null>(null);

  useEffect(() => {
    let live = true;
    linksApi
      .pinned()
      .then((list) => {
        if (!live) return;
        setItems(list);
        setLoaded(true);
      })
      .catch(
        () => live && setError('could not load the pinned links, reload the page to try again'),
      );
    return () => {
      live = false;
    };
  }, []);

  /** Runs a pin change, then shows the pinned links as the API orders them. */
  async function change(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      setItems(await linksApi.pinned());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'something went wrong, try again');
    }
  }

  const actions: CardActions = {
    onPin: () => undefined,
    onUnpin: (link) => void change(() => linksApi.unpin(link.id)),
    onDelete: deletes.remove,
    onChanged: (link) => setItems((current) => current.map((l) => (l.id === link.id ? link : l))),
    onArchive: (link) => void change(() => linksApi.archive(link.id)),
    onDragStart: (link) => {
      dragged.current = link;
    },
    onDropOn: (target) => {
      const moving = dragged.current;
      dragged.current = null;
      if (!moving || moving.id === target.id || target.pin_position === null) return;
      void change(() => linksApi.pin(moving.id, target.pin_position ?? undefined));
    },
  };

  return (
    <section className="pinned-links">
      <h1 className="visually-hidden">Pinned</h1>
      <p className="muted">
        The links you keep at hand, in your order: drag one onto another to move it there. Pinned
        links never expire.
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <ul className="results" aria-label="Pinned links">
        {deletes.shown.map((link) => (
          <li key={link.id}>
            <LinkCard link={link} actions={actions} />
          </li>
        ))}
      </ul>
      {loaded && deletes.shown.length === 0 && (
        <p className="muted empty blankslate">
          Nothing pinned yet. Pin a link in the stream to keep it here.
        </p>
      )}
    </section>
  );
}

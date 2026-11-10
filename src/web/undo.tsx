import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { links as linksApi, type Link } from './api';
import { Toast } from './components/Toast';

/** How long a deleted card can be brought back before the delete is sent. */
const UNDO_MS = 10_000;

/**
 * Deleting with a 10-second undo window: the card is hidden at once and the
 * request sent only when the window passes, at once with keepalive when the
 * page is hidden or left. The link stays in `items` until it is deleted, so
 * `shown`, the list to render, leaves it out however often `items` is loaded
 * again meanwhile; an undo or a failed delete shows it where it was.
 */
export function useUndoableDelete<T extends Link>(
  items: T[],
  setItems: Dispatch<SetStateAction<T[]>>,
) {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [undoable, setUndoable] = useState<Link[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  /** Takes a delete out of its undo window; false when it is no longer in it. */
  const take = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer === undefined) return false;
    clearTimeout(timer);
    timers.current.delete(id);
    setUndoable((u) => u.filter((l) => l.id !== id));
    return true;
  }, []);

  const show = useCallback((id: string) => {
    setHidden((ids) => {
      const next = new Set(ids);
      next.delete(id);
      return next;
    });
  }, []);

  /** Sends a pending delete now; on failure the card comes back. */
  const sendDelete = useCallback(
    (id: string, keepalive: boolean) => {
      if (!take(id)) return;
      linksApi.remove(id, { keepalive }).then(
        () => {
          setItems((current) => current.filter((l) => l.id !== id));
          show(id);
        },
        () => {
          show(id);
          setFailure('could not delete, try again');
        },
      );
    },
    [setItems, show, take],
  );

  // Leaving or hiding the page must not lose a deletion still in its undo window.
  useEffect(() => {
    const pending = timers.current;
    const flush = () => {
      for (const id of [...pending.keys()]) sendDelete(id, true);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [sendDelete]);

  function remove(link: Link) {
    setFailure(null);
    timers.current.set(
      link.id,
      setTimeout(() => sendDelete(link.id, false), UNDO_MS),
    );
    setHidden((ids) => new Set(ids).add(link.id));
    setUndoable((u) => [...u, link]);
  }

  function undo(id: string) {
    if (take(id)) show(id);
  }

  const shown = useMemo(() => items.filter((l) => !hidden.has(l.id)), [items, hidden]);
  return { remove, undo, undoable, failure, shown };
}

/** The toasts of the deletes in their undo window, each with Undo, and of a failed delete. */
export function UndoToasts({
  deletes,
}: {
  deletes: Pick<ReturnType<typeof useUndoableDelete>, 'undo' | 'undoable' | 'failure'>;
}) {
  return (
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
  );
}

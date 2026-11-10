import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { toast } from 'sonner';
import { links as linksApi, type Link } from './api';

/** How long a deleted card can be brought back before the delete is sent. */
const UNDO_MS = 10_000;

/**
 * Deleting with a 10-second undo window: the card is hidden at once, a toast
 * offers Undo, and the request is sent only when the window passes, at once
 * with keepalive when the page is hidden or left. The link stays in `items`
 * until it is deleted, so `shown`, the list to render, leaves it out however
 * often `items` is loaded again meanwhile; an undo or a failed delete shows it
 * where it was.
 */
export function useUndoableDelete<T extends Link>(
  items: T[],
  setItems: Dispatch<SetStateAction<T[]>>,
) {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  /** Takes a delete out of its undo window; false when it is no longer in it. */
  const take = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer === undefined) return false;
    clearTimeout(timer);
    timers.current.delete(id);
    toast.dismiss(id);
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
          toast.error('could not delete, try again');
        },
      );
    },
    [setItems, show, take],
  );

  const undo = useCallback(
    (id: string) => {
      if (take(id)) show(id);
    },
    [show, take],
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
    timers.current.set(
      link.id,
      setTimeout(() => sendDelete(link.id, false), UNDO_MS),
    );
    setHidden((ids) => new Set(ids).add(link.id));
    // The toast stays for the whole window: the timer above, not the toast, ends it.
    toast(`Deleted ${link.title}`, {
      id: link.id,
      duration: Infinity,
      action: { label: 'Undo', onClick: () => undo(link.id) },
    });
  }

  const shown = useMemo(() => items.filter((l) => !hidden.has(l.id)), [items, hidden]);
  return { remove, undo, shown };
}

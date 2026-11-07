import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Link as PageLink } from '../App';
import { ai, ApiError, links as linksApi, type Link, type Page } from '../api';
import { AddLinks } from '../components/AddLinks';
import { LinkCard, type CardActions } from '../components/LinkCard';
import { Toast } from '../components/Toast';

/** How long a deleted card can be brought back before the delete is sent. */
const UNDO_MS = 10_000;

interface PendingDelete {
  link: Link;
  index: number;
  timer: ReturnType<typeof setTimeout>;
}

/** Puts `fresh` links on top, newest use first, removing their earlier places. */
function withOnTop(current: Link[], fresh: Link[]): Link[] {
  const ids = new Set(fresh.map((l) => l.id));
  const top = [...fresh].sort((a, b) => (a.last_used_at < b.last_used_at ? 1 : -1));
  const pinned = current.filter((l) => l.pinned && !ids.has(l.id));
  const rest = current.filter((l) => !l.pinned && !ids.has(l.id));
  return [...pinned, ...top, ...rest];
}

/** Calls `onVisible` whenever the returned element scrolls into view. */
function useSentinel(onVisible: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const callback = useRef(onVisible);
  useEffect(() => {
    callback.current = onVisible;
  }, [onVisible]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) callback.current();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

type SetItems = Dispatch<SetStateAction<Link[]>>;

/** The loaded pages of the stream: the first on mount, the next ones on demand. */
function useStreamPages() {
  const [items, setItems] = useState<Link[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const loading = useRef(false);

  const showFirstPage = useCallback((page: Page<Link>) => {
    setItems(page.items);
    setCursor(page.next_cursor);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let live = true;
    linksApi
      .list()
      .then((page) => live && showFirstPage(page))
      .catch(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [showFirstPage]);

  /** Loads the first page again, so the stream shows the order the API returns. */
  const refresh = useCallback(async () => showFirstPage(await linksApi.list()), [showFirstPage]);

  const loadMore = useCallback(() => {
    if (!cursor || loading.current) return;
    loading.current = true;
    linksApi
      .list(cursor)
      .then((page) => {
        setItems((current) => {
          const known = new Set(current.map((l) => l.id));
          return [...current, ...page.items.filter((l) => !known.has(l.id))];
        });
        setCursor(page.next_cursor);
      })
      .catch(() => undefined)
      .finally(() => {
        loading.current = false;
      });
  }, [cursor]);

  return { items, setItems, loaded, refresh, loadMore };
}

/**
 * Deleting with a 10-second undo window: the card goes at once, the request
 * only when the window passes, at once with keepalive when the page is hidden
 * or left, and a failed delete puts the card back.
 */
function useUndoableDelete(items: Link[], setItems: SetItems) {
  const pendingDeletes = useRef(new Map<string, PendingDelete>());
  const [undoable, setUndoable] = useState<Link[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  /** Puts a card back where it was. */
  const restore = useCallback(
    (link: Link, index: number) => {
      setItems((current) => {
        if (current.some((l) => l.id === link.id)) return current;
        const next = [...current];
        next.splice(Math.min(index, next.length), 0, link);
        return next;
      });
    },
    [setItems],
  );

  /** Takes a delete out of its undo window and returns it. */
  const take = useCallback((id: string) => {
    const entry = pendingDeletes.current.get(id);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    pendingDeletes.current.delete(id);
    setUndoable((u) => u.filter((l) => l.id !== id));
    return entry;
  }, []);

  /** Sends a pending delete now; on failure the card comes back. */
  const sendDelete = useCallback(
    (id: string, keepalive: boolean) => {
      const entry = take(id);
      if (!entry) return;
      linksApi.remove(id, { keepalive }).catch(() => {
        restore(entry.link, entry.index);
        setFailure('could not delete, try again');
      });
    },
    [restore, take],
  );

  // Leaving or hiding the page must not lose a deletion still in its undo window.
  useEffect(() => {
    const pending = pendingDeletes.current;
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
    const index = items.findIndex((l) => l.id === link.id);
    setItems((current) => current.filter((l) => l.id !== link.id));
    const timer = setTimeout(() => sendDelete(link.id, false), UNDO_MS);
    pendingDeletes.current.set(link.id, { link, index, timer });
    setUndoable((u) => [...u, link]);
  }

  function undo(id: string) {
    const entry = take(id);
    if (entry) restore(entry.link, entry.index);
  }

  return { remove, undo, undoable, failure };
}

/** How often the stream asks for changes while a link is being fetched. */
const POLL_MS = 5_000;

/**
 * While any card is pending, being refreshed or queued for enrichment, asks every 5 seconds for the
 * links changed since the last server time and replaces those cards in place.
 */
function useChangeFeed(items: Link[], setItems: SetItems) {
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const since = useRef<string | null>(null);
  const watching =
    items.some((l) => l.state === 'pending' || l.enrichment_status === 'queued') ||
    refreshing.size > 0;
  const latest = useRef(items);
  useEffect(() => {
    latest.current = items;
  }, [items]);

  useEffect(() => {
    if (!watching) {
      since.current = null;
      return;
    }
    const timer = setInterval(() => {
      // The first poll asks from the newest change the page has already seen.
      since.current ??= latest.current.reduce(
        (max, l) => (l.updated_at > max ? l.updated_at : max),
        '1970-01-01T00:00:00.000Z',
      );
      linksApi
        .changedSince(since.current)
        .then((changes) => {
          since.current = changes.server_time;
          const changed = new Map(changes.items.map((l) => [l.id, l]));
          setItems((current) => current.map((l) => changed.get(l.id) ?? l));
          setRefreshing((ids) => {
            const left = new Set([...ids].filter((id) => !changed.has(id)));
            return left.size === ids.size ? ids : left;
          });
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [watching, setItems]);

  return {
    markRefreshing: (link: Link) => setRefreshing((ids) => new Set(ids).add(link.id)),
  };
}

/** 'not enriched: add an AI key in settings', once, while there is no key and links wait. */
function NoKeyBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let live = true;
    ai.get()
      .then((s) => live && setShow(!s.configured && s.unenriched_count > 0))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!show) return null;
  return (
    <PageLink to="/settings" className="banner">
      not enriched: add an AI key in settings
    </PageLink>
  );
}

/** The stream: the home page. Pinned links first, then the rest by last use. */
export function Stream() {
  const { items, setItems, loaded, refresh, loadMore } = useStreamPages();
  const deletes = useUndoableDelete(items, setItems);
  const feed = useChangeFeed(items, setItems);
  const [notice, setNotice] = useState<string | null>(null);
  const dragged = useRef<Link | null>(null);
  const sentinel = useSentinel(loadMore);

  /** Runs a pin change, then shows the stream as the API orders it. */
  async function change(action: () => Promise<unknown>) {
    setNotice(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'something went wrong, try again');
    }
  }

  const actions: CardActions = {
    onPin: (link) => void change(() => linksApi.pin(link.id)),
    onUnpin: (link) => void change(() => linksApi.unpin(link.id)),
    onDelete: deletes.remove,
    onRefreshing: feed.markRefreshing,
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
    <section className="stream">
      <AddLinks onAdded={(fresh) => setItems((current) => withOnTop(current, fresh))} />
      <NoKeyBanner />
      {notice && (
        <p className="notice" role="alert">
          {notice}
        </p>
      )}
      <div className="cards">
        {items.map((link) => (
          <LinkCard key={link.id} link={link} actions={actions} />
        ))}
      </div>
      {loaded && items.length === 0 && (
        <p className="muted empty">Nothing here yet. Paste a link above to start.</p>
      )}
      <div ref={sentinel} className="sentinel" aria-hidden="true" />
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

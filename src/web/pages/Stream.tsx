import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, links as linksApi, type Link, type Page } from '../api';
import { AddLinks } from '../components/AddLinks';
import { LinkCard, type CardActions } from '../components/LinkCard';

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

/** The stream: the home page. Pinned links first, then the rest by last use. */
export function Stream() {
  const [items, setItems] = useState<Link[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const loading = useRef(false);
  const dragged = useRef<Link | null>(null);

  function showFirstPage(page: Page<Link>) {
    setItems(page.items);
    setCursor(page.next_cursor);
    setLoaded(true);
  }

  /** Loads the first page again, so the stream shows the order the API returns. */
  async function refresh() {
    showFirstPage(await linksApi.list());
  }

  useEffect(() => {
    let live = true;
    linksApi
      .list()
      .then((page) => live && showFirstPage(page))
      .catch(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, []);

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

  const sentinel = useSentinel(loadMore);

  const actions: CardActions = {
    onPin: (link) => void change(() => linksApi.pin(link.id)),
    onUnpin: (link) => void change(() => linksApi.unpin(link.id)),
    onDelete: () => undefined,
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
    </section>
  );
}

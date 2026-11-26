import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { ApiError, links as linksApi, type Link } from '../api';
import { AddLinks } from '../components/AddLinks';
import { LinkCard, type CardActions } from '../components/LinkCard';
import { useUndoableDelete } from '../undo';

/** Puts `fresh` links on top, newest use first, removing their earlier places. */
function withOnTop(current: Link[], fresh: Link[]): Link[] {
  const ids = new Set(fresh.map((l) => l.id));
  const top = unpinned(fresh).sort((a, b) => (a.last_used_at < b.last_used_at ? 1 : -1));
  return [...top, ...current.filter((l) => !ids.has(l.id))];
}

/** The links that are not pinned: the pinned ones have a page of their own. */
function unpinned(links: Link[]): Link[] {
  return links.filter((l) => !l.pinned);
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

/** The loaded pages of the stream, without its pinned links: the first on mount, the next ones on demand. */
function useStreamPages() {
  const [items, setItems] = useState<Link[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const loading = useRef(false);

  useEffect(() => {
    let live = true;
    linksApi
      .list()
      .then((page) => {
        if (!live) return;
        setItems(unpinned(page.items));
        setCursor(page.next_cursor);
        setLoaded(true);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const loadMore = useCallback(() => {
    if (!cursor || loading.current) return;
    loading.current = true;
    linksApi
      .list(cursor)
      .then((page) => {
        setItems((current) => {
          const known = new Set(current.map((l) => l.id));
          return [...current, ...unpinned(page.items).filter((l) => !known.has(l.id))];
        });
        setCursor(page.next_cursor);
      })
      .catch(() => undefined)
      .finally(() => {
        loading.current = false;
      });
  }, [cursor]);

  return { items, setItems, loaded, failed, loadMore };
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
          setItems((current) => unpinned(current.map((l) => changed.get(l.id) ?? l)));
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

/** The stream: the home page. Every link but the pinned ones, which have a page of their own, by points. */
export function Stream() {
  const { items, setItems, loaded, failed, loadMore } = useStreamPages();
  const deletes = useUndoableDelete(items, setItems);
  const feed = useChangeFeed(items, setItems);
  const [notice, setNotice] = useState<string | null>(null);
  const sentinel = useSentinel(loadMore);

  /** Takes the link's card out of the stream once `action` has done what it asks. */
  function takeOut(action: () => Promise<unknown>, link: Link, failure: string) {
    setNotice(null);
    action()
      .then(() => setItems((current) => current.filter((l) => l.id !== link.id)))
      .catch((err) => setNotice(err instanceof ApiError ? err.message : failure));
  }

  const actions: CardActions = {
    onPin: (link) => takeOut(() => linksApi.pin(link.id), link, 'could not pin, try again'),
    onUnpin: () => undefined,
    onDelete: deletes.remove,
    onRefreshing: feed.markRefreshing,
    onChanged: (link) => setItems((current) => current.map((l) => (l.id === link.id ? link : l))),
    onArchive: (link) =>
      takeOut(() => linksApi.archive(link.id), link, 'could not archive, try again'),
  };

  return (
    <section className="stream">
      <h1 className="visually-hidden">Your library</h1>
      <p className="lead">Paste a link to keep it. The ones you use most stay on top.</p>
      <AddLinks onAdded={(fresh) => setItems((current) => withOnTop(current, fresh))} />
      {notice && (
        <p className="notice" role="alert">
          {notice}
        </p>
      )}
      <div className="cards">
        {deletes.shown.map((link) => (
          <LinkCard key={link.id} link={link} actions={actions} />
        ))}
      </div>
      {failed && !loaded && (
        <p className="notice" role="alert">
          could not load your links, reload the page to try again
        </p>
      )}
      {loaded && deletes.shown.length === 0 && (
        <p className="muted empty blankslate">Nothing here yet. Paste a link above to start.</p>
      )}
      <div ref={sentinel} className="sentinel" aria-hidden="true" />
    </section>
  );
}

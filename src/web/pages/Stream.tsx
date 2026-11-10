import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Link as PageLink } from '../App';
import { ai, ApiError, links as linksApi, type Link } from '../api';
import { AddLinks } from '../components/AddLinks';
import { Icon } from '../components/Icon';
import { LinkCard, type CardActions } from '../components/LinkCard';
import { UndoToasts, useUndoableDelete } from '../undo';

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

/** The most pages a refresh reads to show again as many cards as were shown. */
const REFRESH_PAGES = 20;

/** The loaded pages of the stream: the first on mount, the next ones on demand. */
function useStreamPages() {
  const [items, setItems] = useState<Link[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const loading = useRef(false);
  /** Counts the reloads, so that a page asked for before one is not added after it. */
  const generation = useRef(0);
  const count = useRef(0);
  useEffect(() => {
    count.current = items.length;
  }, [items]);

  /** Shows the stream as loaded from the top: these links, and the cursor after them. */
  const show = useCallback((all: Link[], next: string | null) => {
    generation.current += 1;
    setItems(all);
    setCursor(next);
    setLoaded(true);
    setFailed(false);
  }, []);

  useEffect(() => {
    let live = true;
    linksApi
      .list()
      .then((page) => live && show(page.items, page.next_cursor))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [show]);

  /** Loads the stream from the top again, as far as the cards already shown reach. */
  const refresh = useCallback(async () => {
    const wanted = count.current;
    let page = await linksApi.list();
    const all = [...page.items];
    for (let n = 1; page.next_cursor && all.length < wanted && n < REFRESH_PAGES; n++) {
      page = await linksApi.list(page.next_cursor);
      all.push(...page.items);
    }
    show(all, page.next_cursor);
  }, [show]);

  const loadMore = useCallback(() => {
    if (!cursor || loading.current) return;
    loading.current = true;
    const asked = generation.current;
    linksApi
      .list(cursor)
      .then((page) => {
        if (asked !== generation.current) return;
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

  return { items, setItems, loaded, failed, refresh, loadMore };
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
      <Icon name="info" />
      not enriched: add an AI key in settings
    </PageLink>
  );
}

/** The stream: the home page. The pinned links in a list of their own on top, then the rest by points. */
export function Stream() {
  const { items, setItems, loaded, failed, refresh, loadMore } = useStreamPages();
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
    onChanged: (link) => setItems((current) => current.map((l) => (l.id === link.id ? link : l))),
    onArchive: (link) => {
      setNotice(null);
      linksApi
        .archive(link.id)
        .then(() => setItems((current) => current.filter((l) => l.id !== link.id)))
        .catch((err) =>
          setNotice(err instanceof ApiError ? err.message : 'could not archive, try again'),
        );
    },
    onUnarchive: (link) => void change(() => linksApi.unarchive(link.id)),
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
      <header className="page-head">
        <h1>
          Your <span className="soft">library</span>
        </h1>
        <p className="lead">Paste a link to keep it. The ones you use most stay on top.</p>
      </header>
      <AddLinks onAdded={(fresh) => setItems((current) => withOnTop(current, fresh))} />
      <NoKeyBanner />
      {notice && (
        <p className="notice" role="alert">
          {notice}
        </p>
      )}
      <div className="cards pinned-cards">
        {deletes.shown
          .filter((link) => link.pinned)
          .map((link) => (
            <LinkCard key={link.id} link={link} actions={actions} />
          ))}
      </div>
      <div className="cards">
        {deletes.shown
          .filter((link) => !link.pinned)
          .map((link) => (
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
      <UndoToasts deletes={deletes} />
    </section>
  );
}

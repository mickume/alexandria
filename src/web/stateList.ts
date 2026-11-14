import { useEffect, useState } from 'react';
import { links, search, type Link, type Meaning, type SearchMode } from './api';

/** Links as the Expired or Archive page lists them, and how a search by meaning found them. */
interface Listed {
  list: Link[];
  /** The ids of the links found by meaning alone. */
  byMeaning: Set<string>;
  /** Whether meaning took part in a search by meaning; none for a list or a keyword search. */
  meaning?: Meaning;
}

/** The most pages of a search within one state that are read: 1,000 links. */
const SEARCH_PAGES = 20;

/** The links in `state` matching `query`: the search, limited to that state, page after page. */
async function searchInState(
  state: 'expired' | 'archived',
  query: string,
  mode?: SearchMode,
): Promise<Listed> {
  const listed: Listed = { list: [], byMeaning: new Set() };
  let cursor: string | null = null;
  for (let pages = 0; pages < SEARCH_PAGES; pages++) {
    const page = await search(`${query.trim()} state:${state}`, cursor, mode);
    for (const item of page.items) {
      listed.list.push(item.link);
      if (item.match === 'meaning') listed.byMeaning.add(item.link.id);
    }
    // Every page continues the first page's ranking, so the first page says it.
    listed.meaning ??= page.meaning;
    cursor = page.next_cursor;
    if (!cursor) break;
  }
  return listed;
}

/**
 * The links of the Expired or the Archive page: every link in `state`, most
 * recent first, or with a query (from the search box) those matching it.
 * `failed` says that the last load failed; a later load that works clears it.
 * `retry` loads again, as Try again does after a search without meaning.
 */
export function useStateList(state: 'expired' | 'archived', query: string, mode?: SearchMode) {
  const [items, setItems] = useState<Link[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [byMeaning, setByMeaning] = useState<Set<string>>(new Set());
  const [meaning, setMeaning] = useState<Meaning | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const all = (): Promise<Listed> =>
      (state === 'expired' ? links.expired() : links.archived()).then((list) => ({
        list,
        byMeaning: new Set<string>(),
      }));
    (query.trim() ? searchInState(state, query, mode) : all())
      .then((listed) => {
        if (!live) return;
        setItems(listed.list);
        setByMeaning(listed.byMeaning);
        setMeaning(listed.meaning);
        setLoaded(true);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [state, query, mode, attempt]);

  const retry = () => setAttempt((n) => n + 1);
  return { items, setItems, loaded, failed, byMeaning, meaning, retry };
}

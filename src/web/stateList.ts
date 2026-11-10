import { useEffect, useState } from 'react';
import { links, search, type Link, type SearchMode } from './api';

/** Links as the Expired or Archive page lists them, and how a search by meaning found them. */
interface Listed {
  list: Link[];
  /** The ids of the links found by meaning alone. */
  byMeaning: Set<string>;
  /** Whether a search by meaning could not use meaning. */
  keywordOnly: boolean;
}

/** The most pages of a search within one state that are read: 1,000 links. */
const SEARCH_PAGES = 20;

/** The links in `state` matching `query`: the search, limited to that state, page after page. */
async function searchInState(
  state: 'expired' | 'archived',
  query: string,
  mode?: SearchMode,
): Promise<Listed> {
  const listed: Listed = { list: [], byMeaning: new Set(), keywordOnly: false };
  let cursor: string | null = null;
  for (let pages = 0; pages < SEARCH_PAGES; pages++) {
    const page = await search(`${query.trim()} state:${state}`, cursor, mode);
    for (const item of page.items) {
      listed.list.push(item.link);
      if (item.match === 'meaning') listed.byMeaning.add(item.link.id);
    }
    listed.keywordOnly ||= page.meaning === 'unavailable';
    cursor = page.next_cursor;
    if (!cursor) break;
  }
  return listed;
}

/**
 * The links of the Expired or the Archive page: every link in `state`, most
 * recent first, or with a query (from the search box) those matching it.
 * `failed` says that the last load failed; a later load that works clears it.
 */
export function useStateList(state: 'expired' | 'archived', query: string, mode?: SearchMode) {
  const [items, setItems] = useState<Link[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [byMeaning, setByMeaning] = useState<Set<string>>(new Set());
  const [keywordOnly, setKeywordOnly] = useState(false);

  useEffect(() => {
    let live = true;
    const all = (): Promise<Listed> =>
      (state === 'expired' ? links.expired() : links.archived()).then((list) => ({
        list,
        byMeaning: new Set<string>(),
        keywordOnly: false,
      }));
    (query.trim() ? searchInState(state, query, mode) : all())
      .then((listed) => {
        if (!live) return;
        setItems(listed.list);
        setByMeaning(listed.byMeaning);
        setKeywordOnly(listed.keywordOnly);
        setLoaded(true);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [state, query, mode]);

  return { items, setItems, loaded, failed, byMeaning, keywordOnly };
}

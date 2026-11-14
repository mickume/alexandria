import { useEffect, useRef, useState } from 'react';
import { navigate, queryOf, type Location } from '../App';
import { searchPath, type SearchMode } from '../api';
import { Icon } from './Icon';

/** The longest query. */
export const QUERY_MAX = 200;

/** Whether keys typed at `target` are text: an input, a text area, a select or editable content. */
function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** The pages that search within their own links: the Expired page and the Archive page. */
const OWN_SEARCH = ['/expired', '/archive'];

/** How the box searches: by meaning as well as by words. */
const MODE: SearchMode = 'hybrid';

/**
 * The address a query leads to from `location`: the Expired and Archive pages
 * keep their own search.
 */
function addressOf(location: Location, query: string): string {
  if (OWN_SEARCH.includes(location.path)) {
    return `${location.path}?q=${encodeURIComponent(query)}&mode=${MODE}`;
  }
  return searchPath(query, MODE);
}

/** The page a location's search box shows the query of: the results page and the pages with their own search. */
function showsQuery(location: Location): boolean {
  return location.path === '/search' || OWN_SEARCH.includes(location.path);
}

/**
 * The search box in the header of every page. Typing searches nothing: Enter
 * searches the query by words and by meaning, at /search?q=&mode=hybrid (on
 * the Expired and Archive pages, within their links). '/' typed outside a
 * text field focuses it; Escape in it clears it, returns from a search to the
 * page it started from and focuses the page's main region. No other key is a
 * shortcut.
 */
export function SearchBox({ location }: { location: Location }) {
  const [value, setValue] = useState(() => (showsQuery(location) ? queryOf(location) : ''));
  const input = useRef<HTMLInputElement>(null);
  /** The page the current search started from. */
  const origin = useRef<string | null>(null);

  // A page reached otherwise (a link, history) shows its own query, or none.
  const [shown, setShown] = useState(location);
  if (shown !== location) {
    setShown(location);
    setValue(showsQuery(location) ? queryOf(location) : '');
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target)) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /** Enter: the query, by meaning as well as by words; nothing for an empty box. */
  function onSubmit() {
    if (!value.trim()) return;
    const here = window.location.pathname + window.location.search;
    const target = addressOf(location, value);
    if (target === here) return;
    if (!showsQuery(location)) origin.current = here;
    // Another search on the results page refines the search rather than adding history.
    navigate(target, { replace: location.path === '/search' });
  }

  function onEscape() {
    setValue('');
    // Only a search leaves its page: with none started, Escape stays where it is.
    const back = OWN_SEARCH.includes(location.path)
      ? location.path
      : location.path === '/search'
        ? (origin.current ?? '/')
        : null;
    origin.current = null;
    if (back !== null && back !== window.location.pathname + window.location.search) {
      navigate(back);
    }
    document.querySelector<HTMLElement>('main')?.focus();
  }

  return (
    <form
      className="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Icon name="search" size={16} />
      <input
        ref={input}
        type="search"
        aria-label="Search"
        placeholder="Search"
        maxLength={QUERY_MAX}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onEscape();
          }
        }}
      />
      <kbd aria-hidden="true">/</kbd>
    </form>
  );
}

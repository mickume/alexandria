import { useEffect, useRef, useState } from 'react';
import { navigate, queryOf, type Location } from '../App';
import { searchPath, type SearchMode } from '../api';
import { Icon } from './Icon';

/** How long the box waits after the last keystroke before it searches. */
export const SEARCH_DELAY_MS = 200;
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

/**
 * The address a query leads to from `location`: the Expired and Archive pages
 * keep their own search. With `mode` the search is by meaning as well as by words.
 */
function addressOf(location: Location, query: string, mode?: SearchMode): string {
  if (OWN_SEARCH.includes(location.path)) {
    if (!query) return location.path;
    return `${location.path}?q=${encodeURIComponent(query)}${mode ? `&mode=${mode}` : ''}`;
  }
  return query ? searchPath(query, mode) : '/';
}

/** The page a location's search box shows the query of: the results page and the pages with their own search. */
function showsQuery(location: Location): boolean {
  return location.path === '/search' || OWN_SEARCH.includes(location.path);
}

/**
 * The search box in the header of every page. It searches by keyword 200 ms
 * after the last keystroke, at /search?q= (on the Expired and Archive pages,
 * within their links); Enter searches the same query by meaning as well, at
 * /search?q=&mode=hybrid; an emptied box returns to the stream. '/' typed outside a text field
 * focuses it; Escape in it clears it, returns to the page the search started
 * from and focuses the page's main region. No other key is a shortcut.
 */
export function SearchBox({ location }: { location: Location }) {
  const [value, setValue] = useState(() => (showsQuery(location) ? queryOf(location) : ''));
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function search(query: string, mode?: SearchMode) {
    const here = window.location.pathname + window.location.search;
    const target = addressOf(location, query.trim() ? query : '', mode);
    if (target === here) return;
    if (!showsQuery(location)) origin.current = here;
    // Typing on the results page refines the search rather than adding history.
    navigate(target, { replace: location.path === '/search' && target.startsWith('/search') });
  }

  function onChange(query: string) {
    setValue(query);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => search(query), SEARCH_DELAY_MS);
  }

  /** Enter: the same query, now by meaning as well as by words. */
  function onSubmit() {
    if (timer.current) clearTimeout(timer.current);
    if (value.trim()) search(value, 'hybrid');
  }

  function onEscape() {
    if (timer.current) clearTimeout(timer.current);
    setValue('');
    const back = OWN_SEARCH.includes(location.path) ? location.path : (origin.current ?? '/');
    origin.current = null;
    if (back !== window.location.pathname + window.location.search) navigate(back);
    document.querySelector<HTMLElement>('main')?.focus();
  }

  return (
    <form
      className="q-input-group search"
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
        onChange={(e) => onChange(e.target.value)}
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

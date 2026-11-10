import { useEffect, useState, type ReactNode } from 'react';
import { Archive } from './pages/Archive';
import { Expired } from './pages/Expired';
import { Ask } from './pages/Ask';
import { Import } from './pages/Import';
import { LinkDetail } from './pages/LinkDetail';
import { Icon, Mark, type IconName } from './components/Icon';
import type { SearchMode } from './api';
import { SearchBox } from './components/SearchBox';
import { Read, Snapshot } from './pages/Read';
import { Search } from './pages/Search';
import { Settings } from './pages/Settings';
import { SignIn } from './pages/SignIn';
import { Stream } from './pages/Stream';
import { Tags } from './pages/Tags';
import { Topics } from './pages/Topics';
import { WorkspacePage } from './pages/Workspace';
import { Workspaces } from './pages/Workspaces';

/** Where the website is: the path and the query string of the page. */
export interface Location {
  path: string;
  /** The query string, with its leading '?' when it has one. */
  search: string;
}

function currentLocation(): Location {
  return { path: window.location.pathname, search: window.location.search };
}

/** The current location of the page, following history navigation. */
export function useLocation(): Location {
  const [location, setLocation] = useState(currentLocation);
  useEffect(() => {
    const onPop = () =>
      setLocation((before) => {
        const now = currentLocation();
        return now.path === before.path && now.search === before.search ? before : now;
      });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return location;
}

/**
 * Moves to `path` (with its query string) within the website without a
 * reload; `replace` replaces the current history entry instead of adding one.
 */
export function navigate(path: string, { replace = false } = {}): void {
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** A link within the website, followed without a reload. */
export function Link({
  to,
  children,
  className,
  title,
  current = false,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  /** The link's tooltip. */
  title?: string;
  /** Marks the link as the page being shown. */
  current?: boolean;
}) {
  return (
    <a
      href={to}
      className={className}
      title={title}
      aria-current={current ? 'page' : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

/** The sections of the navigation, by path. */
const SECTIONS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Stream', icon: 'stream' },
  { to: '/workspaces', label: 'Workspaces', icon: 'workspaces' },
  { to: '/topics', label: 'Topics', icon: 'topics' },
  { to: '/tags', label: 'Tags', icon: 'tags' },
  { to: '/ask', label: 'Ask', icon: 'ask' },
  { to: '/expired', label: 'Expired', icon: 'expired' },
  { to: '/archive', label: 'Archive', icon: 'archive' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

/** The section a path belongs to, for the breadcrumb and the current tab. */
function sectionOf(path: string): string {
  if (path === '/search') return 'Search';
  if (path === '/import') return 'Import';
  if (path.startsWith('/links/')) return 'Link';
  const match = SECTIONS.filter((s) => s.to !== '/' && path.startsWith(s.to));
  return match[0]?.label ?? 'Stream';
}

/**
 * The frame of every signed-in page: the header (where you are, the search
 * box and signing out, over a row of tabs, one per section, and the Import
 * button at its end) above the page.
 */
function Layout({ location, children }: { location: Location; children: ReactNode }) {
  const section = sectionOf(location.path);
  return (
    <div className="shell">
      <header className="q-header">
        <div className="q-header-bar">
          <p className="q-breadcrumb q-header-context">
            <Link to="/" className="q-breadcrumb-item brand">
              <Mark />
              <span>Alexandria</span>
            </Link>
            <span className="q-breadcrumb-separator" aria-hidden="true">
              /
            </span>
            <span className="q-breadcrumb-item is-current">{section}</span>
          </p>
          <div className="q-header-actions">
            <SearchBox location={location} />
            <form method="post" action="/auth/signout">
              <button
                type="submit"
                className="q-btn q-btn--icon"
                aria-label="Sign out"
                title="Sign out"
              >
                <Icon name="signout" />
              </button>
            </form>
          </div>
        </div>
        <nav className="q-underline-nav" aria-label="Sections">
          {SECTIONS.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className="q-underline-nav-item"
              current={section === s.label}
            >
              <Icon name={s.icon} />
              {s.label}
            </Link>
          ))}
          <span className="q-underline-nav-spacer" />
          <Link to="/import" className="q-btn q-btn--sm nav-import" current={section === 'Import'}>
            <Icon name="import" />
            Import
          </Link>
        </nav>
      </header>
      <main className="page q-container q-container--md" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

/** The search query a location carries in its q parameter, or ''. */
export function queryOf(location: Location): string {
  return new URLSearchParams(location.search).get('q') ?? '';
}

/** The search mode a location carries in its mode parameter: 'hybrid', or none. */
export function modeOf(location: Location): SearchMode | undefined {
  return new URLSearchParams(location.search).get('mode') === 'hybrid' ? 'hybrid' : undefined;
}

/** The website: one page per path. */
export function App() {
  const location = useLocation();
  const { path } = location;
  if (path === '/signin') return <SignIn />;
  let page: ReactNode = <p>{path}</p>;
  if (path === '/') page = <Stream />;
  else if (path === '/settings') page = <Settings />;
  else if (path === '/workspaces') page = <Workspaces />;
  else if (path === '/expired')
    page = <Expired query={queryOf(location)} mode={modeOf(location)} />;
  else if (path === '/archive')
    page = <Archive query={queryOf(location)} mode={modeOf(location)} />;
  else if (path === '/ask') page = <Ask />;
  else if (path === '/search') page = <Search query={queryOf(location)} mode={modeOf(location)} />;
  else if (path === '/topics') page = <Topics />;
  else if (path === '/tags') page = <Tags />;
  else if (path === '/import') page = <Import />;
  else if (path.startsWith('/workspaces/')) {
    const id = decodeURIComponent(path.slice('/workspaces/'.length));
    page = <WorkspacePage key={id} id={id} />;
  } else if (path.startsWith('/links/')) {
    const [rawId = '', view] = path.slice('/links/'.length).split('/');
    const id = decodeURIComponent(rawId);
    if (view === 'read') page = <Read key={id} id={id} />;
    else if (view === 'snapshot') page = <Snapshot key={id} id={id} />;
    else page = <LinkDetail key={id} id={id} />;
  }
  return <Layout location={location}>{page}</Layout>;
}

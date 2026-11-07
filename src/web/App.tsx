import { useEffect, useState, type ReactNode } from 'react';
import { Archive } from './pages/Archive';
import { LinkDetail } from './pages/LinkDetail';
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
}: {
  to: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={to}
      className={className}
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

/** The frame of every signed-in page: the navigation, the search box and the page's content. */
function Layout({ location, children }: { location: Location; children: ReactNode }) {
  return (
    <>
      <header className="nav">
        <Link to="/" className="brand">
          Alexandria
        </Link>
        <SearchBox location={location} />
        <nav>
          <Link to="/workspaces">Workspaces</Link>
          <Link to="/topics">Topics</Link>
          <Link to="/tags">Tags</Link>
          <Link to="/archive">Archive</Link>
          <Link to="/settings">Settings</Link>
          <form method="post" action="/auth/signout">
            <button type="submit" className="link-button">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <main className="page" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}

/** The search query a location carries in its q parameter, or ''. */
export function queryOf(location: Location): string {
  return new URLSearchParams(location.search).get('q') ?? '';
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
  else if (path === '/archive') page = <Archive query={queryOf(location)} />;
  else if (path === '/search') page = <Search query={queryOf(location)} />;
  else if (path === '/topics') page = <Topics />;
  else if (path === '/tags') page = <Tags />;
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

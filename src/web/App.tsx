import { useEffect, useState, type ReactNode } from 'react';
import { Archive } from './pages/Archive';
import { LinkDetail } from './pages/LinkDetail';
import { Icon, Mark, type IconName } from './components/Icon';
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
  current = false,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  /** Marks the link as the page being shown. */
  current?: boolean;
}) {
  return (
    <a
      href={to}
      className={className}
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
  { to: '/archive', label: 'Archive', icon: 'archive' },
];

/** The section a path belongs to, for the breadcrumb and the active navigation item. */
function sectionOf(path: string): string {
  if (path === '/settings') return 'Settings';
  if (path === '/search') return 'Search';
  if (path.startsWith('/links/')) return 'Link';
  const match = SECTIONS.filter((s) => s.to !== '/' && path.startsWith(s.to));
  return match[0]?.label ?? 'Stream';
}

/** One item of the navigation, marked as the current page when it is. */
function NavItem({
  to,
  icon,
  current,
  children,
}: {
  to: string;
  icon: IconName;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={current ? 'nav-item current' : 'nav-item'} current={current}>
      <Icon name={icon} />
      {children}
    </Link>
  );
}

/**
 * The frame of every signed-in page: the sidebar with the navigation, and
 * beside it the top bar (where you are, and the search box) over the page.
 */
function Layout({ location, children }: { location: Location; children: ReactNode }) {
  const section = sectionOf(location.path);
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <Mark />
          <span>Alexandria</span>
        </Link>
        <nav className="nav">
          <p className="nav-group">Library</p>
          {SECTIONS.map((s) => (
            <NavItem key={s.to} to={s.to} icon={s.icon} current={section === s.label}>
              {s.label}
            </NavItem>
          ))}
          <p className="nav-group">Account</p>
          <NavItem to="/settings" icon="settings" current={section === 'Settings'}>
            Settings
          </NavItem>
          <form method="post" action="/auth/signout">
            <button type="submit" className="nav-item">
              <Icon name="signout" />
              Sign out
            </button>
          </form>
        </nav>
      </aside>
      <div className="content">
        <header className="topbar">
          <p className="crumbs">
            <Icon name="home" size={16} />
            <span className="muted">Alexandria</span>
            <span className="muted" aria-hidden="true">
              /
            </span>
            <span>{section}</span>
          </p>
          <SearchBox location={location} />
        </header>
        <main className="page" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
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

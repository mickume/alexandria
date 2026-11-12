import { useEffect, useState, type ReactNode, type ComponentProps } from 'react';
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
import { Stats } from './pages/Stats';
import { Stream } from './pages/Stream';
import { Tags } from './pages/Tags';
import { Topics } from './pages/Topics';
import { WorkspacePage } from './pages/Workspace';
import { Workspaces } from './pages/Workspaces';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/sonner';
import { ConfirmProvider } from './confirm';

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

/**
 * A link within the website, followed without a reload. It takes an anchor's
 * other properties too, so that it can be an item of a menu.
 */
export function Link({
  to,
  children,
  current = false,
  onClick,
  ...anchor
}: Omit<ComponentProps<'a'>, 'href'> & {
  to: string;
  children: ReactNode;
  /** Marks the link as the page being shown. */
  current?: boolean;
}) {
  return (
    <a
      {...anchor}
      href={to}
      aria-current={current ? 'page' : undefined}
      onClick={(e) => {
        onClick?.(e);
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
  { to: '/stats', label: 'Stats', icon: 'stats' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

/** The section a path belongs to, for the current tab. */
function sectionOf(path: string): string {
  if (path === '/search') return 'Search';
  if (path === '/import') return 'Import';
  if (path.startsWith('/links/')) return 'Link';
  const match = SECTIONS.filter((s) => s.to !== '/' && path.startsWith(s.to));
  return match[0]?.label ?? 'Stream';
}

/**
 * The frame of every signed-in page: the header (on one line, the mark, a tab
 * per section, the search box, the Import button and signing out) above the
 * page.
 */
function Layout({ location, children }: { location: Location; children: ReactNode }) {
  const section = sectionOf(location.path);
  return (
    <div className="shell">
      <header className="site-header">
        <Link to="/" className="brand" aria-label="Alexandria" title="Alexandria">
          <Mark size={28} />
        </Link>
        <nav className="site-nav" aria-label="Sections">
          {SECTIONS.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className="site-nav-item"
              title={s.label}
              current={section === s.label}
            >
              <Icon name={s.icon} />
              <span className="site-nav-label">{s.label}</span>
            </Link>
          ))}
        </nav>
        <div className="site-header-actions">
          <SearchBox location={location} />
          <Link
            to="/import"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'nav-import')}
            current={section === 'Import'}
          >
            <Icon name="import" />
            Import
          </Link>
          <form method="post" action="/auth/signout">
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              title="Sign out"
            >
              <Icon name="signout" />
            </Button>
          </form>
        </div>
      </header>
      <main className="page" tabIndex={-1}>
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
  else if (path === '/stats') page = <Stats />;
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
  return (
    <ConfirmProvider>
      <Layout location={location}>{page}</Layout>
      <Toaster position="bottom-center" />
    </ConfirmProvider>
  );
}

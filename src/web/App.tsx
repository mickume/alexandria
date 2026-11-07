import { useEffect, useState, type ReactNode } from 'react';
import { Archive } from './pages/Archive';
import { LinkDetail } from './pages/LinkDetail';
import { Read, Snapshot } from './pages/Read';
import { Settings } from './pages/Settings';
import { SignIn } from './pages/SignIn';
import { Stream } from './pages/Stream';
import { Tags } from './pages/Tags';
import { Topics } from './pages/Topics';
import { WorkspacePage } from './pages/Workspace';
import { Workspaces } from './pages/Workspaces';

/** The current path of the page, following history navigation. */
export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

/** Moves to `path` within the website without a reload. */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
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

/** The frame of every signed-in page: the navigation and the page's content. */
function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="nav">
        <Link to="/" className="brand">
          Alexandria
        </Link>
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
      <main className="page">{children}</main>
    </>
  );
}

/** The website: one page per path. */
export function App() {
  const path = usePath();
  if (path === '/signin') return <SignIn />;
  let page: ReactNode = <p>{path}</p>;
  if (path === '/') page = <Stream />;
  else if (path === '/settings') page = <Settings />;
  else if (path === '/workspaces') page = <Workspaces />;
  else if (path === '/archive') page = <Archive />;
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
  return <Layout>{page}</Layout>;
}

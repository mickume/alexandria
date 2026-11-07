import { useEffect, useState } from 'react';
import { SignIn } from './pages/SignIn';

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

/** The website: one page per path. */
export function App() {
  const path = usePath();
  if (path === '/signin') return <SignIn />;
  return (
    <main className="page">
      <h1>Alexandria</h1>
      <p>{path}</p>
    </main>
  );
}

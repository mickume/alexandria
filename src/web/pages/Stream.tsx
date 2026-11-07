import { useEffect, useState } from 'react';
import { links as linksApi, type Link } from '../api';
import { AddLinks } from '../components/AddLinks';

/** Puts `fresh` links on top, newest use first, removing their earlier places. */
function withOnTop(current: Link[], fresh: Link[]): Link[] {
  const ids = new Set(fresh.map((l) => l.id));
  const top = [...fresh].sort((a, b) => (a.last_used_at < b.last_used_at ? 1 : -1));
  return [...top, ...current.filter((l) => !ids.has(l.id))];
}

/** The stream: the home page. */
export function Stream() {
  const [items, setItems] = useState<Link[]>([]);

  useEffect(() => {
    let live = true;
    linksApi
      .list()
      .then((page) => live && setItems(page.items))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="stream">
      <AddLinks onAdded={(fresh) => setItems((current) => withOnTop(current, fresh))} />
      <div className="cards">
        {items.map((link) => (
          <article key={link.id} className="card" aria-label={link.title}>
            <h2 className="card-title">{link.title}</h2>
            <span className="state">{link.state}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

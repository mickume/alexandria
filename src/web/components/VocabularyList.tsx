import { useEffect, useState } from 'react';
import { Link as PageLink } from '../App';
import {
  filterQuery,
  searchPath,
  vocabulary,
  type VocabularyItem,
  type VocabularyKind,
} from '../api';

const FILTER: Record<VocabularyKind, 'topic' | 'tag'> = { topics: 'topic', tags: 'tag' };

/**
 * The Topics or Tags page: every topic or tag with its number of links,
 * newest first, each opening the search for its filter.
 */
export function VocabularyList({ kind, title }: { kind: VocabularyKind; title: string }) {
  const [items, setItems] = useState<VocabularyItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    vocabulary
      .listAll(kind)
      .then((list) => live && setItems(list))
      .catch(() => live && setError(`could not load the ${kind}`));
    return () => {
      live = false;
    };
  }, [kind]);

  return (
    <section className="vocabulary">
      <h1>{title}</h1>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {items && items.length === 0 && <p className="muted">No {kind} yet.</p>}
      {items && items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Links</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <PageLink to={searchPath(filterQuery(FILTER[kind], item.name))}>
                    {item.name}
                  </PageLink>
                </td>
                <td className="count">{item.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link as PageLink } from '../App';
import {
  ApiError,
  filterQuery,
  searchPath,
  vocabulary,
  type VocabularyItem,
  type VocabularyKind,
} from '../api';

const FILTER: Record<VocabularyKind, 'topic' | 'tag'> = { topics: 'topic', tags: 'tag' };

/** What a row is doing: showing its actions, renaming, or merging. */
type Mode = 'idle' | 'rename' | 'merge';

/** One topic or tag: its name opening its search, its count, Rename and Merge. */
function Row({
  kind,
  item,
  others,
  onChanged,
  onError,
}: {
  kind: VocabularyKind;
  item: VocabularyItem;
  others: VocabularyItem[];
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [mode, setMode] = useState<Mode>('idle');
  const [name, setName] = useState(item.name);
  const [into, setInto] = useState(others[0]?.id ?? '');

  async function act(run: () => Promise<unknown>) {
    onError(null);
    try {
      await run();
      setMode('idle');
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'could not save, try again');
    }
  }

  return (
    <tr>
      <td>
        <PageLink to={searchPath(filterQuery(FILTER[kind], item.name))}>{item.name}</PageLink>
      </td>
      <td className="count">{item.count}</td>
      <td className="actions">
        {mode === 'idle' && (
          <>
            <button type="button" className="link-button" onClick={() => setMode('rename')}>
              Rename
            </button>
            {others.length > 0 && (
              <button type="button" className="link-button" onClick={() => setMode('merge')}>
                Merge
              </button>
            )}
          </>
        )}
        {mode === 'rename' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(() => vocabulary.rename(kind, item.id, name));
            }}
          >
            <input
              aria-label="New name"
              value={name}
              maxLength={kind === 'tags' ? 50 : 100}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit">Save</button>
            <button type="button" className="link-button" onClick={() => setMode('idle')}>
              Cancel
            </button>
          </form>
        )}
        {mode === 'merge' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(() => vocabulary.merge(kind, item.id, into));
            }}
          >
            <select aria-label="Merge into" value={into} onChange={(e) => setInto(e.target.value)}>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <button type="submit">Merge into it</button>
            <button type="button" className="link-button" onClick={() => setMode('idle')}>
              Cancel
            </button>
          </form>
        )}
      </td>
    </tr>
  );
}

/**
 * The Topics or Tags page: every topic or tag with its number of links,
 * newest first, each opening the search for its filter, with Rename and Merge.
 */
export function VocabularyList({ kind, title }: { kind: VocabularyKind; title: string }) {
  const [items, setItems] = useState<VocabularyItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let live = true;
    vocabulary
      .listAll(kind)
      .then((list) => live && setItems(list))
      .catch(() => live && setError(`could not load the ${kind}`));
    return () => {
      live = false;
    };
  }, [kind]);

  useEffect(load, [load]);

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
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Row
                key={`${item.id}-${item.name}`}
                kind={kind}
                item={item}
                others={items.filter((o) => o.id !== item.id)}
                onChanged={load}
                onError={setError}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

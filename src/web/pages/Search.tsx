import { useEffect, useState } from 'react';
import { Link as PageLink } from '../App';
import {
  activeFilters,
  ApiError,
  links as linksApi,
  search,
  type Link,
  type SearchMode,
  type SearchResults,
  type Segment,
} from '../api';
import { LinkCard, type CardActions } from '../components/LinkCard';
import { Snippet } from '../components/Snippet';
import { Toast } from '../components/Toast';
import { useUndoableDelete } from './Stream';

/** The workspaces whose name, description or note matched. */
function WorkspaceResults({ workspaces }: { workspaces: SearchResults['workspaces'] }) {
  if (workspaces.length === 0) return null;
  return (
    <ul className="workspace-results q-box" aria-label="Matching workspaces">
      {workspaces.map((w) => (
        <li key={w.id} className="q-box-row">
          <PageLink to={`/workspaces/${w.id}`}>{w.name}</PageLink>
          <Snippet segments={w.snippet} />
        </li>
      ))}
    </ul>
  );
}

/** 'nothing found for <query>', with one chip per active filter. */
function NothingFound({ query }: { query: string }) {
  const filters = activeFilters(query);
  return (
    <div className="nothing-found q-blankslate">
      <p className="muted">nothing found for {query.trim()}</p>
      {filters.length > 0 && (
        <ul className="filter-chips" aria-label="Active filters">
          {filters.map((f) => (
            <li key={f} className="q-topic">
              {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The search's pages so far: the links, their snippets, the workspaces and the next cursor. */
interface Found {
  snippets: Map<string, Segment[]>;
  workspaces: SearchResults['workspaces'];
  next: string | null;
}

/** The results of a search: matching workspaces first, then each link's card with its snippet. */
export function Search({ query, mode }: { query: string; mode?: SearchMode }) {
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Link[]>([]);
  const deletes = useUndoableDelete(items, setItems);

  useEffect(() => {
    let live = true;
    search(query, undefined, mode)
      .then((page) => {
        if (!live) return;
        setError(null);
        setFound({
          snippets: new Map(page.items.map((i) => [i.link.id, i.snippet])),
          workspaces: page.workspaces,
          next: page.next_cursor,
        });
        setItems(page.items.map((i) => i.link));
      })
      .catch((err) => {
        if (!live) return;
        setFound(null);
        setError(err instanceof ApiError ? err.message : 'could not search, try again');
      });
    return () => {
      live = false;
    };
  }, [query, mode]);

  async function more() {
    if (!found?.next) return;
    try {
      const page = await search(query, found.next, mode);
      setFound({
        ...found,
        snippets: new Map([
          ...found.snippets,
          ...page.items.map((i) => [i.link.id, i.snippet] as const),
        ]),
        next: page.next_cursor,
      });
      setItems((current) => [...current, ...page.items.map((i) => i.link)]);
    } catch {
      setError('could not load more results, try again');
    }
  }

  /** Replaces a link's card with the link as the API now shows it. */
  function replace(link: Link) {
    setItems((current) => current.map((l) => (l.id === link.id ? link : l)));
  }

  const actions: CardActions = {
    onPin: (link) => void linksApi.pin(link.id).then(replace, () => setError('could not pin')),
    onUnpin: (link) =>
      void linksApi.unpin(link.id).then(replace, () => setError('could not unpin')),
    onDelete: deletes.remove,
  };

  return (
    <section className="search-results">
      <h1 className="visually-hidden">Search results</h1>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {found && <WorkspaceResults workspaces={found.workspaces} />}
      {found && items.length === 0 && found.workspaces.length === 0 && (
        <NothingFound query={query} />
      )}
      <ul className="results" aria-label="Results">
        {items.map((link) => (
          <li key={link.id}>
            <LinkCard link={link} actions={actions} />
            <Snippet segments={found?.snippets.get(link.id) ?? []} />
          </li>
        ))}
      </ul>
      {found?.next && (
        <button type="button" className="q-btn" onClick={() => void more()}>
          More results
        </button>
      )}
      <div className="toasts">
        {deletes.undoable.map((link) => (
          <Toast
            key={link.id}
            message={`Deleted ${link.title}`}
            action={{ label: 'Undo', onClick: () => deletes.undo(link.id) }}
          />
        ))}
        {deletes.failure && <Toast message={deletes.failure} />}
      </div>
    </section>
  );
}

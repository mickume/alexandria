import { useEffect, useState } from 'react';
import { Link as PageLink } from '../App';
import {
  activeFilters,
  ApiError,
  links as linksApi,
  search,
  topicFilter,
  vocabulary,
  type Link,
  type MatchKind,
  type SearchMode,
  type SearchResults,
  type Segment,
  type TopicItem,
} from '../api';
import { ByMeaning, KeywordOnlyNotice } from '../components/ByMeaning';
import { LinkCard, TopicPath, type CardActions } from '../components/LinkCard';
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

/** The names from the top of the tree down to the topic called `name` (ignoring case); [] for none. */
function pathOf(topics: TopicItem[], name: string): string[] {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const wanted = name.toLowerCase();
  let topic = topics.find((t) => t.name.toLowerCase() === wanted);
  const path: string[] = [];
  while (topic && path.length < 3) {
    path.unshift(topic.name);
    topic = topic.parent_id ? byId.get(topic.parent_id) : undefined;
  }
  return path;
}

/** The path of the topic a search filters on, as a breadcrumb; nothing while loading or for an unknown topic. */
function TopicBreadcrumb({ name }: { name: string }) {
  const [path, setPath] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    vocabulary
      .listAll('topics')
      .then((topics) => {
        if (live) setPath(pathOf(topics as TopicItem[], name));
      })
      .catch(() => {
        if (live) setPath([]);
      });
    return () => {
      live = false;
    };
  }, [name]);
  return path.length > 0 ? <TopicPath path={path} current /> : null;
}

/** The search's pages so far: the links, their snippets, the workspaces and the next cursor. */
interface Found {
  snippets: Map<string, Segment[]>;
  /** How each link was found, in a search by meaning. */
  matches: Map<string, MatchKind | undefined>;
  workspaces: SearchResults['workspaces'];
  next: string | null;
  /** Whether a search by meaning could use meaning. */
  meaning: SearchResults['meaning'];
}

/** The results of a search: matching workspaces first, then each link's card with its snippet. */
export function Search({ query, mode }: { query: string; mode?: SearchMode }) {
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Link[]>([]);
  const deletes = useUndoableDelete(items, setItems);
  const topic = topicFilter(query);

  useEffect(() => {
    let live = true;
    search(query, undefined, mode)
      .then((page) => {
        if (!live) return;
        setError(null);
        setFound({
          snippets: new Map(page.items.map((i) => [i.link.id, i.snippet])),
          matches: new Map(page.items.map((i) => [i.link.id, i.match])),
          workspaces: page.workspaces,
          next: page.next_cursor,
          meaning: page.meaning,
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
        matches: new Map([
          ...found.matches,
          ...page.items.map((i) => [i.link.id, i.match] as const),
        ]),
        next: page.next_cursor,
        meaning: page.meaning ?? found.meaning,
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
    onChanged: replace,
    onArchive: (link) =>
      void linksApi.archive(link.id).then(replace, () => setError('could not archive')),
    onUnarchive: (link) =>
      void linksApi.unarchive(link.id).then(replace, () => setError('could not unarchive')),
  };

  return (
    <section className="search-results">
      <h1 className="visually-hidden">Search results</h1>
      {topic && <TopicBreadcrumb key={topic.toLowerCase()} name={topic} />}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {found?.meaning === 'unavailable' && <KeywordOnlyNotice />}
      {found && <WorkspaceResults workspaces={found.workspaces} />}
      {found && items.length === 0 && found.workspaces.length === 0 && (
        <NothingFound query={query} />
      )}
      <ul className="results" aria-label="Results">
        {items.map((link) => (
          <li key={link.id}>
            <LinkCard link={link} actions={actions} />
            {found?.matches.get(link.id) === 'meaning' ? (
              <div className="match-row">
                <ByMeaning />
                <Snippet segments={found.snippets.get(link.id) ?? []} />
              </div>
            ) : (
              <Snippet segments={found?.snippets.get(link.id) ?? []} />
            )}
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

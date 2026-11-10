import { useEffect, useRef, useState } from 'react';
import { Link as PageLink } from '../App';
import {
  activeFilters,
  ApiError,
  filterQuery,
  links as linksApi,
  search,
  searchPath,
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
import { UndoToasts, useUndoableDelete } from '../undo';
import { Button } from '@/components/ui/button';
import { Badge, badgeVariants } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** The workspaces whose name, description or note matched. */
function WorkspaceResults({ workspaces }: { workspaces: SearchResults['workspaces'] }) {
  if (workspaces.length === 0) return null;
  return (
    <ul className="workspace-results list-box" aria-label="Matching workspaces">
      {workspaces.map((w) => (
        <li key={w.id} className="list-row">
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
    <div className="nothing-found blankslate">
      <p className="muted">nothing found for {query.trim()}</p>
      {filters.length > 0 && (
        <ul className="filter-chips" aria-label="Active filters">
          {filters.map((f) => (
            <li key={f}>
              <Badge variant="secondary">{f}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The topic called `name` (ignoring case), its names from the top of the tree down, and its children by name. */
function placeOf(
  topics: TopicItem[],
  name: string,
): { path: string[]; children: TopicItem[] } | null {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const wanted = name.toLowerCase();
  const found = topics.find((t) => t.name.toLowerCase() === wanted);
  if (!found) return null;
  const path: string[] = [];
  for (let t: TopicItem | undefined = found; t && path.length < 3;) {
    path.unshift(t.name);
    t = t.parent_id ? byId.get(t.parent_id) : undefined;
  }
  const children = topics
    .filter((t) => t.parent_id === found.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { path, children };
}

/**
 * Where the topic a search filters on sits in the tree: its path as a
 * breadcrumb, then its sub-topics, each opening its own links with the number
 * of links in and beneath it; nothing while loading or for an unknown topic.
 */
function TopicPlace({ name }: { name: string }) {
  const [place, setPlace] = useState<ReturnType<typeof placeOf>>(null);
  useEffect(() => {
    let live = true;
    vocabulary
      .listAll('topics')
      .then((topics) => {
        if (live) setPlace(placeOf(topics as TopicItem[], name));
      })
      .catch(() => {
        if (live) setPlace(null);
      });
    return () => {
      live = false;
    };
  }, [name]);
  if (!place) return null;
  return (
    <div className="topic-place">
      <TopicPath path={place.path} current />
      {place.children.length > 0 && (
        <ul className="subtopics" aria-label="Sub-topics">
          {place.children.map((child) => (
            <li key={child.id}>
              <PageLink
                to={searchPath(filterQuery('topic', child.name))}
                className={cn(badgeVariants({ variant: 'outline' }), 'topic label-link')}
              >
                {child.name}
              </PageLink>
              <span className="counter">{child.subtree_count}</span>
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

  /** Counts the searches, so that a page asked for one is not added to the next. */
  const searches = useRef(0);
  const loadingMore = useRef(false);

  useEffect(() => {
    let live = true;
    searches.current += 1;
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
        setItems([]);
        setError(err instanceof ApiError ? err.message : 'could not search, try again');
      });
    return () => {
      live = false;
    };
  }, [query, mode]);

  async function more() {
    if (!found?.next || loadingMore.current) return;
    loadingMore.current = true;
    const asked = searches.current;
    try {
      const page = await search(query, found.next, mode);
      if (asked !== searches.current) return;
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
      if (asked === searches.current) setError('could not load more results, try again');
    } finally {
      loadingMore.current = false;
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
      {topic && <TopicPlace key={topic.toLowerCase()} name={topic} />}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {found?.meaning === 'unavailable' && <KeywordOnlyNotice />}
      {found && <WorkspaceResults workspaces={found.workspaces} />}
      {found && deletes.shown.length === 0 && found.workspaces.length === 0 && (
        <NothingFound query={query} />
      )}
      <ul className="results" aria-label="Results">
        {deletes.shown.map((link) => (
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
        <Button type="button" variant="outline" onClick={() => void more()}>
          More results
        </Button>
      )}
      <UndoToasts deletes={deletes} />
    </section>
  );
}

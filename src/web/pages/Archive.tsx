import { useState } from 'react';
import { links, type Link, type SearchMode } from '../api';
import { ByMeaning, KeywordOnlyNotice } from '../components/ByMeaning';
import { LinkCard, type CardActions } from '../components/LinkCard';
import { useStateList } from '../stateList';
import { useUndoableDelete } from '../undo';

/**
 * The Archive page: the links the owner chose to keep, most recently archived
 * first, on the stream's card (dimmed, with the day each was archived, and
 * Unarchive where the stream offers Pin); with a query (from the search box),
 * the archived links matching it.
 */
export function Archive({ query = '', mode }: { query?: string; mode?: SearchMode }) {
  const { items, setItems, loaded, failed, byMeaning, keywordOnly } = useStateList(
    'archived',
    query,
    mode,
  );
  const [failure, setFailure] = useState<string | null>(null);
  const error = failure ?? (failed ? 'could not load the archive' : null);
  const setError = setFailure;
  const deletes = useUndoableDelete(items, setItems);

  async function unarchive(link: Link) {
    setError(null);
    try {
      await links.unarchive(link.id);
      setItems((current) => current.filter((l) => l.id !== link.id));
    } catch {
      setError('could not unarchive, try again');
    }
  }

  /** Replaces a link's card with the link as the API now shows it. */
  function replace(link: Link) {
    setItems((current) => current.map((l) => (l.id === link.id ? link : l)));
  }

  // An archived link cannot be pinned, and its card offers Unarchive instead of Pin.
  const actions: CardActions = {
    onPin: () => undefined,
    onUnpin: () => undefined,
    onDelete: deletes.remove,
    onChanged: replace,
    onUnarchive: (link) => void unarchive(link),
  };

  return (
    <section className="archive">
      <h1 className="visually-hidden">Archive</h1>
      <p className="muted">
        Links you chose to keep. They stay out of the stream and never expire; search and Ask still
        find them. Unarchive one to put it back in the stream.
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {keywordOnly && <KeywordOnlyNotice />}
      <div className="cards">
        {deletes.shown.map((link) => (
          <div key={link.id}>
            <LinkCard link={link} actions={actions} />
            {byMeaning.has(link.id) && (
              <div className="match-row">
                <ByMeaning />
              </div>
            )}
          </div>
        ))}
      </div>
      {loaded && deletes.shown.length === 0 && (
        <p className="muted">
          {query.trim() ? `nothing found for ${query.trim()}` : 'Nothing is archived.'}
        </p>
      )}
    </section>
  );
}

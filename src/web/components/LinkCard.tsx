import { useState } from 'react';
import { Link as PageLink } from '../App';
import { ApiError, links, openUrl, type Link } from '../api';
import { formatDate, formatWhen } from '../format';

/**
 * Refresh: asks the API to fetch the link again and shows that it is
 * refreshing, or why it was refused. `onRefreshing` hears of an accepted refresh.
 */
export function RefreshButton({
  link,
  onRefreshing,
}: {
  link: Link;
  onRefreshing?: (link: Link) => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  async function refresh() {
    setStatus(null);
    try {
      await links.refresh(link.id);
      setStatus('refreshing…');
      onRefreshing?.(link);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'could not refresh, try again');
    }
  }
  return (
    <>
      <button type="button" className="link-button" onClick={() => void refresh()}>
        Refresh
      </button>
      {status && (
        <span className="muted" role="status">
          {status}
        </span>
      )}
    </>
  );
}

/** A summary shown in two lines, with a control that shows all of it. */
function Summary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="summary">
      <p className={open ? 'summary-text' : 'summary-text clamped'}>{text}</p>
      {!open && (
        <button type="button" className="link-button" onClick={() => setOpen(true)}>
          more
        </button>
      )}
    </div>
  );
}

/** What a card's actions do; the stream page supplies them. */
export interface CardActions {
  onPin: (link: Link) => void;
  onUnpin: (link: Link) => void;
  onDelete: (link: Link) => void;
  /** A pinned card is being dragged. */
  onDragStart?: (link: Link) => void;
  /** A dragged card was dropped on this pinned card. */
  onDropOn?: (link: Link) => void;
  /** A refresh of the card's link was accepted. */
  onRefreshing?: (link: Link) => void;
}

/** One link in the stream: favicon, title, host, dates, state and actions. */
export function LinkCard({ link, actions }: { link: Link; actions: CardActions }) {
  const open = openUrl(link.id);
  return (
    <article
      className={link.pinned ? 'card pinned' : 'card'}
      aria-label={link.title}
      draggable={link.pinned}
      onDragStart={link.pinned ? () => actions.onDragStart?.(link) : undefined}
      onDragOver={link.pinned ? (e) => e.preventDefault() : undefined}
      onDrop={
        link.pinned
          ? (e) => {
              e.preventDefault();
              actions.onDropOn?.(link);
            }
          : undefined
      }
    >
      <div className="card-head">
        {link.favicon_url && (
          <img className="favicon" src={link.favicon_url} alt="" width={16} height={16} />
        )}
        <a className="card-title" href={open}>
          {link.title}
        </a>
      </div>
      <div className="card-meta muted">
        <span>{link.host}</span>
        <span>Added {formatDate(link.added_at)}</span>
        <span>Used {formatWhen(link.last_used_at)}</span>
        <span className={`state state-${link.state}`}>
          {link.state === 'unreachable' && link.state_reason
            ? `unreachable: ${link.state_reason}`
            : link.state}
        </span>
        {link.notes.map((note) => (
          <span key={note} className="note">
            {note}
          </span>
        ))}
      </div>
      {link.summary && <Summary text={link.summary} />}
      {(link.tags.length > 0 || link.topic) && (
        <div className="card-labels">
          {link.topic && <span className="topic">{link.topic}</span>}
          {link.tags.length > 0 && (
            <ul className="tags" aria-label="Tags">
              {link.tags.map((tag) => (
                <li key={tag} className="chip">
                  {tag}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="card-actions">
        <a className="link-button" href={open}>
          Open
        </a>
        {link.has_snapshot && (
          <>
            <PageLink to={`/links/${link.id}/read`} className="link-button">
              Read
            </PageLink>
            <PageLink to={`/links/${link.id}/snapshot`} className="link-button">
              Snapshot
            </PageLink>
          </>
        )}
        <PageLink to={`/links/${link.id}`} className="link-button">
          Details
        </PageLink>
        {link.pinned ? (
          <button type="button" className="link-button" onClick={() => actions.onUnpin(link)}>
            Unpin
          </button>
        ) : (
          <button type="button" className="link-button" onClick={() => actions.onPin(link)}>
            Pin
          </button>
        )}
        <RefreshButton link={link} onRefreshing={actions.onRefreshing} />
        <button type="button" className="link-button" onClick={() => actions.onDelete(link)}>
          Delete
        </button>
      </div>
    </article>
  );
}

import { Link as PageLink } from '../App';
import { openUrl, type Link } from '../api';
import { formatDate, formatWhen } from '../format';

/** What a card's actions do; the stream page supplies them. */
export interface CardActions {
  onPin: (link: Link) => void;
  onUnpin: (link: Link) => void;
  onDelete: (link: Link) => void;
  /** A pinned card is being dragged. */
  onDragStart?: (link: Link) => void;
  /** A dragged card was dropped on this pinned card. */
  onDropOn?: (link: Link) => void;
}

/** One link in the stream: favicon, title, host, dates, state and actions. */
export function LinkCard({
  link,
  actions,
}: {
  link: Link & { favicon_url?: string | null };
  actions: CardActions;
}) {
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
        <span className={`state state-${link.state}`}>{link.state}</span>
      </div>
      <div className="card-actions">
        <a className="link-button" href={open}>
          Open
        </a>
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
        <button type="button" className="link-button" onClick={() => actions.onDelete(link)}>
          Delete
        </button>
      </div>
    </article>
  );
}

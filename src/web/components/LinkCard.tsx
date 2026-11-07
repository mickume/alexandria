import { useState, type DragEvent } from 'react';
import { Link as PageLink } from '../App';
import { ApiError, links, openUrl, type Link } from '../api';
import { formatDate, formatWhen } from '../format';
import { WorkspacePicker } from './WorkspacePicker';

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

/** 'enrichment failed' and the action that runs it again. */
function EnrichmentFailed({ link, onQueued }: { link: Link; onQueued?: (link: Link) => void }) {
  const [status, setStatus] = useState<string | null>(null);
  async function rerun() {
    try {
      await links.enrich(link.id);
      setStatus('queued for enrichment');
      onQueued?.(link);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'could not re-run, try again');
    }
  }
  return (
    <div className="enrichment-failed">
      <span className="notice">enrichment failed</span>
      {status ? (
        <span className="muted" role="status">
          {status}
        </span>
      ) : (
        <button type="button" className="link-button" onClick={() => void rerun()}>
          re-run enrichment
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
  /** On a workspace's page: take the link out of the workspace. */
  onRemoveFromWorkspace?: (link: Link) => void;
  /** Archive the link by hand. */
  onArchive?: (link: Link) => void;
}

/** The workspaces a link is in, each a chip linking to the workspace's page. */
export function WorkspaceChips({ workspaces }: { workspaces: { id: string; name: string }[] }) {
  if (workspaces.length === 0) return null;
  return (
    <ul className="workspace-chips" aria-label="Workspaces">
      {workspaces.map((w) => (
        <li key={w.id}>
          <PageLink to={`/workspaces/${w.id}`} className="chip">
            {w.name}
          </PageLink>
        </li>
      ))}
    </ul>
  );
}

/** What the card says about the link: host, dates, state with its reason, and notes. */
function CardMeta({ link }: { link: Link }) {
  return (
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
      {link.state === 'dormant' && <span className="decay-note">{link.decay_note}</span>}
      {link.dead_since && (
        <span className="dead">
          dead since {link.dead_since.slice(0, 10)}
          {link.last_check_result ? ` (${link.last_check_result})` : ''}
        </span>
      )}
      {link.sticky && <span className="sticky-label">sticky</span>}
    </div>
  );
}

/** The topic and one chip per tag. */
function Labels({ link }: { link: Link }) {
  if (link.tags.length === 0 && !link.topic) return null;
  return (
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
  );
}

/** Pinned cards can be dragged and dropped on: the handlers that do it. */
function pinDragProps(link: Link, actions: CardActions) {
  if (!link.pinned) return { draggable: false };
  return {
    draggable: true,
    onDragStart: () => actions.onDragStart?.(link),
    onDragOver: (e: DragEvent) => e.preventDefault(),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      actions.onDropOn?.(link);
    },
  };
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

/** One link in the stream: favicon, title, host, dates, state and actions. */
export function LinkCard({ link, actions }: { link: Link; actions: CardActions }) {
  const open = openUrl(link.id);
  const [memberOf, setMemberOf] = useState(link.workspaces);
  return (
    <article
      className={['card', link.pinned && 'pinned', link.state === 'dormant' && 'dormant']
        .filter(Boolean)
        .join(' ')}
      aria-label={link.title}
      {...pinDragProps(link, actions)}
    >
      {link.note_preview && <p className="note-preview">{link.note_preview}</p>}
      <div className="card-head">
        {link.favicon_url && (
          <img className="favicon" src={link.favicon_url} alt="" width={16} height={16} />
        )}
        <a
          className="card-title"
          href={open}
          style={link.dead_since ? { textDecoration: 'line-through' } : undefined}
        >
          {link.title}
        </a>
      </div>
      <CardMeta link={link} />
      {link.summary && <Summary text={link.summary} />}
      {link.enrichment_status === 'failed' && (
        <EnrichmentFailed link={link} onQueued={actions.onRefreshing} />
      )}
      <Labels link={link} />
      <WorkspaceChips workspaces={memberOf} />
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
        <button
          type="button"
          className="link-button"
          onClick={() => (link.pinned ? actions.onUnpin(link) : actions.onPin(link))}
        >
          {link.pinned ? 'Unpin' : 'Pin'}
        </button>
        <RefreshButton link={link} onRefreshing={actions.onRefreshing} />
        <WorkspacePicker
          linkId={link.id}
          memberOf={memberOf.map((w) => w.id)}
          onAdded={(w) =>
            setMemberOf((current) => [...current, { id: w.id, name: w.name }].sort(byName))
          }
        />
        {actions.onRemoveFromWorkspace && (
          <button
            type="button"
            className="link-button"
            onClick={() => actions.onRemoveFromWorkspace?.(link)}
          >
            Remove from workspace
          </button>
        )}
        {actions.onArchive && (
          <button type="button" className="link-button" onClick={() => actions.onArchive?.(link)}>
            Archive
          </button>
        )}
        <button type="button" className="link-button" onClick={() => actions.onDelete(link)}>
          Delete
        </button>
      </div>
    </article>
  );
}

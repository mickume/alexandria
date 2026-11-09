import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from 'react';
import { Link as PageLink } from '../App';
import { ApiError, links, openUrl, type Link } from '../api';
import { byName, formatDate, formatWhen } from '../format';
import { Icon } from './Icon';
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
      <button type="button" className="q-btn-link" onClick={() => void refresh()}>
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

/**
 * A summary shown in two lines, with a control that shows all of it. The
 * control is left out once the text is seen to fit in the two lines; where
 * nothing can be measured, it stays.
 */
function Summary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [fits, setFits] = useState(false);
  const paragraph = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const p = paragraph.current;
    if (open || !p) return;
    const measure = () => setFits(p.clientHeight > 0 && p.scrollHeight <= p.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(p);
    return () => observer.disconnect();
  }, [open, text]);

  return (
    <div className="summary">
      <p ref={paragraph} className={open ? 'summary-text' : 'summary-text clamped'}>
        {text}
      </p>
      {!open && !fits && (
        <button type="button" className="q-btn-link" onClick={() => setOpen(true)}>
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
        <button type="button" className="q-btn-link" onClick={() => void rerun()}>
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
          <PageLink to={`/workspaces/${w.id}`} className="q-label">
            {w.name}
          </PageLink>
        </li>
      ))}
    </ul>
  );
}

/** A link to the site itself, through the open route so the visit counts as a use, in a new tab. */
export function SiteLink({
  link,
  className,
  style,
  children,
}: {
  link: Link;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <a
      className={className}
      href={openUrl(link.id)}
      target="_blank"
      rel="noopener noreferrer"
      style={style}
    >
      {children}
    </a>
  );
}

/**
 * The ⋯ button and the actions behind it. A disclosure, not an ARIA menu, so
 * what it holds keeps its own roles. It closes on Escape, giving the focus
 * back to the button, on a click elsewhere, and once an action is chosen;
 * a control marked `data-keep-open` (Refresh, the workspace picker) leaves
 * it open, to show what it did.
 */
function CardMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function outside(e: MouseEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  return (
    <div
      className="card-menu"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="q-btn q-btn--sm q-btn--invisible q-btn--icon card-menu-button"
        aria-label="More actions"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div
          id={id}
          className="card-menu-panel q-overlay q-menu"
          onClick={(e) => {
            const chosen = (e.target as Element).closest('a, button');
            if (chosen && !chosen.closest('[data-keep-open]')) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** What the card says about the link: host, dates, state with its reason, and notes. */
function CardMeta({ link }: { link: Link }) {
  return (
    <div className="card-meta muted">
      <SiteLink link={link} className="card-host">
        {link.host}
      </SiteLink>
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
      {link.topic && <span className="topic q-label">{link.topic}</span>}
      {link.tags.length > 0 && (
        <ul className="tags" aria-label="Tags">
          {link.tags.map((tag) => (
            <li key={tag} className="q-topic">
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

/**
 * One link in the stream, as a row of a list: title and actions, then host,
 * dates and state, the summary, and the labels.
 */
export function LinkCard({ link, actions }: { link: Link; actions: CardActions }) {
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
      <div className="card-top">
        <div className="card-head">
          {link.favicon_url && (
            <img
              className="favicon"
              src={link.favicon_url}
              alt=""
              width={16}
              height={16}
              // A site without a usable icon shows none rather than a broken image.
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
          <SiteLink
            link={link}
            className="card-title"
            style={link.dead_since ? { textDecoration: 'line-through' } : undefined}
          >
            {link.title}
          </SiteLink>
        </div>
        <div className="card-actions">
          <SiteLink link={link} className="q-btn q-btn--sm q-btn--invisible">
            Open
          </SiteLink>
          {link.has_snapshot && (
            <PageLink to={`/links/${link.id}/read`} className="q-btn q-btn--sm q-btn--invisible">
              Read
            </PageLink>
          )}
          <button
            type="button"
            className="q-btn q-btn--sm q-btn--invisible"
            onClick={() => (link.pinned ? actions.onUnpin(link) : actions.onPin(link))}
          >
            {link.pinned ? 'Unpin' : 'Pin'}
          </button>
          <CardMenu>
            {link.has_snapshot && (
              <PageLink to={`/links/${link.id}/snapshot`} className="q-menu-item">
                Snapshot
              </PageLink>
            )}
            <PageLink to={`/links/${link.id}`} className="q-menu-item">
              Details
            </PageLink>
            <span className="card-menu-item" data-keep-open>
              <RefreshButton link={link} onRefreshing={actions.onRefreshing} />
            </span>
            <span className="card-menu-item" data-keep-open>
              <WorkspacePicker
                linkId={link.id}
                memberOf={memberOf.map((w) => w.id)}
                onAdded={(w) =>
                  setMemberOf((current) => [...current, { id: w.id, name: w.name }].sort(byName))
                }
              />
            </span>
            {actions.onRemoveFromWorkspace && (
              <button
                type="button"
                className="q-menu-item"
                onClick={() => actions.onRemoveFromWorkspace?.(link)}
              >
                Remove from workspace
              </button>
            )}
            {actions.onArchive && (
              <button
                type="button"
                className="q-menu-item"
                onClick={() => actions.onArchive?.(link)}
              >
                Archive
              </button>
            )}
            <button
              type="button"
              className="q-menu-item q-menu-item--danger"
              onClick={() => actions.onDelete(link)}
            >
              Delete
            </button>
          </CardMenu>
        </div>
      </div>
      <CardMeta link={link} />
      {link.summary && <Summary text={link.summary} />}
      {link.enrichment_status === 'failed' && (
        <EnrichmentFailed link={link} onQueued={actions.onRefreshing} />
      )}
      <Labels link={link} />
      <WorkspaceChips workspaces={memberOf} />
    </article>
  );
}

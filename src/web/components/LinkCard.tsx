import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from 'react';
import { Link as PageLink } from '../App';
import { ApiError, filterQuery, links, openUrl, searchPath, type Link } from '../api';
import { StatusButton, type ButtonLook } from './CheckButton';
import { byName, formatDate, formatWhen } from '../format';
import { Icon } from './Icon';
import { WorkspacePicker } from './WorkspacePicker';
import { badgeVariants } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Refresh: asks the API to fetch the link again and says in a toast that it
 * is refreshing, or why it was refused. `onRefreshing` hears of an accepted refresh.
 */
export function RefreshButton({
  link,
  onRefreshing,
  ...look
}: ButtonLook & { link: Link; onRefreshing?: (link: Link) => void }) {
  return (
    <StatusButton
      {...look}
      label="Refresh"
      failure="could not refresh, try again"
      run={async () => {
        await links.refresh(link.id);
        onRefreshing?.(link);
        return 'refreshing…';
      }}
    />
  );
}

/**
 * A summary shown in one line, with a control that shows all of it. The
 * control is left out once the text is seen to fit in the line; where
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
        <Button type="button" variant="link" className="h-auto p-0" onClick={() => setOpen(true)}>
          more
        </Button>
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
        <Button type="button" variant="link" className="h-auto p-0" onClick={() => void rerun()}>
          re-run enrichment
        </Button>
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
  /** The card's link changed (it joined a workspace): the link as the API now shows it. */
  onChanged?: (link: Link) => void;
  /** Archive the link: keep it for good, out of the stream. */
  onArchive?: (link: Link) => void;
  /** Bring an archived link back to the stream. */
  onUnarchive?: (link: Link) => void;
}

/** The workspaces a link is in, each a chip linking to the workspace's page. */
export function WorkspaceChips({ workspaces }: { workspaces: { id: string; name: string }[] }) {
  if (workspaces.length === 0) return null;
  return (
    <ul className="workspace-chips" aria-label="Workspaces">
      {workspaces.map((w) => (
        <li key={w.id}>
          <PageLink
            to={`/workspaces/${w.id}`}
            className={cn(badgeVariants({ variant: 'outline' }), 'workspace-chip')}
          >
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

/** The ⋯ button and the menu of the card's less frequent actions behind it. */
function CardMenu({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="card-menu-button"
          aria-label="More actions"
        >
          <Icon name="more" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
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
      <span className="decay-note">{link.decay_note}</span>
      {link.dead_since && (
        <span className="dead">
          dead since {link.dead_since.slice(0, 10)}
          {link.last_check_result ? ` (${link.last_check_result})` : ''}
        </span>
      )}
    </div>
  );
}

/**
 * A link's topic as a chip that opens the search for the topic's links, as on
 * the Topics page, with the topic's whole path as its tooltip.
 */
function TopicChip({ topic, path }: { topic: string; path: string[] }) {
  return (
    <PageLink
      to={searchPath(filterQuery('topic', topic))}
      className={cn(badgeVariants({ variant: 'outline' }), 'topic label-link')}
      title={path.length > 0 ? path.join(' › ') : undefined}
    >
      {topic}
    </PageLink>
  );
}

/**
 * A topic path as a breadcrumb, each name opening the search of its own topic;
 * with `current`, the last name is the page's own topic and opens nothing.
 */
export function TopicPath({ path, current = false }: { path: string[]; current?: boolean }) {
  return (
    <nav aria-label="Topic path" className="topic-path">
      {path.map((name, i) => (
        <span key={name}>
          {i > 0 && (
            <span className="topic-path-separator" aria-hidden="true">
              ›
            </span>
          )}
          {current && i === path.length - 1 ? (
            <span
              className={cn(badgeVariants({ variant: 'outline' }), 'topic')}
              aria-current="page"
            >
              {name}
            </span>
          ) : (
            <PageLink
              to={searchPath(filterQuery('topic', name))}
              className={cn(badgeVariants({ variant: 'outline' }), 'topic label-link')}
            >
              {name}
            </PageLink>
          )}
        </span>
      ))}
    </nav>
  );
}

/** One chip per tag, each opening the search for the tag's links, as on the Tags page. */
export function TagChips({ tags }: { tags: string[] }) {
  return (
    <ul className="tags" aria-label="Tags">
      {tags.map((tag) => (
        <li key={tag}>
          <PageLink
            to={searchPath(filterQuery('tag', tag))}
            className={cn(badgeVariants({ variant: 'secondary' }), 'label-link')}
          >
            {tag}
          </PageLink>
        </li>
      ))}
    </ul>
  );
}

/** The workspaces, the topic and the tags, in one row. */
function Labels({ link }: { link: Link }) {
  if (link.tags.length === 0 && !link.topic && link.workspaces.length === 0) return null;
  return (
    <div className="card-labels">
      <WorkspaceChips workspaces={link.workspaces} />
      {link.topic && <TopicChip topic={link.topic} path={link.topic_path} />}
      {link.tags.length > 0 && <TagChips tags={link.tags} />}
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
 * dates and state, the summary, and the labels. A pinned card shows a pin
 * where the site's icon would be. An archived card is dimmed and offers
 * Unarchive where other cards offer Pin.
 */
export function LinkCard({ link, actions }: { link: Link; actions: CardActions }) {
  const archived = link.state === 'archived';
  // Joining a workspace can change the decay note, so the card shows the link as the API
  // now has it; without it, the chips at least show the new workspace.
  const joined = (w: { id: string; name: string }) => {
    const local = {
      ...link,
      workspaces: [...link.workspaces, { id: w.id, name: w.name }].sort(byName),
    };
    void links.get(link.id).then(
      (fresh) => actions.onChanged?.(fresh),
      () => actions.onChanged?.(local),
    );
  };
  return (
    <article
      className={['card', link.pinned && 'pinned', archived && 'archived']
        .filter(Boolean)
        .join(' ')}
      aria-label={link.title}
      {...pinDragProps(link, actions)}
    >
      {link.note_preview && <p className="note-preview">{link.note_preview}</p>}
      <div className="card-top">
        <div className="card-head">
          {link.pinned ? (
            <span className="pin-mark" role="img" aria-label="Pinned">
              <Icon name="pin" size={14} />
            </span>
          ) : (
            link.favicon_url && (
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
            )
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
          <SiteLink link={link} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Open
          </SiteLink>
          {link.has_snapshot && (
            <PageLink
              to={`/links/${link.id}/read`}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              Read
            </PageLink>
          )}
          {archived ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => actions.onUnarchive?.(link)}
            >
              Unarchive
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => (link.pinned ? actions.onUnpin(link) : actions.onPin(link))}
            >
              {link.pinned ? 'Unpin' : 'Pin'}
            </Button>
          )}
          <CardMenu>
            {link.has_snapshot && (
              <DropdownMenuItem asChild>
                <PageLink to={`/links/${link.id}/snapshot`}>Snapshot</PageLink>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <PageLink to={`/links/${link.id}`}>Details</PageLink>
            </DropdownMenuItem>
            <RefreshButton link={link} onRefreshing={actions.onRefreshing} look="menu" />
            <WorkspacePicker
              submenu
              linkId={link.id}
              memberOf={link.workspaces.map((w) => w.id)}
              onAdded={joined}
            />
            {actions.onRemoveFromWorkspace && (
              <DropdownMenuItem onSelect={() => actions.onRemoveFromWorkspace?.(link)}>
                Remove from workspace
              </DropdownMenuItem>
            )}
            {!archived && actions.onArchive && (
              <DropdownMenuItem onSelect={() => actions.onArchive?.(link)}>
                Archive
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => actions.onDelete(link)}>
              Delete
            </DropdownMenuItem>
          </CardMenu>
        </div>
      </div>
      <CardMeta link={link} />
      {link.summary && <Summary text={link.summary} />}
      {link.enrichment_status === 'failed' && (
        <EnrichmentFailed link={link} onQueued={actions.onRefreshing} />
      )}
      <Labels link={link} />
    </article>
  );
}

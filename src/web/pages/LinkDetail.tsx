import { useEffect, useState } from 'react';
import { Link as PageLink, navigate } from '../App';
import { ApiError, links, workspaces, type Link, type LinkEvent } from '../api';
import { CheckButton } from '../components/CheckButton';
import { EditableField } from '../components/EditableField';
import { Icon } from '../components/Icon';
import { NoteEditor } from '../components/NoteEditor';
import { RefreshButton, SiteLink, TagChips, TopicChip } from '../components/LinkCard';
import { WorkspacePicker } from '../components/WorkspacePicker';
import { byName, formatDate } from '../format';

/** What the owner confirms before a link is deleted from its detail page. */
const CONFIRM_DELETE = 'Delete this link for good? Its note and its saved copy go with it.';

/** How one history event reads: "Opened", "Fetched", or "Fetch failed: HTTP 503". */
function eventLabel(event: LinkEvent): string {
  if (event.kind === 'use') return 'Opened';
  if (event.outcome === 'ok') return 'Fetched';
  return `Fetch failed: ${event.reason ?? 'unknown error'}`;
}

const DAY_MS = 86_400_000;

/**
 * How long the link has left, as the API's decay note reckons it: a pinned
 * link, an archived one or one in a workspace never expires, an expired one is removed on its
 * removal date, and any other expires once its points, a day each, run out.
 */
function daysLeft(link: Link, now: number = Date.now()): string {
  const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
  if (link.state === 'expired' && link.removal_at) {
    const left = Math.max(0, Math.ceil((Date.parse(link.removal_at) - now) / DAY_MS));
    return `expired: removed in ${days(left)}`;
  }
  if (link.points === null) return 'never expires: archived';
  if (link.pinned) return 'never expires: pinned';
  if (link.workspaces.length > 0) return 'never expires: in a workspace';
  if (link.points <= 0) return 'expires today';
  return `${days(link.points)} left`;
}

/** What is known about the link: its addresses, the fetch's answer, its state and notes. */
function Facts({ link }: { link: Link }) {
  return (
    <dl className="facts">
      <dt>Original URL</dt>
      <dd>{link.original_url}</dd>
      <dt>URL</dt>
      <dd>{link.url}</dd>
      {link.final_url && (
        <>
          <dt>Final URL</dt>
          <dd>{link.final_url}</dd>
        </>
      )}
      {link.http_status !== null && (
        <>
          <dt>Response</dt>
          <dd>HTTP {link.http_status}</dd>
        </>
      )}
      <dt>State</dt>
      <dd>
        {link.state}
        {link.state_reason && `: ${link.state_reason}`}
      </dd>
      {link.notes.length > 0 && (
        <>
          <dt>Notes</dt>
          <dd>
            {link.notes.map((note) => (
              <span key={note} className="note">
                {note}
              </span>
            ))}
          </dd>
        </>
      )}
    </dl>
  );
}

/**
 * The links nearest in meaning to this one, each opening its own detail page.
 * The section is always there: it says so while they load, when there are
 * none, and when they cannot be worked out.
 */
function RelatedLinks({ id }: { id: string }) {
  const [related, setRelated] = useState<Link[] | 'loading' | 'failed'>('loading');

  useEffect(() => {
    let live = true;
    links
      .related(id)
      .then((r) => live && setRelated(r.items))
      .catch(() => live && setRelated('failed'));
    return () => {
      live = false;
    };
  }, [id]);

  return (
    <>
      <hr />
      <section aria-labelledby="related-heading">
        <h2 id="related-heading">Related links</h2>
        {related === 'loading' ? (
          <p className="muted">Looking for related links…</p>
        ) : related === 'failed' ? (
          <p className="muted">Related links can’t be worked out right now.</p>
        ) : related.length === 0 ? (
          <p className="muted">Nothing in your library is near this link yet.</p>
        ) : (
          <ul className="related-links" aria-label="Related links">
            {related.map((r) => (
              <li key={r.id}>
                <PageLink to={`/links/${r.id}`}>{r.title}</PageLink>
                <span className="muted">{r.host}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * The side column of a link's detail page: its tags, topic and workspaces
 * (each workspace can be left), then the actions: refresh, check, pin or
 * unpin (unarchive, for an archived link), add to a workspace, archive, and
 * delete after a confirmation, which leaves for the stream.
 */
function Sidebar({ link, onChange }: { link: Link; onChange: (link: Link) => void }) {
  const [failure, setFailure] = useState<string | null>(null);

  async function act(what: string, run: () => Promise<void>) {
    setFailure(null);
    try {
      await run();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : `could not ${what}, try again`);
    }
  }

  const archived = link.state === 'archived';
  const toggleArchive = () =>
    act(archived ? 'unarchive' : 'archive', async () =>
      onChange(await (archived ? links.unarchive(link.id) : links.archive(link.id))),
    );

  const togglePin = () =>
    act(link.pinned ? 'unpin' : 'pin', async () =>
      onChange(await (link.pinned ? links.unpin(link.id) : links.pin(link.id))),
    );

  const leave = (workspace: { id: string; name: string }) =>
    act('remove the link from the workspace', async () => {
      await workspaces.removeLink(workspace.id, link.id);
      onChange({ ...link, workspaces: link.workspaces.filter((w) => w.id !== workspace.id) });
    });

  const remove = () => {
    if (!window.confirm(CONFIRM_DELETE)) return;
    void act('delete', async () => {
      await links.remove(link.id);
      navigate('/');
    });
  };

  return (
    <aside className="detail-side" aria-label="About this link">
      <EditableField link={link} field="tags" onSaved={onChange}>
        {link.tags.length > 0 && <TagChips tags={link.tags} />}
      </EditableField>
      <EditableField link={link} field="topic" onSaved={onChange}>
        {link.topic && <TopicChip topic={link.topic} />}
      </EditableField>
      <section className="field" aria-labelledby="workspaces-heading">
        <h2 id="workspaces-heading" className="field-head">
          Workspaces
        </h2>
        {link.workspaces.length === 0 ? (
          <span className="muted">none</span>
        ) : (
          <ul className="detail-workspaces" aria-label="Workspaces">
            {link.workspaces.map((w) => (
              <li key={w.id}>
                <PageLink to={`/workspaces/${w.id}`} className="q-label workspace-chip">
                  {w.name}
                </PageLink>
                <button
                  type="button"
                  className="q-btn q-btn--sm q-btn--invisible q-btn--icon"
                  aria-label={`Remove from ${w.name}`}
                  onClick={() => void leave(w)}
                >
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="q-menu detail-actions" role="group" aria-label="Actions">
        <RefreshButton link={link} className="q-menu-item" icon={<Icon name="refresh" />} />
        <CheckButton
          link={link}
          onChecked={onChange}
          className="q-menu-item"
          icon={<Icon name="pulse" />}
        />
        {archived ? (
          <button type="button" className="q-menu-item" onClick={() => void toggleArchive()}>
            <Icon name="archive" />
            Unarchive
          </button>
        ) : (
          <button type="button" className="q-menu-item" onClick={() => void togglePin()}>
            <Icon name="pin" />
            {link.pinned ? 'Unpin' : 'Pin'}
          </button>
        )}
        <WorkspacePicker
          linkId={link.id}
          memberOf={link.workspaces.map((w) => w.id)}
          className="q-menu-item"
          icon={<Icon name="workspaces" />}
          onAdded={(w) =>
            onChange({
              ...link,
              workspaces: [...link.workspaces, { id: w.id, name: w.name }].sort(byName),
            })
          }
        />
        {!archived && (
          <button type="button" className="q-menu-item" onClick={() => void toggleArchive()}>
            <Icon name="archive" />
            Archive
          </button>
        )}
        <button type="button" className="q-menu-item q-menu-item--danger" onClick={remove}>
          <Icon name="trash" />
          Delete
        </button>
      </div>
      {failure && (
        <p className="notice" role="alert">
          {failure}
        </p>
      )}
    </aside>
  );
}

/**
 * The detail page of one link, laid out as an issue is: the title across the
 * top; then its note, editable title and summary, when it was added and used,
 * the links related to it, its history and last its technical details on the left; and its tags,
 * topic, workspaces and actions in a narrower column on the right.
 */
export function LinkDetail({ id }: { id: string }) {
  const [link, setLink] = useState<Link | null>(null);
  const [history, setHistory] = useState<LinkEvent[]>([]);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    links
      .get(id)
      .then((l) => live && setLink(l))
      .catch(() => live && setMissing(true));
    links
      .history(id)
      .then((page) => live && setHistory(page.items))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);

  if (missing) return <p className="muted">This link is not in your library.</p>;
  if (!link) return null;
  return (
    <article className="detail">
      <h1>
        <SiteLink link={link}>{link.title}</SiteLink>
      </h1>
      <div className="detail-layout">
        <div className="detail-main">
          <NoteEditor
            note={link.note ?? ''}
            onSave={async (note) => setLink(await links.edit(link.id, { note }))}
          />
          <section className="editable">
            <EditableField link={link} field="title" onSaved={setLink} />
            <EditableField link={link} field="summary" onSaved={setLink} />
          </section>
          <p className="muted">
            <span>Added {formatDate(link.added_at)}</span> ·{' '}
            {link.fetched_at && <span>fetched {formatDate(link.fetched_at)} · </span>}
            <span>
              {link.use_count === 1 ? 'used once' : `used ${link.use_count} times`}
            </span> · <span>{daysLeft(link)}</span>
          </p>
          <RelatedLinks key={link.id} id={link.id} />
          <hr />
          <h2 id="history-heading">History</h2>
          <ul className="history" aria-label="History">
            {history.map((event, i) => (
              <li key={`${event.at}-${i}`}>
                {eventLabel(event)} · {formatDate(event.at)}
              </li>
            ))}
          </ul>
          <hr />
          <section aria-labelledby="facts-heading">
            <h2 id="facts-heading">Technical details</h2>
            <Facts link={link} />
          </section>
        </div>
        <Sidebar link={link} onChange={setLink} />
      </div>
    </article>
  );
}

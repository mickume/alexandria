import { useEffect, useState } from 'react';
import { links, openUrl, type Link, type LinkEvent } from '../api';
import { RefreshButton } from '../components/LinkCard';
import { formatDate } from '../format';

/** How one history event reads: "Opened", "Fetched", or "Fetch failed: HTTP 503". */
function eventLabel(event: LinkEvent): string {
  if (event.kind === 'use') return 'Opened';
  if (event.outcome === 'ok') return 'Fetched';
  return `Fetch failed: ${event.reason ?? 'unknown error'}`;
}

/** The detail page of one link: both URLs, when it was added, how often it was used, and when. */
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
        <a href={openUrl(link.id)}>{link.title}</a>
      </h1>
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
      <p className="muted">
        <span>Added {formatDate(link.added_at)}</span> ·{' '}
        {link.fetched_at && <span>fetched {formatDate(link.fetched_at)} · </span>}
        <span>{link.use_count === 1 ? 'used once' : `used ${link.use_count} times`}</span>
      </p>
      <div className="card-actions">
        <RefreshButton link={link} />
      </div>
      <h2 id="history-heading">History</h2>
      <ul className="history" aria-label="History">
        {history.map((event, i) => (
          <li key={`${event.at}-${i}`}>
            {eventLabel(event)} · {formatDate(event.at)}
          </li>
        ))}
      </ul>
    </article>
  );
}

import { useEffect, useState } from 'react';
import { links, openUrl, type Link, type LinkEvent } from '../api';
import { RefreshButton } from '../components/LinkCard';
import { formatDate } from '../format';

const EVENT_LABELS: Record<string, string> = { use: 'Opened' };

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
      </dl>
      <p className="muted">
        <span>Added {formatDate(link.added_at)}</span> ·{' '}
        <span>{link.use_count === 1 ? 'used once' : `used ${link.use_count} times`}</span>
      </p>
      <div className="card-actions">
        <RefreshButton link={link} />
      </div>
      <h2 id="history-heading">History</h2>
      <ul className="history" aria-label="History">
        {history.map((event, i) => (
          <li key={`${event.at}-${i}`}>
            {EVENT_LABELS[event.kind] ?? event.kind} {formatDate(event.at)}
          </li>
        ))}
      </ul>
    </article>
  );
}

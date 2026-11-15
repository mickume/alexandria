import createDOMPurify from 'dompurify';
import { useEffect, useState } from 'react';
import { Link as PageLink } from '../App';
import { links, snapshotFileUrl, type SnapshotView } from '../api';
import { openWebLinksInNewTab } from '../components/Markdown';
import { formatDate } from '../format';
import { buttonVariants } from '@/components/ui/button';

/** Loads one value for a page, and whether it failed. */
function useLoad<T>(load: () => Promise<T>, key: string): { value: T | null; failed: boolean } {
  const [state, setState] = useState<{ value: T | null; failed: boolean }>({
    value: null,
    failed: false,
  });
  useEffect(() => {
    let live = true;
    load()
      .then((value) => live && setState({ value, failed: false }))
      .catch(() => live && setState({ value: null, failed: true }));
    return () => {
      live = false;
    };
    // The page is keyed by its link, so `key` is the only input that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/** The snapshot's own sanitiser, whose web links open in a new tab. */
const purifier = createDOMPurify(window);
openWebLinksInNewTab(purifier);

/** The snapshot's article, sanitised again in the browser before it is shown. */
function SafeHtml({ html }: { html: string }) {
  const clean = purifier.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style'],
  });
  return <div className="reader-body" dangerouslySetInnerHTML={{ __html: clean }} />;
}

/**
 * The Read page: the link's snapshot, its article with the images stored with
 * it, or its PDF in the browser's viewer. Opening it counts as a use.
 */
export function Read({ id }: { id: string }) {
  const { value: snapshot, failed } = useLoad(() => links.snapshot(id), id);
  if (failed) {
    return (
      <p className="muted">
        No snapshot is stored for this link. <PageLink to={`/links/${id}`}>Details</PageLink>
      </p>
    );
  }
  if (!snapshot) return null;
  return <SnapshotContent id={id} snapshot={snapshot} />;
}

function SnapshotContent({ id, snapshot }: { id: string; snapshot: SnapshotView }) {
  const taken = (
    <p className="muted snapshot-taken">
      Snapshot taken {formatDate(snapshot.taken_at)}
      {snapshot.notes.map((note) => (
        <span key={note} className="note">
          {note}
        </span>
      ))}
    </p>
  );
  if (snapshot.content_kind === 'pdf') {
    return (
      <section className="snapshot">
        <h1>{snapshot.title}</h1>
        {taken}
        <a
          className={buttonVariants({ variant: 'outline' })}
          href={snapshotFileUrl(id, { download: true })}
        >
          Download
        </a>
        <object className="snapshot-frame" data={snapshotFileUrl(id)} type="application/pdf">
          <a href={snapshotFileUrl(id)}>Open the PDF</a>
        </object>
      </section>
    );
  }
  return (
    <article className="reader">
      <h1>{snapshot.title}</h1>
      {snapshot.byline && <p className="muted">{snapshot.byline}</p>}
      {taken}
      <SafeHtml html={snapshot.html ?? ''} />
    </article>
  );
}

import DOMPurify from 'dompurify';
import { useEffect, useState } from 'react';
import { Link as PageLink } from '../App';
import { links, snapshotUrl, type Link, type ReaderView } from '../api';

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

/** The reader view's HTML, sanitised again in the browser before it is shown. */
function SafeHtml({ html }: { html: string }) {
  const clean = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style'],
  });
  return <div className="reader-body" dangerouslySetInnerHTML={{ __html: clean }} />;
}

function ReaderContent({ id, reader }: { id: string; reader: ReaderView }) {
  if (reader.empty) {
    return (
      <>
        <p className="muted">no readable content extracted</p>
        <p>
          <PageLink to={`/links/${id}/snapshot`}>Snapshot</PageLink>
        </p>
      </>
    );
  }
  if (reader.content_kind === 'pdf' || reader.html === null) {
    return (
      <div className="reader-body">
        {reader.text
          .split(/\n\s*\n/)
          .map((block) => block.trim())
          .filter(Boolean)
          .map((block, i) => (
            <p key={i}>{block}</p>
          ))}
      </div>
    );
  }
  return <SafeHtml html={reader.html} />;
}

/** The Read page: the link's stored reader view. Opening it counts as a use. */
export function Read({ id }: { id: string }) {
  const { value: reader, failed } = useLoad(() => links.reader(id), id);
  if (failed) return <p className="muted">Nothing is stored to read for this link.</p>;
  if (!reader) return null;
  return (
    <article className="reader">
      <h1>{reader.title}</h1>
      {reader.byline && <p className="muted">{reader.byline}</p>}
      <ReaderContent id={id} reader={reader} />
    </article>
  );
}

/**
 * The Snapshot page: a web page's stored HTML in a frame that may do nothing
 * (no scripts, no forms, no access to the site), or a PDF in the browser's viewer.
 */
export function Snapshot({ id }: { id: string }) {
  const { value: link, failed } = useLoad<Link>(() => links.get(id), id);
  if (failed) return <p className="muted">This link is not in your library.</p>;
  if (!link) return null;
  return (
    <section className="snapshot">
      <h1>{link.title}</h1>
      {link.content_kind === 'pdf' ? (
        <>
          <a className="button" href={snapshotUrl(id, { download: true })}>
            Download
          </a>
          <object className="snapshot-frame" data={snapshotUrl(id)} type="application/pdf">
            <a href={snapshotUrl(id)}>Open the PDF</a>
          </object>
        </>
      ) : (
        <iframe className="snapshot-frame" sandbox="" src={snapshotUrl(id)} title={link.title} />
      )}
    </section>
  );
}

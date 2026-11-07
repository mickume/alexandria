import { useEffect, useState } from 'react';
import { imports, type ImportProgress as Progress, type ImportReport } from '../api';

/** How often the progress view asks how far the import's links are. */
export const POLL_MS = 5_000;

/**
 * Follows an import's progress every 5 seconds until no added link waits or
 * is being fetched, or the view is left. Before the first answer every added
 * link waits.
 */
function useProgress(report: ImportReport): Progress {
  const [progress, setProgress] = useState<Progress>({
    waiting: report.counts.added,
    in_progress: 0,
    done: 0,
    enriched: 0,
  });
  const running = progress.waiting > 0 || progress.in_progress > 0;
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => {
      imports
        .get(report.id)
        .then((r) => setProgress(r.progress))
        .catch(() => setProgress((p) => ({ ...p })));
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [report.id, running, progress]);
  return progress;
}

/** An import's report and the progress of its links, with the report to download. */
export function ImportProgress({ report }: { report: ImportReport }) {
  const progress = useProgress(report);
  const c = report.counts;
  return (
    <div className="import-progress">
      <ul className="import-counts">
        <li>added {c.added}</li>
        <li>duplicates {c.duplicates}</li>
        <li>invalid {c.invalid}</li>
      </ul>
      {report.stopped_at_limit && (
        <p className="notice">
          library full (20,000 links): stopped at line {report.stopped_at_limit.line},{' '}
          {c.not_imported} lines not imported
        </p>
      )}
      {report.invalid.length > 0 && (
        <ul className="import-lines" aria-label="Invalid lines">
          {report.invalid.map((l) => (
            <li key={l.line}>
              line {l.line}: {l.text}
            </li>
          ))}
        </ul>
      )}
      <ul className="import-counts muted" aria-label="Progress">
        <li>waiting {progress.waiting}</li>
        <li>in progress {progress.in_progress}</li>
        <li>done {progress.done}</li>
        <li>enriched {progress.enriched}</li>
      </ul>
      <a className="link-button" href={imports.reportUrl(report.id)} download>
        Download report
      </a>
    </div>
  );
}

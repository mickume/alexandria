import { useState, type FormEvent } from 'react';
import { ApiError, imports, type ImportReport } from '../api';
import { ImportProgress } from '../components/ImportProgress';

/** The Import section of the settings page: upload a list of URLs and follow it. */
export function ImportSection() {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setReport(null);
    setBusy(true);
    try {
      setReport(await imports.upload(file));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'could not import, try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="import-heading">
      <h2 id="import-heading">Import</h2>
      <p className="muted">
        A plain-text file with one URL per line, at most 5,000 URLs and 2 MB. Lines starting with #
        are skipped. The links are fetched in the background, 20 a minute.
      </p>
      <form className="inline-form" onSubmit={(e) => void start(e)}>
        <label htmlFor="import-file">File of URLs</label>
        <input
          id="import-file"
          type="file"
          accept=".txt,text/plain"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button type="submit" className="button primary" disabled={!file || busy}>
          Import
        </button>
      </form>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {report && <ImportProgress key={report.id} report={report} />}
    </section>
  );
}

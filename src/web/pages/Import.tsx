import { useEffect, useState, type DragEvent, type FormEvent } from 'react';
import { ApiError, imports, workspaces, type ImportReport, type WorkspaceSummary } from '../api';
import { Icon } from '../components/Icon';
import { ImportProgress } from '../components/ImportProgress';
import { byName } from '../format';

/** The workspace choice that asks for a new workspace. */
const NEW_WORKSPACE = 'new';

/** A file's size as people read it: "820 B", "14 KB", "1.2 MB". */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The area a file of URLs is dropped on, with the button that picks one
 * instead. It shows the chosen file.
 */
function DropZone({ file, onFile }: { file: File | null; onFile: (file: File) => void }) {
  const [dragging, setDragging] = useState(false);

  function over(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  }

  function leave(e: DragEvent) {
    // Moving over a child of the zone is not leaving it.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  }

  return (
    <div
      className={dragging ? 'dropzone is-dragging' : 'dropzone'}
      onDragEnter={over}
      onDragOver={over}
      onDragLeave={leave}
      onDrop={drop}
    >
      <Icon name="import" size={24} />
      <p>
        <strong>Drop a file of URLs here</strong> or
      </p>
      <input
        id="import-file"
        className="visually-hidden"
        type="file"
        accept=".txt,text/plain"
        aria-label="File of URLs"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) onFile(picked);
          e.target.value = '';
        }}
      />
      <label htmlFor="import-file" className="q-btn">
        Choose a file
      </label>
      <p className="muted" role="status">
        {file ? `${file.name} (${formatSize(file.size)})` : 'No file chosen'}
      </p>
    </div>
  );
}

/**
 * The import page: a plain-text file of URLs, dropped or picked, imported
 * into the library and, when one is chosen, into a workspace, which can be a
 * new one named here. The import's report and progress follow.
 */
export function Import() {
  const [file, setFile] = useState<File | null>(null);
  const [list, setList] = useState<WorkspaceSummary[]>([]);
  const [choice, setChoice] = useState('');
  const [newName, setNewName] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    workspaces
      .all()
      .then((all) => live && setList(all))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  /** The chosen workspace's id, creating the new one first; undefined for none. */
  async function workspaceId(): Promise<string | undefined> {
    if (choice !== NEW_WORKSPACE) return choice || undefined;
    const created = await workspaces.create(newName.trim());
    setList((current) => [...current, created].sort(byName));
    // A second import goes into the same workspace instead of creating another.
    setChoice(created.id);
    setNewName('');
    return created.id;
  }

  async function start(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setReport(null);
    setBusy(true);
    try {
      setReport(await imports.upload(file, await workspaceId()));
      setFile(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'could not import, try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="import" aria-labelledby="import-heading">
      <header className="page-head">
        <h1 id="import-heading">Import links</h1>
        <p className="lead">
          A plain-text file with one URL per line, at most 5,000 URLs and 2 MB. Lines starting with
          # are skipped. The links are fetched in the background, 20 a minute.
        </p>
      </header>
      <form className="import-form" onSubmit={(e) => void start(e)}>
        <DropZone
          file={file}
          onFile={(f) => {
            setFile(f);
            setError(null);
          }}
        />
        <div className="q-form-control">
          <label className="q-form-label" htmlFor="import-workspace">
            Add the links to a workspace
          </label>
          <select
            id="import-workspace"
            className="q-input"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
          >
            <option value="">No workspace</option>
            {list.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
            <option value={NEW_WORKSPACE}>New workspace…</option>
          </select>
          <span className="q-form-caption">
            Links already in the workspace keep their place; the others are added at its end, in
            file order.
          </span>
        </div>
        {choice === NEW_WORKSPACE && (
          <div className="q-form-control">
            <label className="q-form-label" htmlFor="import-new-workspace">
              Name of the new workspace
            </label>
            <input
              id="import-new-workspace"
              className="q-input"
              required
              maxLength={100}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
        )}
        <div>
          <button type="submit" className="q-btn q-btn--primary" disabled={!file || busy}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
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

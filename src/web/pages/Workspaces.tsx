import { useEffect, useState, type FormEvent } from 'react';
import { Link } from '../App';
import { ApiError, workspaces, type WorkspaceSummary } from '../api';
import { byName } from '../format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfirm } from '../confirm';

/** What the owner confirms before a workspace is deleted. */
const CONFIRM_DELETE = {
  title: 'Delete this workspace?',
  description: 'Its links stay in your library.',
  action: 'Delete workspace',
};

/** One workspace in the list: its name and member count, Rename and Delete. */
function WorkspaceRow({
  workspace,
  onRenamed,
  onDeleted,
  onError,
}: {
  workspace: WorkspaceSummary;
  onRenamed: (w: WorkspaceSummary) => void;
  onDeleted: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(workspace.name);

  async function rename(e: FormEvent) {
    e.preventDefault();
    try {
      const saved = await workspaces.update(workspace.id, { name });
      onRenamed({ ...workspace, name: saved.name });
      setRenaming(false);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'could not rename, try again');
    }
  }

  const confirm = useConfirm();

  async function remove() {
    if (!(await confirm(CONFIRM_DELETE))) return;
    try {
      await workspaces.remove(workspace.id);
      onDeleted(workspace.id);
    } catch {
      onError('could not delete, try again');
    }
  }

  return (
    <li className="workspace-row list-row">
      {renaming ? (
        <form className="inline-form" onSubmit={rename}>
          <Label htmlFor={`rename-${workspace.id}`} className="visually-hidden">
            New name of {workspace.name}
          </Label>
          <Input
            id={`rename-${workspace.id}`}
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit">Save</Button>
        </form>
      ) : (
        <Link to={`/workspaces/${workspace.id}`}>
          {workspace.name} ({workspace.link_count})
        </Link>
      )}
      <span className="actions">
        <Button
          type="button"
          variant="link"
          className="h-auto p-0"
          aria-label={`Rename ${workspace.name}`}
          onClick={() => setRenaming(true)}
        >
          Rename
        </Button>
        <Button
          type="button"
          variant="link"
          className="h-auto p-0"
          aria-label={`Delete ${workspace.name}`}
          onClick={() => void remove()}
        >
          Delete
        </Button>
      </span>
    </li>
  );
}

/** The Workspaces page: the owner's workspaces by name; create, rename and delete. */
export function Workspaces() {
  const [list, setList] = useState<WorkspaceSummary[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    workspaces
      .list()
      .then((items) => live && setList(items))
      .catch(() => live && setError('could not load the workspaces'));
    return () => {
      live = false;
    };
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const w = await workspaces.create(name);
      setList((current) => [...(current ?? []), w].sort(byName));
      setName('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'could not create the workspace');
    }
  }

  return (
    <section className="workspaces">
      <h1>Workspaces</h1>
      <form className="inline-form" onSubmit={create}>
        <Label htmlFor="workspace-name">Workspace name</Label>
        <Input
          id="workspace-name"
          value={name}
          maxLength={100}
          required
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit">Create</Button>
      </form>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <ul className="workspace-list list-box">
        {(list ?? []).map((w) => (
          <WorkspaceRow
            key={w.id}
            workspace={w}
            onRenamed={(renamed) =>
              setList((current) => (current ?? []).map((x) => (x.id === renamed.id ? renamed : x)))
            }
            onDeleted={(id) => setList((current) => (current ?? []).filter((x) => x.id !== id))}
            onError={setError}
          />
        ))}
      </ul>
      {list?.length === 0 && <p className="muted">No workspaces yet.</p>}
    </section>
  );
}

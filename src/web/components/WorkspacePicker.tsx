import { useState } from 'react';
import { workspaces, type WorkspaceSummary } from '../api';

/**
 * 'Add to workspace' on a card: the owner's workspaces by name, those already
 * holding the link marked; choosing another adds the link at its bottom.
 */
export function WorkspacePicker({
  linkId,
  memberOf,
  onAdded,
}: {
  linkId: string;
  memberOf: string[];
  onAdded: (workspace: WorkspaceSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<WorkspaceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      try {
        setList(await workspaces.list());
      } catch {
        setError('could not load the workspaces');
      }
    }
  }

  async function choose(w: WorkspaceSummary) {
    if (memberOf.includes(w.id)) return;
    try {
      await workspaces.addLink(w.id, linkId);
      onAdded(w);
      setOpen(false);
    } catch {
      setError('could not add the link, try again');
    }
  }

  return (
    <span className="picker">
      <button
        type="button"
        className="q-btn-link"
        aria-haspopup="menu"
        onClick={() => void toggle()}
      >
        Add to workspace
      </button>
      {open && (
        <span className="picker-menu q-overlay q-menu" role="menu">
          {(list ?? []).map((w) => {
            const inIt = memberOf.includes(w.id);
            return (
              <button
                key={w.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={inIt}
                className="q-menu-item"
                onClick={() => void choose(w)}
              >
                {w.name}
              </button>
            );
          })}
          {list?.length === 0 && <span className="muted">No workspaces yet.</span>}
        </span>
      )}
      {error && <span className="notice">{error}</span>}
    </span>
  );
}

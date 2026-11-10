import { useState, type ReactNode } from 'react';
import { workspaces, type WorkspaceSummary } from '../api';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * 'Add to workspace' on a card or a link's detail page: the owner's workspaces by name, those already
 * holding the link marked; choosing another adds the link at its bottom.
 */
export function WorkspacePicker({
  linkId,
  memberOf,
  onAdded,
  menuItem = false,
  icon,
}: {
  linkId: string;
  memberOf: string[];
  onAdded: (workspace: WorkspaceSummary) => void;
  /** Whether the button is an item of a menu or an action list, not a link-like button. */
  menuItem?: boolean;
  /** An icon before the label. */
  icon?: ReactNode;
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
        className={menuItem ? 'menu-item' : cn(buttonVariants({ variant: 'link' }), 'h-auto p-0')}
        aria-haspopup="menu"
        onClick={() => void toggle()}
      >
        {icon}
        Add to workspace
      </button>
      {open && (
        <span className="picker-menu menu" role="menu">
          {(list ?? []).map((w) => {
            const inIt = memberOf.includes(w.id);
            return (
              <button
                key={w.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={inIt}
                className="menu-item"
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

import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { workspaces, type WorkspaceSummary } from '../api';

/**
 * 'Add to workspace' on a card or a link's detail page: the owner's
 * workspaces by name, those already holding the link checked; choosing
 * another adds the link at its bottom. In a card's menu (`submenu`) it is a
 * submenu of that menu; on its own it is a menu under a button of an action
 * list.
 */
export function WorkspacePicker({
  linkId,
  memberOf,
  onAdded,
  submenu = false,
  icon,
}: {
  linkId: string;
  memberOf: string[];
  onAdded: (workspace: WorkspaceSummary) => void;
  /** Whether the picker is a submenu of the dropdown menu it is in. */
  submenu?: boolean;
  /** An icon before the label. */
  icon?: ReactNode;
}) {
  const [list, setList] = useState<WorkspaceSummary[] | null>(null);

  /** Loads the workspaces each time the list opens, so it shows the ones made meanwhile. */
  function onOpenChange(open: boolean) {
    if (!open) return;
    workspaces.list().then(setList, () => toast.error('could not load the workspaces'));
  }

  async function choose(w: WorkspaceSummary) {
    if (memberOf.includes(w.id)) return;
    try {
      await workspaces.addLink(w.id, linkId);
      onAdded(w);
    } catch {
      toast.error('could not add the link, try again');
    }
  }

  const items = (
    <>
      {(list ?? []).map((w) => (
        <DropdownMenuCheckboxItem
          key={w.id}
          checked={memberOf.includes(w.id)}
          onSelect={() => void choose(w)}
        >
          {w.name}
        </DropdownMenuCheckboxItem>
      ))}
      {list?.length === 0 && <DropdownMenuItem disabled>No workspaces yet.</DropdownMenuItem>}
    </>
  );

  if (submenu) {
    return (
      <DropdownMenuSub onOpenChange={onOpenChange}>
        <DropdownMenuSubTrigger>
          {icon}
          Add to workspace
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>{items}</DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="action-item">
          {icon}
          Add to workspace
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">{items}</DropdownMenuContent>
    </DropdownMenu>
  );
}

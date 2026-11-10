import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ApiError, links, type Link } from '../api';
import { formatWhen } from '../format';

/** How a status button looks: an item of a dropdown menu, or of an action list. */
export interface ButtonLook {
  look?: 'action' | 'menu';
  /** An icon before the label. */
  icon?: ReactNode;
}

/**
 * A button that runs a request and says in a toast how that went: what `run`
 * answers, the API's own message when it refuses, or `failure`.
 */
export function StatusButton({
  label,
  run,
  failure,
  look = 'action',
  icon,
}: ButtonLook & { label: string; run: () => Promise<string>; failure: string }) {
  const click = () =>
    void run().then(
      (said) => toast(said),
      (err: unknown) => toast.error(err instanceof ApiError ? err.message : failure),
    );
  if (look === 'menu') {
    return (
      <DropdownMenuItem onSelect={click}>
        {icon}
        {label}
      </DropdownMenuItem>
    );
  }
  return (
    <button type="button" className="action-item" onClick={click}>
      {icon}
      {label}
    </button>
  );
}

/** 'Check now' on a link's detail page: says whether its address answers, and when it was checked. */
export function CheckButton({
  link,
  onChecked,
  ...look
}: ButtonLook & { link: Link; onChecked?: (link: Link) => void }) {
  return (
    <StatusButton
      {...look}
      label="Check now"
      failure="could not check, try again"
      run={async () => {
        const outcome = await links.check(link.id);
        onChecked?.(outcome.link);
        const reachable = outcome.passed ? 'Reachable' : 'Not reachable';
        return `${reachable} (${outcome.result}), checked ${formatWhen(outcome.checked_at)}`;
      }}
    />
  );
}

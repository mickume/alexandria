import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ApiError, links, type Link } from '../api';
import { formatWhen } from '../format';

/**
 * How a status button looks and says how its request went: a link-like button
 * or an item of an action list, each with the outcome beside it, or an item
 * of a dropdown menu, which closes and says it in a toast.
 */
export interface ButtonLook {
  look?: 'link' | 'action' | 'menu';
  /** An icon before the label. */
  icon?: ReactNode;
}

/**
 * A button that runs a request and says how that went: what `run` answers,
 * the API's own message when it refuses, or `failure`.
 */
export function StatusButton({
  label,
  run,
  failure,
  look = 'link',
  icon,
}: ButtonLook & { label: string; run: () => Promise<string>; failure: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const outcome = () =>
    run().catch((err: unknown) => {
      throw new Error(err instanceof ApiError ? err.message : failure);
    });
  if (look === 'menu') {
    return (
      <DropdownMenuItem
        onSelect={() =>
          void outcome().then(
            (said) => toast(said),
            (err: Error) => toast.error(err.message),
          )
        }
      >
        {icon}
        {label}
      </DropdownMenuItem>
    );
  }
  const click = () => {
    setStatus(null);
    void outcome().then(setStatus, (err: Error) => setStatus(err.message));
  };
  return (
    <>
      {look === 'action' ? (
        <button type="button" className="action-item" onClick={click}>
          {icon}
          {label}
        </button>
      ) : (
        <Button type="button" variant="link" className="h-auto p-0" onClick={click}>
          {icon}
          {label}
        </Button>
      )}
      {status && (
        <span className="muted" role="status">
          {status}
        </span>
      )}
    </>
  );
}

/** 'Check now' on a link's detail page: whether its address answers, and when it was checked. */
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

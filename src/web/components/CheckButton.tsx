import { useState, type ReactNode } from 'react';
import { ApiError, links, type Link } from '../api';
import { formatWhen } from '../format';
import { Button } from '@/components/ui/button';

/** How a status button looks: a link-like button, or an item of a menu or an action list. */
export interface ButtonLook {
  /** Whether the button is an item of a menu or an action list. */
  menuItem?: boolean;
  /** An icon before the label. */
  icon?: ReactNode;
}

/**
 * A button that runs a request and says beside it how that went: what `run`
 * answers, the API's own message when it refuses, or `failure`.
 */
export function StatusButton({
  label,
  run,
  failure,
  menuItem = false,
  icon,
}: ButtonLook & { label: string; run: () => Promise<string>; failure: string }) {
  const [status, setStatus] = useState<string | null>(null);
  async function click() {
    setStatus(null);
    try {
      setStatus(await run());
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : failure);
    }
  }
  return (
    <>
      {menuItem ? (
        <button type="button" className="menu-item" onClick={() => void click()}>
          {icon}
          {label}
        </button>
      ) : (
        <Button type="button" variant="link" className="h-auto p-0" onClick={() => void click()}>
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

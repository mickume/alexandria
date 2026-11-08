import { useState } from 'react';
import { ApiError, links, type Link } from '../api';
import { formatWhen } from '../format';

/** 'Check now' on a link's detail page: whether its address answers, and when it was checked. */
export function CheckButton({ link, onChecked }: { link: Link; onChecked?: (link: Link) => void }) {
  const [status, setStatus] = useState<string | null>(null);
  async function check() {
    setStatus(null);
    try {
      const outcome = await links.check(link.id);
      const when = formatWhen(outcome.checked_at);
      setStatus(
        outcome.passed
          ? `Reachable (${outcome.result}), checked ${when}`
          : `Not reachable (${outcome.result}), checked ${when}`,
      );
      onChecked?.(outcome.link);
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'could not check, try again');
    }
  }
  return (
    <>
      <button type="button" className="q-btn-link" onClick={() => void check()}>
        Check now
      </button>
      {status && (
        <span className="muted" role="status">
          {status}
        </span>
      )}
    </>
  );
}

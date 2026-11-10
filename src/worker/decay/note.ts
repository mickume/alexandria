import { now } from '../clock';
import type { LinkRow } from '../links/store';
import { DAY_MS, DEFAULT_THRESHOLDS, pointsAt } from './points';

function isoDate(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Why a link stands where it does, in one sentence: when an expired link
 * expired and will be removed; that a pinned link, or one in a workspace,
 * never expires; otherwise the days until it expires.
 */
function decayNote(
  row: LinkRow,
  points: number,
  expiredAt: string | null,
  removalAt: string | null,
): string {
  if (expiredAt && removalAt) {
    return `expired on ${isoDate(Date.parse(expiredAt))}, removed on ${isoDate(Date.parse(removalAt))}`;
  }
  if (row.pin_position !== null) return 'pinned: never expires';
  if (row.workspaces_json && row.workspaces_json !== '[]') {
    return 'in a workspace: never expires';
  }
  if (points <= 0) return 'expires today';
  return `expires in ${points} ${points === 1 ? 'day' : 'days'}`;
}

/**
 * The decay fields of a link as the API shows them: points, expiry and
 * liveness dates, and why. An archived link is kept outside decay: it has no
 * points and no removal date.
 */
export function decayFields(row: LinkRow) {
  const liveness = {
    dead_since: row.dead_since ?? null,
    last_checked_at: row.last_checked_at ?? null,
    last_check_result: row.last_check_result ?? null,
  };
  if (row.state === 'archived') {
    const archivedAt = row.archived_at ?? row.updated_at;
    return {
      points: null,
      archived_at: archivedAt,
      expired_at: null,
      removal_at: null,
      ...liveness,
      decay_note: `archived on ${isoDate(Date.parse(archivedAt))}: kept until deleted`,
    };
  }
  const removeDays = row.user_remove_days ?? DEFAULT_THRESHOLDS.remove_days;
  const expiredAt = row.state === 'expired' ? (row.expired_at ?? null) : null;
  const removalAt = expiredAt
    ? new Date(Date.parse(expiredAt) + removeDays * DAY_MS).toISOString()
    : null;
  const points = pointsAt(
    row.user_start_points ?? DEFAULT_THRESHOLDS.start_points,
    row.use_count,
    row.decay_from,
    now().getTime(),
  );
  return {
    points,
    archived_at: null,
    expired_at: expiredAt,
    removal_at: removalAt,
    ...liveness,
    decay_note: decayNote(row, points, expiredAt, removalAt),
  };
}

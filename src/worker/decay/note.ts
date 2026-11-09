import { now } from '../clock';
import type { LinkRow } from '../links/store';

const DAY_MS = 86_400_000;

function isoDate(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** "1 point" or "N points". */
function pointsText(points: number): string {
  return `${points} ${points === 1 ? 'point' : 'points'}`;
}

/** The start points of a user who never changed them. */
export const DEFAULT_START_POINTS = 60;

/**
 * A link's points at time `at`: its user's start points plus its use count,
 * minus the whole 24-hour periods since its last use or boost (none for a last
 * use after `at`). They can be negative.
 */
export function pointsAt(
  startPoints: number,
  useCount: number,
  lastUsedAt: string,
  at: number,
): number {
  return startPoints + useCount - Math.max(0, Math.floor((at - Date.parse(lastUsedAt)) / DAY_MS));
}

/**
 * Why a link stands where it does, in one sentence: when an expired link
 * expired and will be removed; that a pinned link, or one in a workspace,
 * never expires; otherwise its points and the days until it expires.
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
  if (row.pin_position !== null) return `pinned: never expires, ${pointsText(points)}`;
  if (row.workspaces_json && row.workspaces_json !== '[]') {
    return `in a workspace: never expires, ${pointsText(points)}`;
  }
  if (points <= 0) return `${pointsText(points)}: expires today`;
  return `${pointsText(points)}: expires in ${points} ${points === 1 ? 'day' : 'days'}`;
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
  const removeDays = row.user_remove_days ?? 180;
  const expiredAt = row.state === 'expired' ? (row.expired_at ?? null) : null;
  const removalAt = expiredAt
    ? new Date(Date.parse(expiredAt) + removeDays * DAY_MS).toISOString()
    : null;
  const points = pointsAt(
    row.user_start_points ?? DEFAULT_START_POINTS,
    row.use_count,
    row.last_used_at,
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

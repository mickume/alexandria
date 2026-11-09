import { now } from '../clock';
import type { LinkRow } from '../links/store';

const DAY_MS = 86_400_000;

/** "N days" below 60 days, "N months" of 30 days from 60 days. */
function unusedFor(days: number): string {
  if (days < 60) return `unused for ${days} ${days === 1 ? 'day' : 'days'}`;
  const months = Math.floor(days / 30);
  return `unused for ${months} months`;
}

function isoDate(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
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

/** The decay fields of a link as the API shows them: points, expiry and liveness dates, and why. */
export function decayFields(row: LinkRow) {
  const uses = row.use_events ?? 0;
  const days = row.use_days ?? 0;
  const sticky = uses >= 5 && days >= 5;
  const removeDays = row.user_remove_days ?? 180;
  const archivedAt = row.archived_at ?? null;
  const expiredAt = row.expired_at ?? null;
  const since = expiredAt ?? archivedAt;
  const removalAt = since ? new Date(Date.parse(since) + removeDays * DAY_MS).toISOString() : null;
  const unused = unusedFor(
    Math.max(0, Math.floor((now().getTime() - Date.parse(row.last_used_at)) / DAY_MS)),
  );
  let decay_note: string;
  if (row.state === 'archived' && archivedAt && removalAt) {
    decay_note = `archived on ${isoDate(Date.parse(archivedAt))}, removed on ${isoDate(Date.parse(removalAt))}`;
  } else if (sticky) {
    decay_note = `sticky: ${uses} uses on ${days} days, never archived`;
  } else if (row.pin_position !== null) {
    decay_note = `pinned: never archived, ${unused}`;
  } else if (row.workspaces_json && row.workspaces_json !== '[]') {
    decay_note = `in a workspace: never archived, ${unused}`;
  } else {
    decay_note = unused;
  }
  return {
    points: pointsAt(
      row.user_start_points ?? DEFAULT_START_POINTS,
      row.use_count,
      row.last_used_at,
      now().getTime(),
    ),
    expired_at: expiredAt,
    removal_at: removalAt,
    dead_since: row.dead_since ?? null,
    last_checked_at: row.last_checked_at ?? null,
    last_check_result: row.last_check_result ?? null,
    decay_note,
  };
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** A stored time as a short date, such as "15 Jan 2026". */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

/**
 * A recent time relative to now ("just now", "5 minutes ago", "3 hours ago"),
 * and an older one as a short date.
 */
export function formatWhen(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  return formatDate(iso);
}

/** Orders things by name, alphabetically and ignoring case. */
export function byName(a: { name: string }, b: { name: string }): number {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

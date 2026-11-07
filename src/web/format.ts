const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** A stored time as a short date, such as "15 Jan 2026". */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

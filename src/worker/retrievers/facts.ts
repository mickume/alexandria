/** How retrievers write what an API answers as the link's fields and facts. */
import type { Fact } from './retriever';

/** The longest description a retrieved link stores. */
export const DESCRIPTION_LIMIT = 300;

/**
 * `text` as a description: whitespace collapsed, and when longer than 300
 * characters cut at the last word boundary before it, with "…"; null for
 * empty text.
 */
export function describe(text: string | null | undefined): string | null {
  const collapsed = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  if (collapsed.length <= DESCRIPTION_LIMIT) return collapsed;
  const head = collapsed.slice(0, DESCRIPTION_LIMIT - 1);
  const space = head.lastIndexOf(' ');
  return `${(space > 0 ? head.slice(0, space) : head).trimEnd()}…`;
}

/** One decimal, rounded down, without a trailing ".0". */
function oneDecimal(n: number): string {
  return String(Math.floor(n * 10) / 10);
}

/** A count as it is shown: 999, then 1.2k, 12.3k, then 1.2M. */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${oneDecimal(n / 1000)}k`;
  return `${oneDecimal(n / 1_000_000)}M`;
}

/** The date of an ISO 8601 time, `YYYY-MM-DD`; null when it is not one. */
export function dateOf(iso: unknown): string | null {
  if (typeof iso !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return match ? match[1]! : null;
}

/**
 * An ISO 8601 duration (`PT12M34S`, `P1DT2H`) as it is shown: "m:ss", or
 * "h:mm:ss" from an hour; null for a zero duration (a live stream's `P0D`) or
 * anything else.
 */
export function clockDuration(iso: unknown): string | null {
  if (typeof iso !== 'string') return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!match) return null;
  const [d = 0, h = 0, m = 0, s = 0] = match.slice(1).map((v) => Number(v ?? 0));
  const total = ((d * 24 + h) * 60 + m) * 60 + s;
  if (total === 0) return null;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

/**
 * The facts of a link from `[key, label, value, card]` entries, in order,
 * leaving out every entry whose value is missing or empty.
 */
export function facts(
  entries: [key: string, label: string, value: string | null | undefined, card?: boolean][],
): Fact[] {
  return entries
    .filter((e): e is [string, string, string, boolean | undefined] => Boolean(e[2]))
    .map(([key, label, value, card]) => ({ key, label, value, card: card ?? false }));
}

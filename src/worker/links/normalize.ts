/** The outcome of normalising one input. */
export type NormalizeResult = { ok: true; url: string } | { ok: false; error: 'invalid_url' };

const INVALID: NormalizeResult = { ok: false, error: 'invalid_url' };

/** Query parameters that only track the visitor; every other parameter is kept. */
const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid']);

function isTrackingParam(name: string): boolean {
  return name.startsWith('utm_') || TRACKING_PARAMS.has(name);
}

/**
 * Validates and normalises a URL the way every entry point of the library does,
 * so that duplicates are found by comparing normalised strings:
 * surrounding whitespace is trimmed, `https://` is added to an input without a
 * scheme, scheme and host are lower-cased, the fragment, a default port and the
 * tracking parameters are dropped, the remaining parameters are sorted by name,
 * and a lone `/` path is dropped when no query follows it.
 *
 * Inputs that are not http or https URLs, that name a bare word rather than a
 * dotted host, or that name localhost, a loopback, private or link-local
 * address, are rejected.
 */
export function normalizeUrl(input: string): NormalizeResult {
  const trimmed = input.trim();
  if (!trimmed) return INVALID;

  let candidate = trimmed;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)?.[1];
  // "example.com:8080/x" has no scheme: a scheme never contains a dot.
  if (scheme === undefined || scheme.includes('.')) candidate = `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return INVALID;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return INVALID;
  if (!isWebHost(url.hostname) || isPrivateHost(url.hostname)) return INVALID;

  const query = normalizeQuery(url.search);
  const path = url.pathname === '/' && !query ? '' : url.pathname;
  const auth = url.username ? `${url.username}${url.password ? `:${url.password}` : ''}@` : '';
  return { ok: true, url: `${url.protocol}//${auth}${url.host}${path}${query}` };
}

/** Drops the tracking parameters and empty pieces and sorts the rest by name, keeping their encoding. */
function normalizeQuery(search: string): string {
  if (search.length <= 1) return '';
  const pairs = search
    .slice(1)
    .split('&')
    .filter((piece) => piece !== '')
    .map((raw) => ({ raw, name: decodeName(raw.split('=', 1)[0] ?? '') }))
    .filter((p) => !isTrackingParam(p.name));
  if (pairs.length === 0) return '';
  pairs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return `?${pairs.map((p) => p.raw).join('&')}`;
}

function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

/** Whether a hostname can name a site on the web: a dotted name or an IP literal, not a bare word. */
function isWebHost(hostname: string): boolean {
  if (hostname.startsWith('[')) return true;
  const labels = hostname.replace(/\.$/, '').split('.');
  return labels.length >= 2 && labels.every((l) => l.length > 0);
}

/** Whether a URL's hostname is localhost or a loopback, private, link-local or unspecified address. */
function isPrivateHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (hostname.startsWith('[')) return isPrivateIPv6(hostname.slice(1, -1));
  const v4 = parseIPv4(hostname);
  return v4 !== null && isPrivateIPv4(v4);
}

function parseIPv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return null;
  const octets = parts.map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

function isPrivateIPv4([a = 0, b = 0]: number[]): boolean {
  return (
    a === 0 || // 0.0.0.0/8, "this network"
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/** Takes the URL parser's canonical (compressed, lower-case) IPv6 form. */
function isPrivateIPv6(address: string): boolean {
  if (address === '::1' || address === '::') return true;
  // IPv4-mapped addresses, which the URL parser writes as ::ffff:7f00:1.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (mapped) {
    const hi = parseInt(mapped[1] ?? '0', 16);
    const lo = parseInt(mapped[2] ?? '0', 16);
    return isPrivateIPv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  }
  const first = parseInt(address.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

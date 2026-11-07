/** The website's client of the Worker's API under /api/v1/. */

/** A refusal from the API, with its status and the body's error code and message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Sends a request to the API and returns its parsed JSON body (undefined for 204). */
export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) {
    window.location.assign('/signin');
    throw new ApiError(401, 'unauthorized', 'signed out');
  }
  const text = await response.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const code = typeof json.error === 'string' ? json.error : 'error';
    const message = typeof json.message === 'string' ? json.message : code;
    throw new ApiError(response.status, code, message, json);
  }
  return json as T;
}

/** A personal access token as listed. */
export interface Token {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export const tokens = {
  list: () => request<{ items: Token[] }>('GET', '/tokens').then((r) => r.items),
  create: (name: string) => request<Token & { secret: string }>('POST', '/tokens', { name }),
  revoke: (id: string) => request<void>('DELETE', `/tokens/${id}`),
};

/** A link as the API shows it. */
export interface Link {
  id: string;
  url: string;
  original_url: string;
  host: string;
  title: string;
  state: string;
  added_at: string;
  last_used_at: string;
  use_count: number;
  pinned: boolean;
  pin_position: number | null;
  final_url: string | null;
  http_status: number | null;
  description: string | null;
  favicon_url: string | null;
  language: string | null;
  fetched_at: string | null;
  state_reason: string | null;
  notes: string[];
  content_kind: 'html' | 'pdf' | 'other' | null;
  has_snapshot: boolean;
  updated_at: string;
}

/** One page of a list. */
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

/** What a batch add did to each URL. */
export interface BatchResult {
  added: Link[];
  boosted: Link[];
  invalid: { url: string; error: 'invalid_url' | 'library_full' }[];
}

/** One event of a link's history: a use, or a fetch attempt. */
export type LinkEvent =
  | { kind: 'use'; at: string }
  | {
      kind: 'fetch';
      at: string;
      outcome: 'ok' | 'failed';
      http_status: number | null;
      reason: string | null;
    };

/** The address that opens a link through the API, recording the use. */
export function openUrl(id: string): string {
  return `/api/v1/links/${encodeURIComponent(id)}/open`;
}

/** The links changed since a server time, and the server time to ask from next. */
export interface Changes {
  items: Link[];
  server_time: string;
}

/** A link's stored reader view. */
export interface ReaderView {
  content_kind: 'html' | 'pdf';
  title: string | null;
  byline: string | null;
  html: string | null;
  text: string;
  empty: boolean;
}

/** The address of a link's stored snapshot; `download` asks for a PDF as an attachment. */
export function snapshotUrl(id: string, { download = false } = {}): string {
  return `/api/v1/links/${encodeURIComponent(id)}/snapshot${download ? '?download=1' : ''}`;
}

export const links = {
  reader: (id: string) => request<ReaderView>('GET', `/links/${encodeURIComponent(id)}/reader`),
  changedSince: (since: string) =>
    request<Changes>('GET', `/links?changed_since=${encodeURIComponent(since)}`),
  get: (id: string) => request<Link>('GET', `/links/${encodeURIComponent(id)}`),
  history: (id: string) =>
    request<Page<LinkEvent>>('GET', `/links/${encodeURIComponent(id)}/history`),
  list: (cursor?: string | null) =>
    request<Page<Link>>('GET', `/links${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  addBatch: (urls: string[]) => request<BatchResult>('POST', '/links/batch', { urls }),
  pin: (id: string, position?: number) =>
    request<Link>(
      'POST',
      `/links/${encodeURIComponent(id)}/pin`,
      position === undefined ? undefined : { position },
    ),
  unpin: (id: string) => request<Link>('DELETE', `/links/${encodeURIComponent(id)}/pin`),
  refresh: (id: string) =>
    request<{ status: 'queued' }>('POST', `/links/${encodeURIComponent(id)}/refresh`),
  /** Deletes a link for good; a link already gone counts as deleted. */
  remove: async (id: string, { keepalive = false } = {}) => {
    try {
      await request<void>('DELETE', `/links/${encodeURIComponent(id)}`, undefined, { keepalive });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
  },
};

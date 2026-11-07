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
  summary: string | null;
  tags: string[];
  topic: string | null;
  enrichment_status:
    'no_key' | 'queued' | 'enriched' | 'failed' | 'skipped' | 'waiting_for_key' | null;
  enrichment_reason: string | null;
  edited_fields: string[];
  note_preview: string | null;
  workspaces: { id: string; name: string }[];
  /** The whole note: only on a link read on its own. */
  note?: string;
  sticky: boolean;
  archived_at: string | null;
  removal_at: string | null;
  dead_since: string | null;
  last_checked_at: string | null;
  last_check_result: string | null;
  decay_note: string;
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
  edit: (
    id: string,
    fields: Partial<Pick<Link, 'title' | 'summary' | 'tags' | 'topic'>> & { note?: string },
  ) => request<Link>('PATCH', `/links/${encodeURIComponent(id)}`, fields),
  check: (id: string) =>
    request<{ passed: boolean; result: string; checked_at: string; link: Link }>(
      'POST',
      `/links/${encodeURIComponent(id)}/check`,
    ),
  archive: (id: string) => request<Link>('POST', `/links/${encodeURIComponent(id)}/archive`),
  restore: (id: string) => request<Link>('POST', `/links/${encodeURIComponent(id)}/restore`),
  archived: () => request<Page<Link>>('GET', '/archive').then((p) => p.items),
  enrich: (id: string) =>
    request<{ status: 'queued' }>('POST', `/links/${encodeURIComponent(id)}/enrich`),
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

/** The owner's AI settings, never with the key beyond its last 4 characters. */
export type AiSettings =
  | {
      configured: true;
      provider: 'anthropic' | 'openrouter';
      model: string;
      key_last4: string;
      status: 'verified' | 'rejected';
      rejected_message: string | null;
      unenriched_count: number;
    }
  | { configured: false; unenriched_count: number };

export const ai = {
  get: () => request<AiSettings>('GET', '/settings/ai'),
  save: (body: { provider: string; api_key: string; model?: string }) =>
    request<AiSettings>('PUT', '/settings/ai', body),
  remove: () => request<void>('DELETE', '/settings/ai'),
  enrichUnenriched: () => request<{ queued: number }>('POST', '/links/enrich-unenriched'),
};

/** A workspace as listed. */
export interface WorkspaceSummary {
  id: string;
  name: string;
  description: string;
  link_count: number;
  created_at: string;
}

/** A workspace on its own, with its note. */
export type Workspace = WorkspaceSummary & { note: string };

/** A member of a workspace: a link with its position. */
export type Member = Link & { position: number };

const ws = (id: string) => `/workspaces/${encodeURIComponent(id)}`;

export const workspaces = {
  list: () => request<Page<WorkspaceSummary>>('GET', '/workspaces').then((p) => p.items),
  get: (id: string) => request<Workspace>('GET', ws(id)),
  create: (name: string) => request<Workspace>('POST', '/workspaces', { name }),
  update: (id: string, fields: { name?: string; description?: string; note?: string }) =>
    request<Workspace>('PATCH', ws(id), fields),
  remove: (id: string) => request<void>('DELETE', ws(id)),
  links: (id: string) => request<Page<Member>>('GET', `${ws(id)}/links`).then((p) => p.items),
  addLink: (id: string, linkId: string, position?: number) =>
    request<{ position: number }>('POST', `${ws(id)}/links`, {
      link_id: linkId,
      ...(position === undefined ? {} : { position }),
    }),
  removeLink: (id: string, linkId: string) =>
    request<void>('DELETE', `${ws(id)}/links/${encodeURIComponent(linkId)}`),
};

/** The decay thresholds, in days. */
export interface Thresholds {
  dormant_days: number;
  archive_days: number;
  remove_days: number;
}

export const decay = {
  get: () => request<Thresholds>('GET', '/settings/decay'),
  save: (t: Thresholds) => request<Thresholds>('PUT', '/settings/decay', t),
};

/** A topic or tag as listed, with its number of links. */
export interface VocabularyItem {
  id: string;
  name: string;
  count: number;
  newest_added_at: string;
}

/** Topics or tags. */
export type VocabularyKind = 'topics' | 'tags';

export const vocabulary = {
  /** Every topic or tag with a link, newest first, following the cursor to the end. */
  listAll: async (kind: VocabularyKind): Promise<VocabularyItem[]> => {
    const items: VocabularyItem[] = [];
    let cursor: string | null = null;
    do {
      const page: Page<VocabularyItem> = await request<Page<VocabularyItem>>(
        'GET',
        `/${kind}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      items.push(...page.items);
      cursor = page.next_cursor;
    } while (cursor);
    return items;
  },
  rename: (kind: VocabularyKind, id: string, name: string) =>
    request<{ id: string; name: string; count: number }>(
      'PATCH',
      `/${kind}/${encodeURIComponent(id)}`,
      { name },
    ),
  merge: (kind: VocabularyKind, id: string, into: string) =>
    request<{ id: string; name: string; count: number }>(
      'POST',
      `/${kind}/${encodeURIComponent(id)}/merge`,
      { into },
    ),
};

/** The search query of a topic or tag filter, quoting a name that holds a space. */
export function filterQuery(name: 'topic' | 'tag', value: string): string {
  return `${name}:${/\s/.test(value) ? `"${value}"` : value}`;
}

/** The website's address of a search. */
export function searchPath(q: string): string {
  return `/search?q=${encodeURIComponent(q)}`;
}

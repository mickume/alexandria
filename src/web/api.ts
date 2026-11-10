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
  // A form (an upload) is sent as it is, with its own multipart type.
  const form = body instanceof FormData;
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    method,
    credentials: 'same-origin',
    headers: body === undefined || form ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
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
  /** The names from the top-level topic down to the link's own topic; [] without a topic. */
  topic_path: string[];
  enrichment_status:
    'no_key' | 'queued' | 'enriched' | 'failed' | 'skipped' | 'waiting_for_key' | null;
  enrichment_reason: string | null;
  edited_fields: string[];
  note_preview: string | null;
  workspaces: { id: string; name: string }[];
  /** The whole note: only on a link read on its own. */
  note?: string;
  /** Start points plus the use count, minus the whole days since the last use or boost; null when archived. */
  points: number | null;
  /** When the link was archived, while it is archived. */
  archived_at: string | null;
  /** When the link expired, while it is expired. */
  expired_at: string | null;
  /** When an expired link will be removed. */
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
  /** The other links nearest in meaning to the link, best first. */
  related: (id: string) =>
    request<{ items: (Link & { score: number })[] }>(
      'GET',
      `/links/${encodeURIComponent(id)}/related`,
    ),
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
  restore: (id: string) => request<Link>('POST', `/links/${encodeURIComponent(id)}/restore`),
  archive: (id: string) => request<Link>('POST', `/links/${encodeURIComponent(id)}/archive`),
  unarchive: (id: string) => request<Link>('POST', `/links/${encodeURIComponent(id)}/unarchive`),
  /** Every expired link, most recently expired first, page after page. */
  expired: async () => {
    const all: Link[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page: Page<Link> = await request('GET', `/expired?limit=100${query}`);
      all.push(...page.items);
      cursor = page.next_cursor;
    } while (cursor);
    return all;
  },
  /** Every archived link, most recently archived first, page after page. */
  archived: async () => {
    const all: Link[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page: Page<Link> = await request('GET', `/archive?limit=100${query}`);
      all.push(...page.items);
      cursor = page.next_cursor;
    } while (cursor);
    return all;
  },
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

/** The owner's Firecrawl key, never beyond its last 4 characters. */
export type FirecrawlSettings =
  | {
      configured: true;
      key_last4: string;
      status: 'verified' | 'rejected';
      rejected_message: string | null;
    }
  | { configured: false };

export const firecrawl = {
  get: () => request<FirecrawlSettings>('GET', '/settings/firecrawl'),
  save: (apiKey: string) =>
    request<FirecrawlSettings>('PUT', '/settings/firecrawl', { api_key: apiKey }),
  remove: () => request<void>('DELETE', '/settings/firecrawl'),
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
  /** Every workspace, by name, page after page. */
  all: async () => {
    const all: WorkspaceSummary[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page: Page<WorkspaceSummary> = await request('GET', `/workspaces?limit=100${query}`);
      all.push(...page.items);
      cursor = page.next_cursor;
    } while (cursor);
    return all;
  },
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

/** The decay settings: the points a link starts from, and the days from expiry to removal. */
export interface Thresholds {
  start_points: number;
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

/** A topic as listed: also its parent (null at the top level) and the links beneath it. */
export interface TopicItem extends VocabularyItem {
  parent_id: string | null;
  subtree_count: number;
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
  /** Has the owner's AI provider divide the links filed directly under a topic into sub-topics. */
  split: (id: string) =>
    request<{
      topic: Omit<TopicItem, 'newest_added_at'>;
      children: { id: string; name: string; count: number }[];
      moved: number;
    }>('POST', `/topics/${encodeURIComponent(id)}/split`),
  /** Moves a topic, with everything beneath it, under another topic, or to the top level for null. */
  move: (id: string, parent: string | null) =>
    request<Omit<TopicItem, 'newest_added_at'>>('POST', `/topics/${encodeURIComponent(id)}/move`, {
      parent,
    }),
};

/** The search query of a topic or tag filter, quoting a name that holds a space. */
export function filterQuery(name: 'topic' | 'tag', value: string): string {
  return `${name}:${/\s/.test(value) ? `"${value}"` : value}`;
}

/** The mode of a search that also finds links by meaning. */
export type SearchMode = 'hybrid';

/** The website's address of a search, by meaning when `mode` is 'hybrid'. */
export function searchPath(q: string, mode?: SearchMode): string {
  return `/search?q=${encodeURIComponent(q)}${mode ? `&mode=${mode}` : ''}`;
}

/** A piece of a snippet: text, and whether it is a matched word. */
export interface Segment {
  text: string;
  match: boolean;
}

/** How a link of a search by meaning was found. */
export type MatchKind = 'keyword' | 'meaning' | 'both';

/** One page of a search's results. */
export interface SearchResults {
  items: { link: Link; snippet: Segment[]; match?: MatchKind }[];
  workspaces: { id: string; name: string; snippet: Segment[] }[];
  next_cursor: string | null;
  /** Only in a search by meaning: whether meaning could be added to the results. */
  meaning?: 'used' | 'unavailable';
}

/**
 * Searches the library: free words and prefix filters, one page at a time; by
 * meaning as well as by words when `mode` is 'hybrid'.
 */
export function search(
  q: string,
  cursor?: string | null,
  mode?: SearchMode,
): Promise<SearchResults> {
  const after = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
  return request<SearchResults>(
    'GET',
    `/search?q=${encodeURIComponent(q)}${after}${mode ? `&mode=${mode}` : ''}`,
  );
}

/** The prefix filters of a query, each as written: tag:x, topic:"web development", … */
export function activeFilters(q: string): string[] {
  const terms = q.match(/[^\s"]*"[^"]*"\S*|\S+/g) ?? [];
  return terms.filter((t) => /^(tag|topic|host|state|in|is):("[^"]*"|[^"\s]+)$/i.test(t));
}

/** An import's report. */
export interface ImportReport {
  id: string;
  created_at: string;
  counts: {
    url_lines: number;
    added: number;
    duplicates: number;
    invalid: number;
    not_imported: number;
  };
  invalid: { line: number; text: string }[];
  duplicates: { line: number; url: string }[];
  stopped_at_limit: { line: number } | null;
  /** The workspace the links were added to, and how many joined it; null without one. */
  workspace: { id: string; name: string; added: number } | null;
}

/** Where an import's added links stand. */
export interface ImportProgress {
  waiting: number;
  in_progress: number;
  done: number;
  enriched: number;
}

export const imports = {
  /** Uploads a text or Markdown file of URLs, one per line that holds one, adding its links to a workspace when given one. */
  upload: (file: File, workspaceId?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (workspaceId) form.append('workspace_id', workspaceId);
    return request<ImportReport>('POST', '/imports', form);
  },
  get: (id: string) =>
    request<ImportReport & { progress: ImportProgress }>(
      'GET',
      `/imports/${encodeURIComponent(id)}`,
    ),
  /** The address of an import's downloadable report. */
  reportUrl: (id: string) => `/api/v1/imports/${encodeURIComponent(id)}/report`,
};

export const account = {
  me: () => request<{ email: string; name: string }>('GET', '/me'),
  /** Deletes the account, confirmed by its email typed by the owner. */
  remove: (confirmEmail: string) =>
    request<{ status: 'deleting' }>('DELETE', '/me', { confirm_email: confirmEmail }),
};

/** A link an answer cites, numbered from 1. */
export interface AskSource {
  n: number;
  link: Link;
}

/** One event of an answer: the sources first, then pieces of the answer, then done or an error. */
export type AskEvent =
  | { event: 'sources'; data: { sources: AskSource[] } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'done'; data: Record<string, never> }
  | { event: 'error'; data: { error: string; message: string } };

/**
 * Asks the library a question and hands each event of the streamed answer to
 * `onEvent` as it arrives; `detailed` asks for a longer, thorough answer. A
 * refusal before the stream is thrown as an ApiError.
 */
export async function ask(
  question: string,
  onEvent: (event: AskEvent) => void,
  { detailed = false } = {},
): Promise<void> {
  const response = await fetch('/api/v1/ask', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(detailed ? { question, detailed } : { question }),
  });
  if (response.status === 401) {
    window.location.assign('/signin');
    throw new ApiError(401, 'unauthorized', 'signed out');
  }
  if (!response.ok || !response.body) {
    const text = await response.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const code = typeof json.error === 'string' ? json.error : 'error';
    const message = typeof json.message === 'string' ? json.message : code;
    throw new ApiError(response.status, code, message, json);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  for (;;) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const blocks = pending.split('\n\n');
    pending = done ? '' : (blocks.pop() ?? '');
    for (const block of blocks) {
      const name = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (name && data) onEvent({ event: name, data: JSON.parse(data) } as AskEvent);
    }
    if (done) return;
  }
}

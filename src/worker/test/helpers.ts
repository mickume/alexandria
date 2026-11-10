/**
 * Shared helpers of the Worker tests: requests through the real Worker,
 * signed-in users, tokens, seeded links and the clock.
 */
import {
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  env,
  getQueueResult,
  SELF,
  waitOnExecutionContext,
} from 'cloudflare:test';
import type {
  AccountMessage,
  EnrichMessage,
  FetchMessage,
  IndexMessage,
  LivenessMessage,
} from '../env';
import worker from '../index';
import { sha256Hex } from '../auth/crypto';
import { now, setNow as setClock } from '../clock';

export { sha256Hex };

export { env };

/** The origin the tests' requests come from. */
export const ORIGIN = 'https://alexandria.test';

/** Fixes the application's clock. */
export function setNow(t: Date | number | string): void {
  setClock(typeof t === 'string' ? new Date(t) : t);
}

/** Empties the database of every trigger, view and table, so the migrations can be applied from the start. */
export async function emptySchema(): Promise<void> {
  const objects = await env.DB.prepare(
    `SELECT type, name FROM sqlite_master
     WHERE type IN ('trigger', 'view', 'table') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
       -- A full-text index's shadow tables go with the index itself.
       AND (type <> 'table' OR sql NOT LIKE 'CREATE TABLE ''%')
     ORDER BY CASE type WHEN 'trigger' THEN 0 WHEN 'view' THEN 1 ELSE 2 END, rowid DESC`,
  ).all<{ type: string; name: string }>();
  await env.DB.batch([
    env.DB.prepare('PRAGMA defer_foreign_keys = on'),
    ...objects.results.map((o) => env.DB.prepare(`DROP ${o.type.toUpperCase()} "${o.name}"`)),
  ]);
}

/** Puts the user's topic `child` under their topic `parent`. */
export async function placeTopic(user: TestUser, child: string, parent: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE topics SET parent_id = (SELECT id FROM topics WHERE user_id = ?1 AND name = ?3)
     WHERE user_id = ?1 AND name = ?2`,
  )
    .bind(user.id, child, parent)
    .run();
}

/** A response with its parsed JSON body, when it has one. */
export interface ApiResponse {
  status: number;
  headers: Headers;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  response: Response;
}

/** How a test request authenticates and what it sends. */
export interface ApiOptions {
  /** A session cookie value (as signIn returns), sent as alexandria_session. */
  as?: string;
  /** A personal access token secret, sent as a bearer token. */
  bearer?: string;
  /** The Origin header; defaults to the site's own origin when `as` is given. */
  origin?: string | null;
  /** A JSON body, or a raw string body. */
  body?: unknown;
  headers?: Record<string, string>;
}

/** One response api() received, kept to compare with the OpenAPI document. */
export interface RecordedResponse {
  method: string;
  path: string;
  status: number;
  body: unknown;
  /** The response's headers, as one string. */
  headers: string;
}

/** Every response api() received in the current test file. */
export const recordedResponses: RecordedResponse[] = [];

/** Every AI key a test saved through the API in the current test file. */
export const savedKeys = new Set<string>();

/** Sends a request through the Worker, as a browser or a script would. */
export async function api(
  method: string,
  path: string,
  opts: ApiOptions = {},
): Promise<ApiResponse> {
  const headers = new Headers(opts.headers);
  if (opts.as !== undefined) {
    headers.set('Cookie', `alexandria_session=${opts.as}`);
    const origin = opts.origin === undefined ? ORIGIN : opts.origin;
    if (origin !== null) headers.set('Origin', origin);
  } else if (opts.origin) {
    headers.set('Origin', opts.origin);
  }
  if (opts.bearer !== undefined) headers.set('Authorization', `Bearer ${opts.bearer}`);
  const apiKey = (opts.body as { api_key?: unknown } | undefined)?.api_key;
  if (typeof apiKey === 'string' && apiKey.length > 4) savedKeys.add(apiKey);
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData || opts.body instanceof Uint8Array) {
    // An upload: sent as given, with its own type (multipart's boundary, or opts.headers).
    body = opts.body as BodyInit;
  } else if (opts.body !== undefined) {
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  }
  const response = await SELF.fetch(new URL(path, ORIGIN), {
    method,
    headers,
    body,
    redirect: 'manual',
  });
  let json: unknown = null;
  if (response.headers.get('Content-Type')?.includes('application/json')) {
    const text = await response.clone().text();
    if (text) json = JSON.parse(text);
  }
  recordedResponses.push({
    method,
    path: new URL(path, ORIGIN).pathname,
    status: response.status,
    body: json,
    headers: [...response.headers].map(([k, v]) => `${k}: ${v}`).join('\n'),
  });
  return { status: response.status, headers: response.headers, json, response };
}

/** Counts the rows of a table, optionally filtered by a WHERE clause. */
export async function count(table: string, where = '1 = 1', ...params: unknown[]): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)
    .bind(...params)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** A user stored for a test. */
export interface TestUser {
  id: string;
  email: string;
  name: string;
  /** The session cookie value of the user's session. */
  session: string;
}

/**
 * Stores a user with a fresh 30-day session, as a completed sign-in leaves it,
 * and returns the user with the session cookie value.
 */
export async function signIn(email = 'owner@example.test', name = 'Ada Owner'): Promise<TestUser> {
  const nowIso = now().toISOString();
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  if (!existing) {
    await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, email.toLowerCase(), name, nowIso)
      .run();
  }
  const session = randomSecret();
  const expires = new Date(now().getTime() + 30 * 24 * 3600 * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(await sha256Hex(session), id, nowIso, expires)
    .run();
  return { id, email: email.toLowerCase(), name, session };
}

/** Stores a personal access token for `user` and returns its id and secret. */
export async function createToken(
  user: TestUser,
  name = 'test token',
): Promise<{ id: string; secret: string }> {
  const id = crypto.randomUUID();
  const secret = `alx_${randomSecret()}`;
  await env.DB.prepare(
    'INSERT INTO tokens (id, user_id, name, secret_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, user.id, name, await sha256Hex(secret), now().toISOString())
    .run();
  return { id, secret };
}

/** A link to seed directly into the store. */
export interface SeedLink {
  url: string;
  lastUsedAt?: string;
  addedAt?: string;
  state?: string;
  pinPosition?: number | null;
  useCount?: number;
}

/** Stores links for `user` directly, bypassing the API, and returns their ids in order. */
export async function seedLinks(user: TestUser, links: SeedLink[]): Promise<string[]> {
  const ids: string[] = [];
  const statements: D1PreparedStatement[] = [];
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  links.forEach((l, i) => {
    const id = crypto.randomUUID();
    ids.push(id);
    const host = new URL(l.url).host;
    const at = l.lastUsedAt ?? new Date(base + i * 1000).toISOString();
    statements.push(
      env.DB.prepare(
        `INSERT INTO links (id, user_id, url, original_url, host, title, state, added_at,
           last_used_at, use_count, pin_position, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        user.id,
        l.url,
        l.url,
        host,
        host,
        l.state ?? 'pending',
        l.addedAt ?? at,
        at,
        l.useCount ?? 0,
        l.pinPosition ?? null,
        at,
      ),
    );
  });
  for (let i = 0; i < statements.length; i += 500) {
    await env.DB.batch(statements.slice(i, i + 500));
  }
  return ids;
}

/** One message the Worker sent on a queue. */
export interface SentMessage<T = unknown> {
  body: T;
  delaySeconds?: number;
}

/** A queue that records what is sent on it instead of delivering it. */
function recorder<T>(sent: SentMessage<T>[]): Queue<T> {
  return {
    async send(body: T, options?: QueueSendOptions) {
      sent.push({ body, delaySeconds: options?.delaySeconds });
    },
    async sendBatch(messages: Iterable<MessageSendRequest<T>>) {
      for (const m of messages) sent.push({ body: m.body, delaySeconds: m.delaySeconds });
    },
  } as unknown as Queue<T>;
}

/** Replaces FETCH_QUEUE with a recorder for this test; returns the recorded messages. */
export function recordFetchQueue(): SentMessage<FetchMessage>[] {
  const sent: SentMessage<FetchMessage>[] = [];
  env.FETCH_QUEUE = recorder(sent);
  return sent;
}

/** Replaces ACCOUNT_QUEUE with a recorder for this test; returns the recorded messages. */
export function recordAccountQueue(): SentMessage<AccountMessage>[] {
  const sent: SentMessage<AccountMessage>[] = [];
  env.ACCOUNT_QUEUE = recorder(sent);
  return sent;
}

/** Replaces INDEX_QUEUE with a recorder for this test; returns the recorded messages. */
export function recordIndexQueue(): SentMessage<IndexMessage>[] {
  const sent: SentMessage<IndexMessage>[] = [];
  env.INDEX_QUEUE = recorder(sent);
  return sent;
}

/** Replaces LIVENESS_QUEUE with a recorder for this test; returns the recorded messages. */
export function recordLivenessQueue(): SentMessage<LivenessMessage>[] {
  const sent: SentMessage<LivenessMessage>[] = [];
  env.LIVENESS_QUEUE = recorder(sent);
  return sent;
}

/** Delivers liveness messages to the Worker's queue consumer in one batch. */
export async function deliverLiveness(
  bodies: LivenessMessage[],
  bindings: Partial<Cloudflare.Env> = {},
): Promise<{ acked: string[]; retried: string[] }> {
  return deliver('alexandria-liveness', bodies, bindings);
}

/** Replaces ENRICH_QUEUE with a recorder for this test; returns the recorded messages. */
export function recordEnrichQueue(): SentMessage<EnrichMessage>[] {
  const sent: SentMessage<EnrichMessage>[] = [];
  env.ENRICH_QUEUE = recorder(sent);
  return sent;
}

/**
 * Delivers fetch messages to the Worker's queue consumer in one batch, with
 * `bindings` replacing some of env (to make a write fail), and returns which
 * messages were acknowledged and which handed back for retry.
 */
export async function deliverFetches(
  bodies: FetchMessage[],
  bindings: Partial<Cloudflare.Env> = {},
): Promise<{ acked: string[]; retried: string[] }> {
  return deliver('alexandria-fetch', bodies, bindings);
}

/** Delivers account deletion messages to the Worker's queue consumer in one batch. */
export async function deliverAccount(
  bodies: AccountMessage[],
  bindings: Partial<Cloudflare.Env> = {},
): Promise<{ acked: string[]; retried: string[] }> {
  return deliver('alexandria-account', bodies, bindings);
}

/** Runs the Worker's every-minute scheduled handler once, as its Cron Trigger would, at the current clock. */
export async function runEveryMinute(): Promise<void> {
  const ctx = createExecutionContext();
  await worker.scheduled?.(createScheduledController({ cron: '* * * * *' }), env, ctx);
  await waitOnExecutionContext(ctx);
}

/** Delivers indexing messages to the Worker's queue consumer in one batch. */
export async function deliverIndexing(
  bodies: IndexMessage[],
  bindings: Partial<Cloudflare.Env> = {},
): Promise<{ acked: string[]; retried: string[] }> {
  return deliver('alexandria-index', bodies, bindings);
}

/** Delivers enrichment messages to the Worker's queue consumer in one batch. */
export async function deliverEnrichments(
  bodies: EnrichMessage[],
  bindings: Partial<Cloudflare.Env> = {},
): Promise<{ acked: string[]; retried: string[] }> {
  return deliver('alexandria-enrich', bodies, bindings);
}

async function deliver<T>(
  queue: string,
  bodies: T[],
  bindings: Partial<Cloudflare.Env>,
): Promise<{ acked: string[]; retried: string[] }> {
  const batch = createMessageBatch<T>(
    queue,
    bodies.map((body, i) => ({ id: `m${i}`, timestamp: new Date(), attempts: 1, body })),
  );
  const ctx = createExecutionContext();
  await worker.queue?.(
    batch as unknown as MessageBatch<
      FetchMessage | EnrichMessage | LivenessMessage | AccountMessage | IndexMessage
    >,
    { ...env, ...bindings },
    ctx,
  );
  const result = await getQueueResult(batch, ctx);
  return {
    acked: result.explicitAcks,
    retried: result.retryMessages.map((m) => m.msgId),
  };
}

/**
 * Adds `url` for `user` through the API and delivers its fetch message to the
 * consumer; returns the link's id, the delivery, the messages sent and the
 * link's R2 prefix.
 */
export async function addAndFetch(
  user: TestUser,
  url: string,
  bindings: Partial<Cloudflare.Env> = {},
) {
  const sent = recordFetchQueue();
  const r = await api('POST', '/api/v1/links', { as: user.session, body: { url } });
  const id: string = r.json.link.id;
  const delivery = await deliverFetches(
    sent.map((m) => m.body),
    bindings,
  );
  return { id, delivery, sent, prefix: `u/${user.id}/l/${id}/` };
}

/** The links of the filter tests, by name. */
export interface FilterLinks {
  a: string;
  b: string;
  c: string;
}

/**
 * Seeds the filter table's links through the API: a (tags cloudflare and
 * queues, host developers.cloudflare.com, topic Infrastructure, in workspace
 * Work, pinned), b (tag cloudflare, host cloudflare.com, dead) and c (no
 * tags, host notcloudflare.com). Only a holds the word 'queues'.
 */
export async function seedFilterLinks(user: TestUser): Promise<FilterLinks> {
  const add = async (url: string, edit: Record<string, unknown>) => {
    const r = await api('POST', '/api/v1/links', { as: user.session, body: { url } });
    const id: string = r.json.link.id;
    await api('PATCH', `/api/v1/links/${id}`, { as: user.session, body: edit });
    return id;
  };
  const c = await add('https://notcloudflare.com/', { title: 'Not Cloudflare' });
  const b = await add('https://cloudflare.com/', { title: 'Cloudflare', tags: ['cloudflare'] });
  const a = await add('https://developers.cloudflare.com/queues', {
    title: 'Cloudflare Queues',
    tags: ['cloudflare', 'queues'],
    topic: 'Infrastructure',
  });
  const ws = await api('POST', '/api/v1/workspaces', { as: user.session, body: { name: 'Work' } });
  await api('POST', `/api/v1/workspaces/${ws.json.id}/links`, {
    as: user.session,
    body: { link_id: a },
  });
  await api('POST', `/api/v1/links/${a}/pin`, { as: user.session });
  await env.DB.prepare('UPDATE links SET dead_since = ? WHERE id = ?')
    .bind('2026-01-01T00:00:00.000Z', b)
    .run();
  return { a, b, c };
}

/** The filter table: each query and the links it finds. */
export const FILTER_TABLE: [string, (keyof FilterLinks)[]][] = [
  ['tag:Cloudflare', ['a', 'b']],
  ['tag:cloudflare tag:queues', ['a']],
  ['topic:infrastructure', ['a']],
  ['host:cloudflare.com', ['a', 'b']],
  ['in:work', ['a']],
  ['in:"no such workspace"', []],
  ['is:pinned', ['a']],
  ['is:dead', ['b']],
];

/** A response of the MCP endpoint, with its parsed JSON body. */
export interface McpResponse {
  status: number;
  headers: Headers;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

let mcpRequestId = 0;

/**
 * Sends one JSON-RPC request to POST /mcp, as an agent does: with the bearer
 * secret (or none), and `init` changing the method or adding headers.
 */
export async function mcp(
  bearer: string | null,
  method: string,
  params?: unknown,
  init: { method?: string; headers?: Record<string, string> } = {},
): Promise<McpResponse> {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...init.headers,
  });
  if (bearer !== null) headers.set('Authorization', `Bearer ${bearer}`);
  const httpMethod = init.method ?? 'POST';
  const response = await SELF.fetch(new URL('/mcp', ORIGIN), {
    method: httpMethod,
    headers,
    body:
      httpMethod === 'POST'
        ? JSON.stringify({ jsonrpc: '2.0', id: ++mcpRequestId, method, params })
        : undefined,
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, headers: response.headers, json };
}

/** A tool's result as an agent receives it. */
export interface ToolResult {
  isError?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  structuredContent: any;
  content: { type: string; text: string }[];
  /** The whole JSON-RPC response. */
  response: McpResponse;
}

/** Calls an MCP tool with the bearer secret and returns its result. */
export async function mcpTool(bearer: string, name: string, args: unknown): Promise<ToolResult> {
  const response = await mcp(bearer, 'tools/call', { name, arguments: args });
  return { ...(response.json?.result ?? {}), response };
}

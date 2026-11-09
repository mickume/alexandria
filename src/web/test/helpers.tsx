/**
 * Shared helpers of the website tests: a fake API standing in for the Worker,
 * and renderPage, which renders the website at a path against it.
 */
import { render, type RenderResult } from '@testing-library/react';
import { App } from '../App';
import type { Link } from '../api';

/** One request the website sent to the fake API. */
export interface RecordedRequest {
  method: string;
  /** The path with its query string. */
  path: string;
  body: unknown;
  keepalive: boolean;
}

type Answer =
  | {
      status: number;
      /** A JSON body. */
      body?: unknown;
      /** A body that is not JSON, such as an event stream, sent as it is. */
      text?: string;
      /** A body the test feeds while the page reads it. */
      stream?: ReadableStream<Uint8Array>;
      headers?: Record<string, string>;
    }
  | 'network-error';
type Handler = (req: RecordedRequest, params: Record<string, string>) => Answer | Promise<Answer>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

/** A fake of the Worker's API that the website's fetch calls reach in tests. */
export class FakeApi {
  readonly requests: RecordedRequest[] = [];
  private routes: Route[] = [];

  /**
   * Answers `method` requests whose path (without the query) matches `path`,
   * where `:name` segments match any one segment. Later routes win.
   */
  on(method: string, path: string, handler: Handler | Answer): this {
    const keys: string[] = [];
    const source = path.replace(/:[a-zA-Z]+/g, (m) => {
      keys.push(m.slice(1));
      return '([^/]+)';
    });
    const h: Handler = typeof handler === 'function' ? handler : () => handler;
    this.routes.unshift({ method, pattern: new RegExp(`^${source}$`), keys, handler: h });
    return this;
  }

  /** The recorded requests with this method whose path starts with `prefix`. */
  sent(method: string, prefix = ''): RecordedRequest[] {
    return this.requests.filter((r) => r.method === method && r.path.startsWith(prefix));
  }

  /** The fetch function the website uses while this fake is installed. */
  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      window.location.origin,
    );
    const method = (init?.method ?? 'GET').toUpperCase();
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as unknown)
        : init?.body instanceof FormData
          ? init.body
          : undefined;
    const req: RecordedRequest = {
      method,
      path: url.pathname + url.search,
      body,
      keepalive: init?.keepalive === true,
    };
    this.requests.push(req);
    for (const route of this.routes) {
      const m = route.method === method ? route.pattern.exec(url.pathname) : null;
      if (!m) continue;
      const params = Object.fromEntries(route.keys.map((k, i) => [k, m[i + 1] ?? '']));
      const answer = await route.handler(req, params);
      if (answer === 'network-error') throw new TypeError('Failed to fetch');
      const headers = new Headers(answer.headers);
      if (answer.body !== undefined) headers.set('Content-Type', 'application/json');
      const raw = answer.stream ?? answer.text;
      return new Response(raw ?? (answer.body === undefined ? null : JSON.stringify(answer.body)), {
        status: answer.status,
        headers,
      });
    }
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

/** Makes the website's requests reach `api`. */
export function installFakeApi(api: FakeApi): FakeApi {
  globalThis.fetch = api.fetch as typeof fetch;
  return api;
}

/** Renders the website at `path` (with its query string) against `api`. */
export function renderPage(
  path: string,
  api: FakeApi = new FakeApi(),
): RenderResult & { api: FakeApi } {
  window.history.replaceState(null, '', path);
  installFakeApi(api);
  return { ...render(<App />), api };
}

/**
 * Replaces IntersectionObserver with a fake whose entries the test triggers,
 * since the test DOM lays nothing out. Returns `reveal`, which reports every
 * observed element as visible.
 */
export function fakeIntersectionObserver(): { reveal: () => void } {
  const observers = new Set<{ cb: IntersectionObserverCallback; els: Set<Element> }>();
  class FakeObserver {
    private entry: { cb: IntersectionObserverCallback; els: Set<Element> };
    constructor(cb: IntersectionObserverCallback) {
      this.entry = { cb, els: new Set() };
      observers.add(this.entry);
    }
    observe(el: Element) {
      this.entry.els.add(el);
    }
    unobserve(el: Element) {
      this.entry.els.delete(el);
    }
    disconnect() {
      observers.delete(this.entry);
    }
    takeRecords() {
      return [];
    }
  }
  globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
  return {
    reveal: () => {
      for (const { cb, els } of [...observers]) {
        const entries = [...els].map(
          (target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry,
        );
        if (entries.length) cb(entries, {} as IntersectionObserver);
      }
    },
  };
}

/** A link as the API shows it, pending and never used, with `overrides`. */
export function makeLink(overrides: Partial<Link> & { id: string }): Link {
  const host = overrides.host ?? `${overrides.id}.example`;
  return {
    url: `https://${host}/`,
    original_url: `https://${host}/`,
    host,
    title: host,
    state: 'pending',
    added_at: '2026-03-04T10:00:00.000Z',
    last_used_at: '2026-03-05T10:00:00.000Z',
    use_count: 0,
    pinned: false,
    pin_position: null,
    final_url: null,
    http_status: null,
    description: null,
    favicon_url: null,
    language: null,
    fetched_at: null,
    state_reason: null,
    notes: [],
    content_kind: null,
    has_snapshot: false,
    updated_at: '2026-03-05T10:00:00.000Z',
    summary: null,
    tags: [],
    topic: null,
    enrichment_status: null,
    enrichment_reason: null,
    edited_fields: [],
    note_preview: null,
    workspaces: [],
    sticky: false,
    points: 60,
    expired_at: null,
    removal_at: null,
    dead_since: null,
    last_checked_at: null,
    last_check_result: null,
    decay_note: 'unused for 3 days',
    ...overrides,
  };
}

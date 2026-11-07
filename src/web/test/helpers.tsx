/**
 * Shared helpers of the website tests: a fake API standing in for the Worker,
 * and renderPage, which renders the website at a path against it.
 */
import { render, type RenderResult } from '@testing-library/react';
import { App } from '../App';

/** One request the website sent to the fake API. */
export interface RecordedRequest {
  method: string;
  /** The path with its query string. */
  path: string;
  body: unknown;
  keepalive: boolean;
}

type Answer =
  { status: number; body?: unknown; headers?: Record<string, string> } | 'network-error';
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
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
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
      return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
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

/** Renders the website at `path` (with its query string) against `api`. */
export function renderPage(
  path: string,
  api: FakeApi = new FakeApi(),
): RenderResult & { api: FakeApi } {
  window.history.replaceState(null, '', path);
  globalThis.fetch = api.fetch as typeof fetch;
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

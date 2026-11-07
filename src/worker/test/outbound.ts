/**
 * Answers the Worker's outbound requests in tests. The main Worker runs in the
 * test isolate, so replacing the isolate's fetch reaches every outbound call it
 * makes (arctic's token exchange, and later fetches of pages and AI calls).
 * Tests register a handler per origin; a request no handler claims fails the
 * test, so no test reaches the network.
 */
type Handler = (request: Request) => Response | Promise<Response>;

interface Route {
  origin: string;
  handler: Handler;
}

let routes: Route[] = [];

/** The requests the Worker sent, in order. */
export const outboundRequests: Request[] = [];

/** Answers every outbound request to `origin` (such as https://google.test) with `handler`. */
export function onOutbound(origin: string, handler: Handler): void {
  routes = routes.filter((r) => r.origin !== origin);
  routes.push({ origin, handler });
}

/** Removes every registered handler and forgets the recorded requests. */
export function resetOutbound(): void {
  routes = [];
  outboundRequests.length = 0;
}

/** Replaces the isolate's fetch with the router. */
export function installOutbound(): void {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request: Request = new Request(input, init);
    const url = new URL(request.url);
    const route = routes.find((r) => r.origin === url.origin);
    if (!route) {
      throw new Error(`unexpected outbound request: ${request.method} ${request.url}`);
    }
    outboundRequests.push(request.clone() as Request);
    const answer = Promise.resolve(route.handler(request));
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (!signal) return answer;
    // A caller's abort (a timeout) ends the request, as it would on the network.
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      answer.then(resolve, reject);
    });
  };
}

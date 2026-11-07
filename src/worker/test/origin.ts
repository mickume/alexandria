/**
 * A fake of the origin sites links point at, for the fetcher's tests. Each
 * route answers one URL: a page, a redirect, a stall, a refused connection or
 * a streamed body. Every request it receives is logged with its arrival time.
 * It answers through the outbound router, so the real fetch code is exercised.
 */
import { onOutbound } from './outbound';

/** One request an origin received. */
export interface OriginRequest {
  method: string;
  url: string;
  headers: Headers;
  at: number;
}

type Behaviour = (request: Request) => Response | Promise<Response>;

const CHUNK = 64 * 1024;

export class FakeOrigin {
  /** Every request the fake origins received, in order. */
  readonly log: OriginRequest[] = [];
  /** Bytes of streamed bodies sent so far. */
  bytesSent = 0;
  private routes = new Map<string, Behaviour>();
  private origins = new Set<string>();
  private offline = false;

  /** Answers `url` with `behaviour`. */
  serve(url: string, behaviour: Behaviour): this {
    const target = new URL(url);
    this.routes.set(target.href, behaviour);
    if (!this.origins.has(target.origin)) {
      this.origins.add(target.origin);
      onOutbound(target.origin, (request) => this.dispatch(request));
    }
    return this;
  }

  /** Serves `body` at `url`. */
  page(
    url: string,
    body: string | Uint8Array,
    contentType = 'text/html; charset=utf-8',
    status = 200,
  ): this {
    return this.serve(
      url,
      () => new Response(body as BodyInit, { status, headers: { 'Content-Type': contentType } }),
    );
  }

  /** Answers `url` with an empty response of `status`. */
  status(url: string, status: number): this {
    return this.serve(url, () => new Response(`status ${status}`, { status }));
  }

  /** Redirects `from` to `to`. */
  redirect(from: string, to: string, status = 302): this {
    return this.serve(from, () => new Response(null, { status, headers: { Location: to } }));
  }

  /** Sends the headers of `url`, then never finishes the body. */
  stall(url: string, contentType = 'text/html'): this {
    return this.serve(
      url,
      () =>
        new Response(new ReadableStream({ start() {} }), {
          headers: { 'Content-Type': contentType },
        }),
    );
  }

  /** Fails every request to `url` as the runtime does, with `message`. */
  fail(url: string, message: string): this {
    return this.serve(url, () => {
      throw new Error(message);
    });
  }

  /** Sends the headers and a first chunk of `url`, then breaks the connection. */
  reset(url: string): this {
    return this.serve(url, () => {
      let sent = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent) {
            controller.error(new Error('read ECONNRESET'));
            return;
          }
          sent = true;
          controller.enqueue(new TextEncoder().encode('<!doctype html><p>'));
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'text/html' } });
    });
  }

  /** Streams `size` bytes of `fill` at `url` in 64 KB chunks, counting what was sent. */
  stream(
    url: string,
    size: number,
    contentType: string,
    { contentLength = false, prefix = '' } = {},
  ): this {
    return this.serve(url, () => {
      let sent = 0;
      const head = new TextEncoder().encode(prefix);
      const body = new ReadableStream<Uint8Array>(
        {
          pull: (controller) => {
            if (sent >= size) {
              controller.close();
              return;
            }
            const n = Math.min(CHUNK, size - sent);
            const chunk = new Uint8Array(n).fill(0x61);
            if (sent === 0) chunk.set(head.subarray(0, n));
            sent += n;
            this.bytesSent += n;
            controller.enqueue(chunk);
          },
        },
        // Nothing is produced ahead of the reader, so bytesSent counts what was asked for.
        { highWaterMark: 0 },
      );
      const headers: Record<string, string> = { 'Content-Type': contentType };
      if (contentLength) headers['Content-Length'] = String(size);
      return new Response(body, { headers });
    });
  }

  /** From now on, every request fails as a refused connection. */
  goOffline(): void {
    this.offline = true;
  }

  /** Forgets the requests logged so far. */
  clearLog(): void {
    this.log.length = 0;
  }

  private async dispatch(request: Request): Promise<Response> {
    this.log.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      at: Date.now(),
    });
    if (this.offline) throw new Error('connect ECONNREFUSED');
    const behaviour = this.routes.get(new URL(request.url).href);
    if (!behaviour) return new Response('not found', { status: 404 });
    return behaviour(request);
  }
}

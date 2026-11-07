import { app } from './app';
import type { Env, FetchMessage } from './env';
import { handleFetchBatch } from './fetcher/queue';

export { HostGate } from './fetcher/hostgate';

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  queue(batch, env, ctx) {
    return handleFetchBatch(batch, env, ctx);
  },
} satisfies ExportedHandler<Env, FetchMessage>;

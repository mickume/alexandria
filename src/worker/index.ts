import { app } from './app';
import { handleEnrichBatch } from './enrich/queue';
import type { EnrichMessage, Env, FetchMessage } from './env';
import { handleFetchBatch } from './fetcher/queue';

export { HostGate } from './fetcher/hostgate';

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  queue(batch, env, ctx) {
    if (batch.queue === 'alexandria-enrich') {
      return handleEnrichBatch(batch as MessageBatch<EnrichMessage>, env);
    }
    return handleFetchBatch(batch as MessageBatch<FetchMessage>, env, ctx);
  },
} satisfies ExportedHandler<Env, FetchMessage | EnrichMessage>;

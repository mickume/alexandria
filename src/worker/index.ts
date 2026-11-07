import { app } from './app';
import { runScheduled } from './decay/cron';
import { handleEnrichBatch } from './enrich/queue';
import { handleLivenessBatch } from './decay/liveness';
import type { EnrichMessage, Env, FetchMessage, LivenessMessage } from './env';
import { handleFetchBatch } from './fetcher/queue';

export { HostGate } from './fetcher/hostgate';

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduled(env));
  },
  queue(batch, env, ctx) {
    if (batch.queue === 'alexandria-liveness') {
      return handleLivenessBatch(batch as MessageBatch<LivenessMessage>, env);
    }
    if (batch.queue === 'alexandria-enrich') {
      return handleEnrichBatch(batch as MessageBatch<EnrichMessage>, env);
    }
    return handleFetchBatch(batch as MessageBatch<FetchMessage>, env, ctx);
  },
} satisfies ExportedHandler<Env, FetchMessage | EnrichMessage | LivenessMessage>;

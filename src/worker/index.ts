import { handleAccountBatch } from './account/deletion';
import { SWEEP_CRON, sweepDeletions } from './account/sweep';
import { app } from './app';
import { runScheduled } from './decay/cron';
import { handleEnrichBatch } from './enrich/queue';
import { handleLivenessBatch } from './decay/liveness';
import type { AccountMessage, EnrichMessage, Env, FetchMessage, LivenessMessage } from './env';
import { handleFetchBatch } from './fetcher/queue';
import { DISPATCH_CRON, dispatchAllImports } from './imports/dispatch';

export { HostGate } from './fetcher/hostgate';

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    // Every minute: imported links; every 5 minutes: account deletions; every hour: decay and liveness.
    const run =
      controller.cron === DISPATCH_CRON
        ? dispatchAllImports(env)
        : controller.cron === SWEEP_CRON
          ? sweepDeletions(env)
          : runScheduled(env);
    ctx.waitUntil(run);
  },
  queue(batch, env, ctx) {
    if (batch.queue === 'alexandria-liveness') {
      return handleLivenessBatch(batch as MessageBatch<LivenessMessage>, env);
    }
    if (batch.queue === 'alexandria-account') {
      return handleAccountBatch(batch as MessageBatch<AccountMessage>, env);
    }
    if (batch.queue === 'alexandria-enrich') {
      return handleEnrichBatch(batch as MessageBatch<EnrichMessage>, env);
    }
    return handleFetchBatch(batch as MessageBatch<FetchMessage>, env, ctx);
  },
} satisfies ExportedHandler<Env, FetchMessage | EnrichMessage | LivenessMessage | AccountMessage>;

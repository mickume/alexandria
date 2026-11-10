import { handleAccountBatch } from './account/deletion';
import { SWEEP_CRON, sweepDeletions } from './account/sweep';
import { app } from './app';
import { runScheduled } from './decay/cron';
import { handleEnrichBatch } from './enrich/queue';
import { handleLivenessBatch } from './decay/liveness';
import type {
  AccountMessage,
  EnrichMessage,
  Env,
  FetchMessage,
  IndexMessage,
  LivenessMessage,
} from './env';
import { handleFetchBatch } from './fetcher/queue';
import { DISPATCH_CRON, dispatchAllImports } from './imports/dispatch';
import { maintainIndex } from './meaning/backfill';
import { handleIndexBatch } from './meaning/indexing';

export { HostGate } from './fetcher/hostgate';

/** The every-minute jobs, each run whatever the others do. */
async function everyMinute(env: Env): Promise<void> {
  const jobs = await Promise.allSettled([dispatchAllImports(env), maintainIndex(env)]);
  for (const job of jobs) {
    if (job.status === 'rejected') console.error('an every-minute job failed', job.reason);
  }
}

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    // Every minute: imported links and the index; every 5 minutes: account deletions; every hour:
    // decay and liveness.
    const run =
      controller.cron === DISPATCH_CRON
        ? everyMinute(env)
        : controller.cron === SWEEP_CRON
          ? sweepDeletions(env)
          : runScheduled(env);
    ctx.waitUntil(run);
  },
  queue(batch, env, _ctx) {
    if (batch.queue === 'alexandria-liveness') {
      return handleLivenessBatch(batch as MessageBatch<LivenessMessage>, env);
    }
    if (batch.queue === 'alexandria-index') {
      return handleIndexBatch(batch as MessageBatch<IndexMessage>, env);
    }
    if (batch.queue === 'alexandria-account') {
      return handleAccountBatch(batch as MessageBatch<AccountMessage>, env);
    }
    if (batch.queue === 'alexandria-enrich') {
      return handleEnrichBatch(batch as MessageBatch<EnrichMessage>, env);
    }
    return handleFetchBatch(batch as MessageBatch<FetchMessage>, env);
  },
} satisfies ExportedHandler<
  Env,
  FetchMessage | EnrichMessage | LivenessMessage | AccountMessage | IndexMessage
>;

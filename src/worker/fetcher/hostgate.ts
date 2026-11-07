import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

/** The least time between two requests Alexandria sends to one host. */
export const HOST_INTERVAL_MS = 1000;
/** Slots are spaced a little wider, so that timer jitter never brings two requests closer. */
const SLOT_MS = HOST_INTERVAL_MS + 50;

/**
 * The per-host rate limit: one instance per host name hands out request
 * slots at least HOST_INTERVAL_MS apart, across every user, link, refresh and
 * background job. A Durable Object handles one call at a time, so two callers
 * never get the same slot.
 */
export class HostGate extends DurableObject<Env> {
  private next = 0;

  /** Reserves the next slot and returns its time, in milliseconds since the epoch. */
  async slot(): Promise<number> {
    const at = Math.max(Date.now(), this.next);
    this.next = at + SLOT_MS;
    return at;
  }
}

/** Waits until a request to `host` may be sent. */
export async function waitForHost(env: Env, host: string): Promise<void> {
  const gate = env.HOST_GATE.get(env.HOST_GATE.idFromName(host.toLowerCase()));
  const at = await gate.slot();
  while (Date.now() < at) {
    await new Promise((resolve) => setTimeout(resolve, at - Date.now()));
  }
}

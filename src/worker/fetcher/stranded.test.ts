import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../index';
import { api, env, recordFetchQueue, seedLinks, setNow, signIn } from '../test/helpers';

const T = Date.parse('2026-10-01T12:00:00.000Z');
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(T - hours * HOUR).toISOString();

/** Runs the Worker's scheduled handler as the hourly Cron Trigger would. */
async function runHourly(): Promise<void> {
  const ctx = createExecutionContext();
  await worker.scheduled?.(createScheduledController({ cron: '0 * * * *' }), env, ctx);
  await waitOnExecutionContext(ctx);
}

async function row(id: string) {
  return env.DB.prepare(
    'SELECT state, state_reason, fetch_attempts, enrichment_status, enrichment_reason FROM links WHERE id = ?',
  )
    .bind(id)
    .first<Record<string, unknown>>();
}

describe('a link whose fetch message was lost', () => {
  it.each([
    { label: 'never tried', attempts: 0, hours: 4, resent: true, state: 'pending', after: 1 },
    { label: 'tried once', attempts: 1, hours: 4, resent: true, state: 'pending', after: 2 },
    {
      label: 'at its last attempt',
      attempts: 2,
      hours: 4,
      resent: false,
      state: 'unreachable',
      after: 3,
    },
    {
      label: 'touched two hours ago',
      attempts: 1,
      hours: 2,
      resent: false,
      state: 'pending',
      after: 1,
    },
  ])('$label: $state after the hourly run', async (c) => {
    setNow(T);
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [
      { url: 'https://lost.example/', lastUsedAt: ago(c.hours), decayFrom: ago(0) },
    ]);
    await env.DB.prepare('UPDATE links SET fetch_attempts = ? WHERE id = ?')
      .bind(c.attempts, id)
      .run();
    const sent = recordFetchQueue();
    await runHourly();
    expect(sent.map((m) => m.body)).toEqual(c.resent ? [{ user_id: user.id, link_id: id }] : []);
    expect(await row(id)).toMatchObject({
      state: c.state,
      fetch_attempts: c.after,
      state_reason: c.state === 'unreachable' ? 'the fetch did not complete' : null,
    });
  });

  it('is left to the import dispatcher while it waits for it', async () => {
    setNow(T - 4 * HOUR);
    const user = await signIn();
    await api('POST', '/api/v1/imports', {
      as: user.session,
      body: new TextEncoder().encode('https://imported.example/\n'),
      headers: { 'Content-Type': 'text/plain' },
    });
    // The upload's own dispatch sent it: make it wait again, as beyond the budget.
    await env.DB.prepare('UPDATE import_links SET dispatched_at = NULL').run();
    setNow(T);
    const sent = recordFetchQueue();
    await runHourly();
    expect(sent).toEqual([]);
  });
});

describe('a link whose enrichment message was lost', () => {
  it.each([
    { label: 'no slot ahead', throttle: null, status: 'failed' },
    { label: 'a throttled slot still ahead', throttle: T + HOUR, status: 'queued' },
  ])('with $label it is $status after the hourly run', async ({ throttle, status }) => {
    setNow(T);
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [
      { url: 'https://waiting.example/', state: 'active', lastUsedAt: ago(4), decayFrom: ago(0) },
    ]);
    await env.DB.batch([
      env.DB.prepare("UPDATE links SET enrichment_status = 'queued' WHERE id = ?").bind(id),
      env.DB.prepare('UPDATE users SET throttle_next_at = ? WHERE id = ?').bind(throttle, user.id),
    ]);
    await runHourly();
    expect(await row(id)).toMatchObject({
      enrichment_status: status,
      enrichment_reason: status === 'failed' ? 'the enrichment did not complete' : null,
    });
  });
});

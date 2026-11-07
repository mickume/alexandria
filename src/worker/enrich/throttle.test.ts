import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FakeAi } from '../test/ai';
import { FakeOrigin } from '../test/origin';
import {
  addAndFetch,
  api,
  deliverEnrichments,
  env,
  recordEnrichQueue,
  setNow,
  signIn,
} from '../test/helpers';
import { blogArticle } from '../fetcher/fixtures/pages';
import { scheduleThrottled, sendThrottled } from './throttle';

const T = Date.parse('2026-11-01T08:00:00.000Z');
const HOUR = 3_600_000;

describe('the background throttle', () => {
  it('spaces a user’s jobs 3 seconds apart, from now once the queue has drained', async () => {
    const user = await signIn();
    setNow(T);
    const slots = await scheduleThrottled(env.DB, user.id, 600);
    expect(slots).toEqual(Array.from({ length: 600 }, (_, i) => T + 3_000 * i));
    expect(slots.at(-1)! - T).toBe(1_797_000);
    setNow(T + 3 * HOUR);
    expect(await scheduleThrottled(env.DB, user.id, 1)).toEqual([T + 3 * HOUR]);
  });

  it('never starts more than 20 of a user’s jobs in any minute', async () => {
    const user = await signIn();
    const call = fc.record({
      offset: fc.integer({ min: 0, max: 600_000 }),
      size: fc.integer({ min: 1, max: 200 }),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(call, { minLength: 1, maxLength: 8 }), async (calls) => {
        await env.DB.prepare('UPDATE users SET throttle_next_at = NULL WHERE id = ?')
          .bind(user.id)
          .run();
        const all: number[] = [];
        let t = T;
        for (const c of calls) {
          t += c.offset;
          setNow(t);
          const slots = await scheduleThrottled(env.DB, user.id, c.size);
          for (const s of slots) expect(s).toBeGreaterThanOrEqual(t);
          all.push(...slots);
        }
        all.sort((a, b) => a - b);
        for (let i = 0, j = 0; i < all.length; i++) {
          while (all[j]! < all[i]! + 60_000 && j < all.length) j++;
          expect(j - i).toBeLessThanOrEqual(20);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('keeps users independent', async () => {
    const a = await signIn('a@example.test', 'A');
    const b = await signIn('b@example.test', 'B');
    setNow(T);
    await scheduleThrottled(env.DB, a.id, 600);
    expect(await scheduleThrottled(env.DB, b.id, 1)).toEqual([T]);
  });

  it('sends a job more than 12 hours away with the longest delay, and again on early arrival', async () => {
    new FakeOrigin().page('https://later.example/', blogArticle);
    const ai = new FakeAi();
    const user = await signIn();
    await api('PUT', '/api/v1/settings/ai', {
      as: user.session,
      body: { provider: 'anthropic', api_key: 'sk-ant-abcd1234' },
    });
    recordEnrichQueue();
    const { id } = await addAndFetch(user, 'https://later.example/');
    const before = ai.enrichments.length;
    setNow(T);
    await env.DB.prepare('UPDATE users SET throttle_next_at = ? WHERE id = ?')
      .bind(T + 14 * HOUR, user.id)
      .run();
    const sent = recordEnrichQueue();
    await sendThrottled(env, user.id, [id]);
    expect(sent).toEqual([
      {
        body: { user_id: user.id, link_id: id, attempt: 1, slot: T + 14 * HOUR },
        delaySeconds: 43_200,
      },
    ]);

    setNow(T + 12 * HOUR);
    const again = recordEnrichQueue();
    await deliverEnrichments([sent[0]!.body]);
    expect(again).toEqual([{ body: sent[0]!.body, delaySeconds: 7_200 }]);
    expect(ai.enrichments.length).toBe(before);

    setNow(T + 14 * HOUR);
    await deliverEnrichments([sent[0]!.body]);
    expect(ai.enrichments.length).toBe(before + 1);
  });
});

describe('a throttled job that arrives too soon after the previous one', () => {
  it('waits until 3 seconds and a margin have passed since the previous start', async () => {
    new FakeOrigin()
      .page('https://soon-a.example/', blogArticle)
      .page('https://soon-b.example/', blogArticle);
    const ai = new FakeAi();
    const user = await signIn();
    await api('PUT', '/api/v1/settings/ai', {
      as: user.session,
      body: { provider: 'anthropic', api_key: 'sk-ant-abcd1234' },
    });
    recordEnrichQueue();
    const a = await addAndFetch(user, 'https://soon-a.example/');
    const b = await addAndFetch(user, 'https://soon-b.example/');
    setNow(T);
    const sent = recordEnrichQueue();
    await sendThrottled(env, user.id, [a.id, b.id]);
    const before = ai.enrichments.length;
    setNow(T + 500);
    await deliverEnrichments([sent[0]!.body]);
    // The second job's slot has come, but the first started only 2.999 seconds earlier.
    setNow(T + 3_499);
    const again = recordEnrichQueue();
    await deliverEnrichments([sent[1]!.body]);
    expect(ai.enrichments.length).toBe(before + 1);
    expect(again).toEqual([{ body: sent[1]!.body, delaySeconds: 1 }]);
    setNow(T + 3_750);
    await deliverEnrichments([sent[1]!.body]);
    expect(ai.enrichments.length).toBe(before + 2);
  });
});

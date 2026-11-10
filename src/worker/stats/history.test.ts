import { describe, expect, it } from 'vitest';
import {
  api,
  count,
  deliverAccount,
  env,
  recordAccountQueue,
  setNow,
  signIn,
  type TestUser,
} from '../test/helpers';
import { countStatement, type Counter } from './daily';

const NOW = '2026-11-10T12:00:00.000Z';
const DAY = 86_400_000;

/** Adds `amount` to the user's counter on the day `daysAgo` before NOW. */
async function record(user: TestUser, counter: Counter, daysAgo: number, amount = 1) {
  await countStatement(env.DB, {
    userId: user.id,
    at: Date.parse(NOW) - daysAgo * DAY,
    counter,
    amount: String(amount),
  }).run();
}

async function history(user: TestUser, query = '') {
  return api('GET', `/api/v1/stats/history${query}`, { as: user.session });
}

describe('daily history', () => {
  it('answers one entry per UTC day, oldest first, with every counter, the size and AI usage', async () => {
    setNow(NOW);
    const user = await signIn();
    await record(user, 'added', 0, 3);
    await record(user, 'removed', 0, 2);
    await record(user, 'asks', 3);
    await env.DB.prepare(
      `INSERT INTO daily_ai_usage (user_id, day, purpose, model, calls, input_tokens, output_tokens, calls_without_usage)
       VALUES (?, '2026-11-10', 'enrich', 'claude-test', 2, 300, 40, 0)`,
    )
      .bind(user.id)
      .run();
    await env.DB.prepare(
      `UPDATE daily_stats SET size_total = 5, size_pending = 1, size_active = 2, size_unreachable = 0,
         size_expired = 1, size_archived = 1 WHERE user_id = ? AND day = '2026-11-07'`,
    )
      .bind(user.id)
      .run();

    const r = await history(user, '?days=5');
    expect(r.status).toBe(200);
    expect(r.json.recorded_since).toBe('2026-11-07');
    expect(r.json.days.map((d: { day: string }) => d.day)).toEqual([
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
    ]);
    const [, three, , quiet, today] = r.json.days;
    expect(three).toMatchObject({
      asks: 1,
      added: 0,
      size: { total: 5, pending: 1, active: 2, unreachable: 0, expired: 1, archived: 1 },
      ai: [],
    });
    expect(quiet).toMatchObject({ added: 0, removed: 0, asks: 0, size: null, ai: [] });
    expect(today).toEqual({
      day: '2026-11-10',
      added: 3,
      used: 0,
      expired: 0,
      removed: 2,
      deleted: 0,
      archived: 0,
      unarchived: 0,
      restored: 0,
      fetch_ok: 0,
      fetch_failed: 0,
      enriched: 0,
      enrichment_failed: 0,
      asks: 0,
      size: null,
      ai: [
        {
          purpose: 'enrich',
          model: 'claude-test',
          calls: 2,
          input_tokens: 300,
          output_tokens: 40,
          calls_without_usage: 0,
        },
      ],
    });
    const fallback = await history(user);
    expect(fallback.json.days).toHaveLength(30);
    expect(fallback.json.days.at(-1).day).toBe('2026-11-10');
  });

  it('gives null counters before the first recorded day, and recorded_since', async () => {
    setNow(NOW);
    const user = await signIn();
    const none = await history(user, '?days=3');
    expect(none.json.recorded_since).toBeNull();
    for (const d of none.json.days) {
      expect(d.added).toBeNull();
      expect(d.asks).toBeNull();
      expect(d.size).toBeNull();
    }
    await record(user, 'used', 2);
    const r = await history(user, '?days=4');
    expect(r.json.recorded_since).toBe('2026-11-08');
    expect(r.json.days.map((d: { used: number | null }) => d.used)).toEqual([null, 1, 0, 0]);
  });

  it.each(['0', '366', '-1', '1.5', 'x', ''])('refuses days=%s', async (days) => {
    const user = await signIn();
    const r = await history(user, `?days=${days}`);
    expect(r.status).toBe(400);
    expect(r.json).toEqual({
      error: 'invalid_days',
      field: 'days',
      message: 'days is a whole number from 1 to 365',
    });
  });

  it('answers 401 without credentials, and only ever the owner’s own record', async () => {
    setNow(NOW);
    const r = await api('GET', '/api/v1/stats/history');
    expect(r.status).toBe(401);
    expect(r.json).toEqual({ error: 'unauthorized' });
    const a = await signIn('owner@example.test', 'A');
    const b = await signIn('other@example.test', 'B');
    await record(a, 'added', 0, 7);
    const theirs = await history(b, '?days=1');
    expect(theirs.json.recorded_since).toBeNull();
    expect(theirs.json.days[0].added).toBeNull();
  });

  it('deletes the owner’s record with the account', async () => {
    setNow(NOW);
    const user = await signIn();
    const other = await signIn('other@example.test', 'B');
    await record(user, 'added', 0, 2);
    await record(other, 'added', 0, 1);
    await env.DB.prepare(
      `INSERT INTO daily_ai_usage (user_id, day, purpose, model, calls) VALUES (?, '2026-11-10', 'ask', 'm', 1)`,
    )
      .bind(user.id)
      .run();
    const queue = recordAccountQueue();
    const r = await api('DELETE', '/api/v1/me', {
      as: user.session,
      body: { confirm_email: user.email },
    });
    expect(r.status).toBe(202);
    for (let runs = 0; queue.length > 0 && runs < 1000; runs++) {
      await deliverAccount(queue.splice(0, queue.length).map((m) => m.body));
    }
    expect(await count('daily_stats', 'user_id = ?', user.id)).toBe(0);
    expect(await count('daily_ai_usage', 'user_id = ?', user.id)).toBe(0);
    expect(await count('daily_stats', 'user_id = ?', other.id)).toBe(1);
  });
});

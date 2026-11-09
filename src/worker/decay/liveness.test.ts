import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../index';
import { fakeDns, FakeOrigin, INTERNAL_ERROR, NETWORK_LOST } from '../test/origin';
import {
  api,
  deliverFetches,
  deliverLiveness,
  env,
  recordFetchQueue,
  recordLivenessQueue,
  seedLinks,
  setNow,
  signIn,
  type TestUser,
} from '../test/helpers';
import { checkLink } from './liveness';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T = Date.parse('2027-06-01T12:00:00.000Z');

async function runScheduled(): Promise<void> {
  const ctx = createExecutionContext();
  await worker.scheduled?.(createScheduledController({ cron: '0 * * * *' }), env, ctx);
  await waitOnExecutionContext(ctx);
}

interface Seed {
  state?: string;
  pinned?: boolean;
  checkedDaysAgo?: number;
  addedDaysAgo?: number;
  enqueuedHoursAgo?: number;
  url?: string;
}

/** Seeds one link with its check history, used recently so that decay leaves it alone. */
async function seedChecked(user: TestUser, s: Seed): Promise<string> {
  const [id = ''] = await seedLinks(user, [
    {
      url: s.url ?? `https://live-${Math.random().toString(36).slice(2)}.example/`,
      state: s.state ?? 'active',
      pinPosition: s.pinned ? 1 : null,
      addedAt: new Date(T - (s.addedDaysAgo ?? 30) * DAY).toISOString(),
      lastUsedAt: new Date(T - DAY).toISOString(),
    },
  ]);
  await env.DB.prepare('UPDATE links SET last_checked_at = ?, check_enqueued_at = ? WHERE id = ?')
    .bind(
      s.checkedDaysAgo === undefined ? null : new Date(T - s.checkedDaysAgo * DAY).toISOString(),
      s.enqueuedHoursAgo === undefined
        ? null
        : new Date(T - s.enqueuedHoursAgo * HOUR).toISOString(),
      id,
    )
    .run();
  return id;
}

async function liveness(id: string) {
  return env.DB.prepare(
    'SELECT liveness_failures, dead_since, last_checked_at, last_check_result, state, last_used_at FROM links WHERE id = ?',
  )
    .bind(id)
    .first<{
      liveness_failures: number;
      dead_since: string | null;
      last_checked_at: string | null;
      last_check_result: string | null;
      state: string;
      last_used_at: string;
    }>();
}

describe('scheduling liveness checks', () => {
  it.each([
    { label: 'active, checked 7 days ago', seed: { checkedDaysAgo: 7 }, due: true },
    { label: 'active, checked 8 days ago', seed: { checkedDaysAgo: 8 }, due: true },
    {
      label: 'expired, checked 8 days ago',
      seed: { state: 'expired', checkedDaysAgo: 8 },
      due: false,
    },
    {
      label: 'pinned unreachable, checked 10 days ago',
      seed: { state: 'unreachable', pinned: true, checkedDaysAgo: 10 },
      due: true,
    },
    { label: 'active, checked 6 days ago', seed: { checkedDaysAgo: 6 }, due: false },
    { label: 'active, never checked, added 7 days ago', seed: { addedDaysAgo: 7 }, due: true },
    { label: 'active, never checked, added 2 days ago', seed: { addedDaysAgo: 2 }, due: false },
    {
      label: 'pinned and expired, checked 30 days ago',
      seed: { state: 'expired', pinned: true, checkedDaysAgo: 30 },
      due: false,
    },
    {
      label: 'pending, added 30 days ago',
      seed: { state: 'pending', addedDaysAgo: 30 },
      due: false,
    },
    {
      label: 'unreachable, not pinned',
      seed: { state: 'unreachable', checkedDaysAgo: 30 },
      due: false,
    },
    {
      label: 'due but enqueued 5 hours ago',
      seed: { checkedDaysAgo: 10, enqueuedHoursAgo: 5 },
      due: false,
    },
    {
      label: 'due and enqueued 7 hours ago',
      seed: { checkedDaysAgo: 10, enqueuedHoursAgo: 7 },
      due: true,
    },
  ])('enqueues a link $label: $due', async ({ seed, due }) => {
    setNow(T);
    const user = await signIn();
    const id = await seedChecked(user, seed);
    const sent = recordLivenessQueue();
    await runScheduled();
    expect(sent.map((m) => m.body)).toEqual(due ? [{ user_id: user.id, link_id: id }] : []);
    const row = await env.DB.prepare('SELECT check_enqueued_at FROM links WHERE id = ?')
      .bind(id)
      .first<{ check_enqueued_at: string | null }>();
    if (due) expect(row?.check_enqueued_at).toBe(new Date(T).toISOString());
  });

  it.each(['a deleted link', 'an expired link', 'a link checked an hour ago'])(
    'drops the message of %s',
    async (label) => {
      setNow(T);
      const user = await signIn();
      const origin = new FakeOrigin();
      const id = await seedChecked(user, { checkedDaysAgo: 10, url: 'https://dropped.example/' });
      origin.page('https://dropped.example/', 'ok');
      if (label === 'a deleted link')
        await env.DB.prepare('DELETE FROM links WHERE id = ?').bind(id).run();
      if (label === 'an expired link')
        await env.DB.prepare("UPDATE links SET state = 'expired', expired_at = ? WHERE id = ?")
          .bind(new Date(T).toISOString(), id)
          .run();
      if (label === 'a link checked an hour ago')
        await env.DB.prepare('UPDATE links SET last_checked_at = ? WHERE id = ?')
          .bind(new Date(T - HOUR).toISOString(), id)
          .run();
      const before = await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first();
      const { acked } = await deliverLiveness([{ user_id: user.id, link_id: id }]);
      expect(acked).toEqual(['m0']);
      expect(origin.log).toEqual([]);
      expect(await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first()).toEqual(
        before,
      );
    },
  );
});

describe('a liveness check', () => {
  const url = 'https://check.example/page';
  it.each([
    {
      label: 'HEAD 200',
      make: (o: FakeOrigin) => o.byMethod(url, { HEAD: () => new Response(null, { status: 200 }) }),
      requests: ['HEAD'],
      passed: true,
      result: 'HTTP 200',
    },
    {
      label: 'HEAD 301 to a 200',
      make: (o: FakeOrigin) => {
        o.byMethod(url, {
          HEAD: () =>
            new Response(null, {
              status: 301,
              headers: { Location: 'https://check.example/moved' },
            }),
        });
        o.byMethod('https://check.example/moved', {
          HEAD: () => new Response(null, { status: 200 }),
        });
      },
      requests: ['HEAD', 'HEAD'],
      passed: true,
      result: 'HTTP 200',
    },
    {
      label: 'HEAD 405 then GET 200',
      make: (o: FakeOrigin) =>
        o.byMethod(url, {
          HEAD: () => new Response(null, { status: 405 }),
          GET: () => new Response('page', { status: 200 }),
        }),
      requests: ['HEAD', 'GET'],
      passed: true,
      result: 'HTTP 200',
    },
    {
      label: 'HEAD 404 then GET 404',
      make: (o: FakeOrigin) =>
        o.byMethod(url, {
          HEAD: () => new Response(null, { status: 404 }),
          GET: () => new Response('gone', { status: 404 }),
        }),
      requests: ['HEAD', 'GET'],
      passed: false,
      result: 'HTTP 404',
    },
    {
      label: 'no answer',
      make: (o: FakeOrigin) => o.serve(url, () => new Promise<Response>(() => undefined)),
      requests: ['HEAD', 'GET'],
      passed: false,
      result: 'timed out',
    },
    {
      label: 'a refused connection',
      make: (o: FakeOrigin) => o.fail(url, NETWORK_LOST),
      requests: ['HEAD', 'GET'],
      passed: false,
      result: 'could not connect',
    },
    {
      label: 'an unknown host',
      make: (o: FakeOrigin) => {
        o.fail(url, INTERNAL_ERROR);
        fakeDns({ [new URL(url).hostname]: 'missing' });
      },
      requests: ['HEAD', 'GET'],
      passed: false,
      result: 'host not found',
    },
    {
      label: "Cloudflare's invalid certificate",
      make: (o: FakeOrigin) =>
        o.serve(
          url,
          () => new Response('error 526', { status: 526, headers: { Server: 'cloudflare' } }),
        ),
      requests: ['HEAD', 'GET'],
      passed: false,
      result: 'TLS error',
    },
  ])(
    'reads $label as $result',
    async ({ make, requests, passed, result }) => {
      const origin = new FakeOrigin();
      make(origin);
      const outcome = await checkLink(env, url, { timeoutMs: 200 });
      expect(outcome).toEqual({ passed, result });
      expect(origin.log.map((r) => r.method)).toEqual(requests);
    },
    15_000,
  );

  it.each([
    { label: 'six redirects', result: 'too many redirects' },
    { label: 'a redirect to a private address', result: 'blocked address' },
  ])(
    'fails on $label',
    async ({ label, result }) => {
      const origin = new FakeOrigin();
      const host = label === 'six redirects' ? 'six-redirects.example' : 'private-redirect.example';
      if (label === 'six redirects') {
        for (let i = 0; i < 7; i++)
          origin.redirect(`https://${host}/${i}`, `https://${host}/${i + 1}`);
      } else {
        origin.redirect(`https://${host}/0`, 'http://10.0.0.1/');
      }
      expect(await checkLink(env, `https://${host}/0`, { timeoutMs: 1_000 })).toEqual({
        passed: false,
        result,
      });
    },
    30_000,
  );
});

describe('a link’s weekly checks', () => {
  it('clears the dead mark and the failures on a pass', async () => {
    setNow(T);
    const user = await signIn();
    const id = await seedChecked(user, { checkedDaysAgo: 7, url: 'https://back.example/' });
    await env.DB.prepare('UPDATE links SET liveness_failures = 3, dead_since = ? WHERE id = ?')
      .bind(new Date(T - 7 * DAY).toISOString(), id)
      .run();
    new FakeOrigin().byMethod('https://back.example/', {
      HEAD: () => new Response(null, { status: 200 }),
    });
    await deliverLiveness([{ user_id: user.id, link_id: id }]);
    expect(await liveness(id)).toMatchObject({
      liveness_failures: 0,
      dead_since: null,
      last_checked_at: new Date(T).toISOString(),
      last_check_result: 'HTTP 200',
    });
  });

  it('marks a link dead on the third failure in a row, and only then', async () => {
    setNow(T);
    const user = await signIn();
    const id = await seedChecked(user, { checkedDaysAgo: 7, url: 'https://down.example/' });
    const origin = new FakeOrigin().fail('https://down.example/', NETWORK_LOST);
    const before = await liveness(id);
    const deadAt = new Date(T + 14 * DAY).toISOString();
    const expected = [
      [1, null],
      [2, null],
      [3, deadAt],
      [4, deadAt],
    ];
    for (let week = 0; week < 4; week++) {
      setNow(T + week * 7 * DAY);
      await deliverLiveness([{ user_id: user.id, link_id: id }]);
      const row = await liveness(id);
      expect([row?.liveness_failures, row?.dead_since]).toEqual(expected[week]);
      expect(row?.last_check_result).toBe('could not connect');
      expect([row?.state, row?.last_used_at]).toEqual([before?.state, before?.last_used_at]);
    }

    origin.byMethod('https://down.example/', { HEAD: () => new Response(null, { status: 200 }) });
    setNow(T + 28 * DAY);
    await deliverLiveness([{ user_id: user.id, link_id: id }]);
    origin.fail('https://down.example/', NETWORK_LOST);
    setNow(T + 35 * DAY);
    await deliverLiveness([{ user_id: user.id, link_id: id }]);
    expect(await liveness(id)).toMatchObject({ liveness_failures: 1, dead_since: null });
  }, 30_000);

  it.each(['the host gate', 'the store'])(
    'changes nothing when %s fails, and is checked again later',
    async (failing) => {
      setNow(T);
      const user = await signIn();
      const id = await seedChecked(user, { checkedDaysAgo: 10, url: 'https://own-error.example/' });
      await env.DB.prepare('UPDATE links SET liveness_failures = 2 WHERE id = ?').bind(id).run();
      new FakeOrigin().fail('https://own-error.example/', NETWORK_LOST);
      const sent = recordLivenessQueue();
      await runScheduled();
      expect(sent).toHaveLength(1);
      const before = await liveness(id);
      const bindings: Partial<Cloudflare.Env> =
        failing === 'the host gate'
          ? {
              HOST_GATE: {
                idFromName: () => {
                  throw new Error('gate unavailable');
                },
              } as unknown as DurableObjectNamespace<never> as Cloudflare.Env['HOST_GATE'],
            }
          : { DB: failingBatches(env.DB) };
      const { retried, acked } = await deliverLiveness([sent[0]!.body], bindings);
      expect(retried).toEqual(['m0']);
      expect(acked).toEqual([]);
      expect(await liveness(id)).toEqual(before);
      setNow(T + 7 * HOUR);
      const again = recordLivenessQueue();
      await runScheduled();
      expect(again.map((m) => m.body.link_id)).toEqual([id]);
    },
  );

  it('spaces checks of one host a second apart, together with fetches', async () => {
    setNow(T);
    const user = await signIn();
    const origin = new FakeOrigin();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const url = `https://a.example/live-${i}`;
      origin.byMethod(url, { HEAD: () => new Response(null, { status: 200 }) });
      ids.push(await seedChecked(user, { checkedDaysAgo: 8, url }));
    }
    origin.page('https://a.example/fetched', '<html><title>F</title></html>');
    const fetches = recordFetchQueue();
    await api('POST', '/api/v1/links', {
      as: user.session,
      body: { url: 'https://a.example/fetched' },
    });
    await Promise.all([
      deliverLiveness(ids.map((link_id) => ({ user_id: user.id, link_id }))),
      deliverFetches(fetches.map((m) => m.body)),
    ]);
    const times = origin.log
      .filter((r) => new URL(r.url).host === 'a.example')
      .map((r) => r.at)
      .sort((x, y) => x - y);
    expect(times).toHaveLength(6);
    for (let i = 1; i < times.length; i++)
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(1000);
  }, 30_000);
});

/** A database whose batches fail, as an unavailable D1 would. */
function failingBatches(db: D1Database): D1Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'batch') {
        return () => {
          throw new Error('D1 batch failed');
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

describe('checking a link on demand', () => {
  it.each([
    {
      label: 'a pass',
      answer: 'pass',
      before: { failures: 3, dead: true },
      after: { liveness_failures: 0, dead_since: null },
      passed: true,
      result: 'HTTP 200',
    },
    {
      label: 'a failure',
      answer: 'fail',
      before: { failures: 1, dead: false },
      after: { liveness_failures: 1, last_check_result: 'HTTP 503' },
      passed: false,
      result: 'HTTP 503',
    },
  ])(
    'answers with $label and counts only a pass',
    async ({ answer, before, after, passed, result }) => {
      setNow(T);
      const user = await signIn();
      const id = await seedChecked(user, { checkedDaysAgo: 2, url: 'https://ondemand.example/' });
      await env.DB.prepare('UPDATE links SET liveness_failures = ?, dead_since = ? WHERE id = ?')
        .bind(before.failures, before.dead ? new Date(T - DAY).toISOString() : null, id)
        .run();
      const origin = new FakeOrigin();
      if (answer === 'pass')
        origin.byMethod('https://ondemand.example/', {
          HEAD: () => new Response(null, { status: 200 }),
        });
      else origin.status('https://ondemand.example/', 503);
      const r = await api('POST', `/api/v1/links/${id}/check`, { as: user.session });
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ passed, result, checked_at: new Date(T).toISOString() });
      expect(r.json.link.id).toBe(id);
      expect(await liveness(id)).toMatchObject(after);
    },
  );

  it('is refused within 10 minutes of the previous on-demand check of the link', async () => {
    setNow(T);
    const user = await signIn();
    const one = await seedChecked(user, { checkedDaysAgo: 2, url: 'https://often.example/' });
    const two = await seedChecked(user, { checkedDaysAgo: 2, url: 'https://other-often.example/' });
    const origin = new FakeOrigin()
      .byMethod('https://often.example/', { HEAD: () => new Response(null, { status: 200 }) })
      .byMethod('https://other-often.example/', {
        HEAD: () => new Response(null, { status: 200 }),
      });
    expect((await api('POST', `/api/v1/links/${one}/check`, { as: user.session })).status).toBe(
      200,
    );
    setNow(T + 4 * 60_000);
    const r = await api('POST', `/api/v1/links/${one}/check`, { as: user.session });
    expect(r.status).toBe(429);
    expect(r.json).toEqual({ error: 'checked_recently', message: 'already checked recently' });
    expect(r.headers.get('Retry-After')).toBe('360');
    expect(origin.log.filter((q) => q.url === 'https://often.example/')).toHaveLength(1);
    expect((await api('POST', `/api/v1/links/${two}/check`, { as: user.session })).status).toBe(
      200,
    );
    setNow(T + 10 * 60_000);
    expect((await api('POST', `/api/v1/links/${one}/check`, { as: user.session })).status).toBe(
      200,
    );
  }, 15_000);

  it('is refused for an expired link, without a request to its address', async () => {
    setNow(T);
    const user = await signIn();
    const id = await seedChecked(user, {
      state: 'expired',
      checkedDaysAgo: 10,
      url: 'https://expired-check.example/',
    });
    const origin = new FakeOrigin().byMethod('https://expired-check.example/', {
      HEAD: () => new Response(null, { status: 200 }),
    });
    const before = await env.DB.prepare('SELECT last_checked_at FROM links WHERE id = ?')
      .bind(id)
      .first();
    const r = await api('POST', `/api/v1/links/${id}/check`, { as: user.session });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: 'link_expired', message: 'expired links are not checked' });
    expect(origin.log).toEqual([]);
    expect(
      await env.DB.prepare('SELECT last_checked_at FROM links WHERE id = ?').bind(id).first(),
    ).toEqual(before);
  });
});

import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../index';
import {
  api,
  count,
  createToken,
  deliverAccount,
  deliverEnrichments,
  deliverIndexing,
  deliverFetches,
  deliverLiveness,
  env,
  recordAccountQueue,
  recordEnrichQueue,
  recordFetchQueue,
  recordLivenessQueue,
  runEveryMinute,
  seedLinks,
  setNow,
  signIn,
  type TestUser,
} from '../test/helpers';
import { googleSignIn } from '../test/google';
import { meaning } from '../test/meaning';
import { deletionHooks } from './deletion';
import { FakeAi } from '../test/ai';
import { FakeOrigin } from '../test/origin';
import { blogArticle } from '../fetcher/fixtures/pages';
import { dispatchAllImports, dispatchImports } from '../imports/dispatch';
import { runScheduled } from '../decay/cron';

/** A user with two sessions, three tokens, an AI key and links. */
async function owner(): Promise<TestUser> {
  const user = await signIn('owner@example.test');
  await signIn('owner@example.test');
  for (let i = 0; i < 3; i++) await createToken(user);
  await env.DB.prepare(
    `UPDATE users SET ai_provider = 'anthropic', ai_model = 'm', ai_key_ciphertext = 'c',
       ai_key_iv = 'iv', ai_key_last4 = '1234', ai_key_status = 'verified' WHERE id = ?`,
  )
    .bind(user.id)
    .run();
  await seedLinks(user, [{ url: 'https://one.example' }, { url: 'https://two.example' }]);
  return user;
}

async function state(user: TestUser) {
  return {
    sessions: await count('sessions', 'user_id = ?', user.id),
    tokens: await count('tokens', 'user_id = ?', user.id),
    links: await count('links', 'user_id = ?', user.id),
    user: await env.DB.prepare(
      'SELECT ai_key_ciphertext, ai_key_last4, deletion_requested_at FROM users WHERE id = ?',
    )
      .bind(user.id)
      .first(),
  };
}

describe('DELETE /api/v1/me', () => {
  it.each(['owner@example.test', '  Owner@Example.TEST '])(
    'with the email %j signs the owner out everywhere and marks the account',
    async (confirm) => {
      const t = '2026-11-07T10:00:00.000Z';
      setNow(t);
      const user = await owner();
      const queue = recordAccountQueue();
      const r = await api('DELETE', '/api/v1/me', {
        as: user.session,
        body: { confirm_email: confirm },
      });
      expect(r.status).toBe(202);
      expect(r.json).toEqual({ status: 'deleting' });
      const cookie = r.headers.getSetCookie().find((c) => c.startsWith('alexandria_session='));
      expect(cookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
      expect(await state(user)).toEqual({
        sessions: 0,
        tokens: 0,
        links: 2,
        user: { ai_key_ciphertext: null, ai_key_last4: null, deletion_requested_at: t },
      });
      expect(queue.map((m) => m.body)).toEqual([{ user_id: user.id }]);
      expect((await api('GET', '/api/v1/me', { as: user.session })).status).toBe(401);
    },
  );

  it.each([
    {},
    { confirm_email: '' },
    { confirm_email: 'other@example.test' },
    { confirm_email: 'owner@example.tes' },
  ])('refuses the confirmation %j and deletes nothing', async (body) => {
    const user = await owner();
    const queue = recordAccountQueue();
    const before = await state(user);
    const r = await api('DELETE', '/api/v1/me', { as: user.session, body });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({
      error: 'confirmation_mismatch',
      field: 'confirm_email',
      message: 'type your email address to confirm',
    });
    expect(await state(user)).toEqual(before);
    expect(queue).toEqual([]);
    expect((await api('GET', '/api/v1/me', { as: user.session })).status).toBe(200);
  });

  it('refuses a personal access token', async () => {
    const user = await owner();
    const token = await createToken(user);
    const queue = recordAccountQueue();
    const r = await api('DELETE', '/api/v1/me', {
      bearer: token.secret,
      body: { confirm_email: user.email },
    });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({
      error: 'session_required',
      message: 'delete the account from the settings page',
    });
    expect((await state(user)).user).toMatchObject({ deletion_requested_at: null });
    expect(queue).toEqual([]);
    expect((await api('GET', '/api/v1/me', { bearer: token.secret })).status).toBe(200);
  });

  it('refuses a sign-in while the account is being deleted', async () => {
    const user = await owner();
    recordAccountQueue();
    await api('DELETE', '/api/v1/me', { as: user.session, body: { confirm_email: user.email } });
    const usersBefore = await count('users');
    const r = await googleSignIn('owner@example.test');
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toBe('/signin?error=deleting');
    expect(
      r.headers
        .getSetCookie()
        .some((c) => c.startsWith('alexandria_session=') && !/Max-Age=0/.test(c)),
    ).toBe(false);
    expect(await count('users')).toBe(usersBefore);
    expect(await count('sessions', 'user_id = ?', user.id)).toBe(0);
  });
});

/** The tables of the database with a user_id or link_id column, and which of the two they have. */
async function referencingTables(): Promise<{ name: string; user: boolean; link: boolean }[]> {
  const tables = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' AND sql NOT LIKE 'CREATE TABLE ''%'`,
  ).all<{ name: string }>();
  const out = [];
  for (const { name } of tables.results) {
    const cols = await env.DB.prepare(`SELECT name FROM pragma_table_info(?)`)
      .bind(name)
      .all<{ name: string }>();
    const names = cols.results.map((c) => c.name);
    if (names.includes('user_id') || names.includes('link_id')) {
      out.push({ name, user: names.includes('user_id'), link: names.includes('link_id') });
    }
  }
  return out;
}

/** Every row of every table that references the user or one of `linkIds`, by table. */
async function rowsOf(userId: string, linkIds: string[]) {
  const out: Record<string, unknown[]> = {};
  for (const t of await referencingTables()) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (t.user) {
      where.push('user_id = ?');
      params.push(userId);
    }
    if (t.link) {
      where.push('link_id IN (SELECT value FROM json_each(?))');
      params.push(JSON.stringify(linkIds));
    }
    const rows = await env.DB.prepare(`SELECT * FROM ${t.name} WHERE ${where.join(' OR ')}`)
      .bind(...params)
      .all();
    out[t.name] = rows.results.map((r) => JSON.stringify(r)).sort();
  }
  out.users = (
    await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).all()
  ).results.map((r) => JSON.stringify(r));
  return out;
}

/** Every R2 object under the user's prefix, with its body. */
async function objectsOf(userId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let cursor: string | undefined;
  do {
    const page = await env.SNAPSHOTS.list({ prefix: `u/${userId}/`, cursor });
    for (const o of page.objects) out[o.key] = await (await env.SNAPSHOTS.get(o.key))!.text();
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function linkIdsOf(userId: string): Promise<string[]> {
  return (
    await env.DB.prepare('SELECT id FROM links WHERE user_id = ?')
      .bind(userId)
      .all<{ id: string }>()
  ).results.map((r) => r.id);
}

/** Delivers the queued deletion runs, and the runs they queue, until none is left. */
async function driveDeletion(queue: { body: { user_id: string } }[], bindings = {}) {
  let runs = 0;
  while (queue.length > 0) {
    const next = queue.splice(0, queue.length);
    for (const m of next) {
      await deliverAccount([m.body], bindings);
      runs += 1;
    }
    if (runs > 10_000) throw new Error('the deletion never ended');
  }
  return runs;
}

/** Fills a user's library with every kind of data the packages keep. */
async function everything(user: TestUser, prefix: string) {
  const states = ['pending', 'active', 'active', 'expired', 'unreachable', 'active'];
  const ids = await seedLinks(
    user,
    states.map((state, i) => ({ url: `https://${prefix}${i}.example`, state, useCount: i })),
  );
  for (const [i, id] of ids.entries()) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO link_uses (link_id, user_id, at) VALUES (?, ?, ?)').bind(
        id,
        user.id,
        '2026-01-01T00:00:00.000Z',
      ),
      env.DB.prepare(
        "INSERT INTO link_events (link_id, user_id, kind, at, outcome) VALUES (?, ?, 'fetch', ?, 'ok')",
      ).bind(id, user.id, '2026-01-01T00:00:00.000Z'),
      env.DB.prepare('INSERT INTO link_texts (link_id, user_id, text) VALUES (?, ?, ?)').bind(
        id,
        user.id,
        `text ${prefix} ${i}`,
      ),
    ]);
    await env.SNAPSHOTS.put(`u/${user.id}/l/${id}/snapshot`, `<html>${prefix}${i}</html>`);
    await env.SNAPSHOTS.put(`u/${user.id}/l/${id}/reader.json`, `{"html":"${prefix}${i}"}`);
  }
  await api('PATCH', `/api/v1/links/${ids[1]}`, {
    as: user.session,
    body: {
      summary: 'S',
      tags: [`${prefix}-a`, `${prefix}-b`],
      topic: `${prefix} topic`,
      note: 'a note',
    },
  });
  await api(
    'PATCH',
    `/api/v1/tags/${(await env.DB.prepare('SELECT id FROM tags WHERE user_id = ? LIMIT 1').bind(user.id).first<{ id: string }>())!.id}`,
    {
      as: user.session,
      body: { name: `${prefix}-renamed` },
    },
  );
  const ws = await api('POST', '/api/v1/workspaces', {
    as: user.session,
    body: { name: `${prefix} ws` },
  });
  await api('POST', `/api/v1/workspaces/${ws.json.id}/links`, {
    as: user.session,
    body: { link_id: ids[1] },
  });
  await api('PATCH', `/api/v1/workspaces/${ws.json.id}`, {
    as: user.session,
    body: { note: 'ws note' },
  });
  await api('POST', '/api/v1/imports', {
    as: user.session,
    body: new TextEncoder().encode(`https://${prefix}-imported.example\nnot-a-url`),
    headers: { 'Content-Type': 'text/plain' },
  });
  await env.DB.prepare(
    "UPDATE users SET ai_provider = 'anthropic', ai_key_ciphertext = 'c' WHERE id = ?",
  )
    .bind(user.id)
    .run();
  return ids;
}

describe('the deletion job', () => {
  it(
    'removes every row and object of the account and nothing of anyone else',
    { timeout: 120_000 },
    async () => {
      const a = await signIn('owner@example.test');
      const b = await signIn('other@example.test');
      recordFetchQueue();
      await everything(a, 'a');
      await everything(b, 'b');
      const aLinks = await linkIdsOf(a.id);
      const bLinks = await linkIdsOf(b.id);
      // Both libraries are indexed, and the every-minute run has had its turn with them.
      for (const [user, links] of [
        [a, aLinks],
        [b, bLinks],
      ] as const) {
        await deliverIndexing(links.map((link_id) => ({ user_id: user.id, link_id })));
      }
      await runEveryMinute();
      expect(await count('link_passages', 'user_id = ?', a.id)).toBeGreaterThan(0);
      expect(meaning.index.all(a.id).length).toBeGreaterThan(0);
      const bRows = await rowsOf(b.id, bLinks);
      const bObjects = await objectsOf(b.id);
      expect(Object.keys(bObjects).length).toBeGreaterThan(0);
      const queue = recordAccountQueue();
      const r = await api('DELETE', '/api/v1/me', {
        as: a.session,
        body: { confirm_email: a.email },
      });
      expect(r.status).toBe(202);
      await driveDeletion(queue);
      // The vectors of the removed passages leave the index at the next every-minute run.
      await runEveryMinute();
      expect(meaning.index.all(a.id)).toEqual([]);
      expect(meaning.index.all(b.id).length).toBeGreaterThan(0);
      const left = await rowsOf(a.id, aLinks);
      for (const [table, rows] of Object.entries(left)) expect(rows, table).toEqual([]);
      expect(await objectsOf(a.id)).toEqual({});
      expect(await rowsOf(b.id, bLinks)).toEqual(bRows);
      expect(await objectsOf(b.id)).toEqual(bObjects);
    },
  );

  it('signs the same email in to a new, empty library once it is done', async () => {
    const a = await signIn('owner@example.test');
    await seedLinks(a, [{ url: 'https://old.example' }]);
    const queue = recordAccountQueue();
    await api('DELETE', '/api/v1/me', { as: a.session, body: { confirm_email: a.email } });
    await driveDeletion(queue);
    const r = await googleSignIn('owner@example.test');
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toBe('/');
    const cookie = r.headers.getSetCookie().find((c) => c.startsWith('alexandria_session='))!;
    const session = cookie.split(';')[0]!.split('=')[1]!;
    const links = await api('GET', '/api/v1/links', { as: session });
    expect(links.json.items).toEqual([]);
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(a.email)
      .first<{ id: string }>();
    expect(user!.id).not.toBe(a.id);
  });

  it(
    'removes 20,000 links with their copies in batches of at most 1,000',
    { timeout: 900_000 },
    async () => {
      const a = await signIn('owner@example.test');
      for (let start = 0; start < 20_000; start += 500) {
        const statements: D1PreparedStatement[] = [];
        const puts: Promise<unknown>[] = [];
        for (let i = start; i < start + 500; i++) {
          const id = `big-${i}`;
          statements.push(
            env.DB.prepare(
              `INSERT INTO links (id, user_id, url, original_url, host, title, state, added_at,
               last_used_at, updated_at, has_snapshot) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 1)`,
            ).bind(
              id,
              a.id,
              `https://b${i}.example/`,
              `https://b${i}.example/`,
              `b${i}.example`,
              `B ${i}`,
              '2026-01-01T00:00:00.000Z',
              '2026-01-01T00:00:00.000Z',
              '2026-01-01T00:00:00.000Z',
            ),
          );
          puts.push(env.SNAPSHOTS.put(`u/${a.id}/l/${id}/snapshot`, 'x'));
          puts.push(env.SNAPSHOTS.put(`u/${a.id}/l/${id}/reader.json`, '{}'));
        }
        await env.DB.batch(statements);
        await Promise.all(puts);
      }
      const batches: number[] = [];
      deletionHooks.onBatch = (n) => {
        batches.push(n);
      };
      const t0 = performance.now();
      const queue = recordAccountQueue();
      await api('DELETE', '/api/v1/me', { as: a.session, body: { confirm_email: a.email } });
      await driveDeletion(queue);
      deletionHooks.onBatch = () => undefined;
      expect(Math.max(...batches)).toBeLessThanOrEqual(1_000);
      expect(await count('links', 'user_id = ?', a.id)).toBe(0);
      expect(await objectsOf(a.id)).toEqual({});
      expect(await count('users', 'id = ?', a.id)).toBe(0);
      expect(performance.now() - t0).toBeLessThan(600_000);
    },
  );

  it(
    'continues after a failed run, restoring nothing, and ignores a finished account',
    { timeout: 300_000 },
    async () => {
      const a = await signIn('owner@example.test');
      const ids = await seedLinks(
        a,
        Array.from({ length: 2_500 }, (_, i) => ({ url: `https://r${i}.example` })),
      );
      await Promise.all(ids.map((id) => env.SNAPSHOTS.put(`u/${a.id}/l/${id}/snapshot`, 'x')));
      const queue = recordAccountQueue();
      await api('DELETE', '/api/v1/me', { as: a.session, body: { confirm_email: a.email } });
      let deletes = 0;
      const failing = {
        SNAPSHOTS: new Proxy(env.SNAPSHOTS, {
          get(target, prop) {
            if (prop === 'delete') {
              return (keys: string[]) => {
                deletes += 1;
                if (deletes === 2) throw new Error('R2 is down');
                return target.delete(keys);
              };
            }
            const value = Reflect.get(target, prop);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }) as R2Bucket,
      };
      const first = queue.splice(0, 1)[0]!;
      expect((await deliverAccount([first.body], failing)).acked).toEqual(['m0']);
      const retried = queue.splice(0, 1)[0]!;
      const second = await deliverAccount([retried.body], failing);
      expect(second.retried).toEqual(['m0']);
      expect(await count('links', 'user_id = ?', a.id)).toBeLessThan(2_500);
      await driveDeletion([retried]);
      await driveDeletion(queue);
      expect(await count('links', 'user_id = ?', a.id)).toBe(0);
      expect(await objectsOf(a.id)).toEqual({});
      expect(await count('users', 'id = ?', a.id)).toBe(0);
      const again = await deliverAccount([{ user_id: a.id }]);
      expect(again.acked).toEqual(['m0']);
      expect(queue).toEqual([]);
    },
  );

  it('is run by the 5-minute sweep for an account marked more than 5 minutes ago', async () => {
    const t = Date.parse('2026-11-07T10:00:00.000Z');
    setNow(t);
    const a = await signIn('owner@example.test');
    const c = await signIn('third@example.test');
    await seedLinks(a, [{ url: 'https://a.example' }]);
    await seedLinks(c, [{ url: 'https://c.example' }]);
    await env.DB.prepare('UPDATE users SET deletion_requested_at = ? WHERE id = ?')
      .bind(new Date(t - 6 * 60_000).toISOString(), a.id)
      .run();
    await env.DB.prepare('UPDATE users SET deletion_requested_at = ? WHERE id = ?')
      .bind(new Date(t - 60_000).toISOString(), c.id)
      .run();
    const queue = recordAccountQueue();
    const ctx = createExecutionContext();
    await worker.scheduled!(
      { cron: '*/5 * * * *', scheduledTime: t, noRetry() {} } as ScheduledController,
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    await driveDeletion(queue);
    expect(await count('users', 'id = ?', a.id)).toBe(0);
    expect(await count('links', 'user_id = ?', a.id)).toBe(0);
    expect(await count('users', 'id = ?', c.id)).toBe(1);
    expect(await count('links', 'user_id = ?', c.id)).toBe(1);
  });
});

/** The total rows of every table but the rate limit, which the test's own requests move. */
async function allRows(): Promise<number> {
  let total = 0;
  for (const t of await referencingTables()) {
    if (t.name === 'rate_limits') continue;
    total += await count(t.name);
  }
  return total + (await count('users')) + (await count('imports'));
}

describe('background work for a deleted account', () => {
  it.each([
    'a fetch of its pending link',
    'an enrichment of its unenriched link',
    'the next step of its import',
    "the hourly cron's decay and liveness",
    'a liveness check of its link',
    'a fetch of a link that no longer exists',
  ])('%s writes nothing and calls no one', async (work) => {
    const t = '2026-11-07T10:00:00.000Z';
    setNow(t);
    const a = await signIn('owner@example.test');
    const origin = new FakeOrigin();
    for (const host of ['pending', 'unenriched', 'due', 'import1']) {
      origin.page(`https://${host}.example/`, blogArticle);
    }
    const ai = new FakeAi();
    const [pending, unenriched, due] = await seedLinks(a, [
      { url: 'https://pending.example/' },
      { url: 'https://unenriched.example/', state: 'active' },
      { url: 'https://due.example/', state: 'active', lastUsedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    await env.DB.prepare(
      `UPDATE users SET ai_provider = 'anthropic', ai_model = 'claude', ai_key_status = 'verified' WHERE id = ?`,
    )
      .bind(a.id)
      .run();
    const fetches = recordFetchQueue();
    const imported = await api('POST', '/api/v1/imports', {
      as: a.session,
      body: new TextEncoder().encode(
        Array.from({ length: 30 }, (_, i) => `https://import${i}.example/`).join('\n'),
      ),
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(imported.status).toBe(201);
    await env.DB.prepare('UPDATE users SET deletion_requested_at = ? WHERE id = ?')
      .bind(t, a.id)
      .run();
    const fetchesBefore = fetches.length;
    const enrich = recordEnrichQueue();
    const liveness = recordLivenessQueue();
    const rows = await allRows();
    const aRows = await rowsOf(a.id, await linkIdsOf(a.id));
    const objects = await objectsOf(a.id);
    const calls = origin.log.length + ai.requests.length;
    let delivery: { acked: string[]; retried: string[] } | null = null;
    if (work === 'a fetch of its pending link') {
      delivery = await deliverFetches([{ user_id: a.id, link_id: pending! }]);
    } else if (work === 'an enrichment of its unenriched link') {
      delivery = await deliverEnrichments([{ user_id: a.id, link_id: unenriched!, attempt: 1 }]);
    } else if (work === 'the next step of its import') {
      setNow(Date.parse(t) + 120_000);
      await dispatchImports(env, a.id);
      await dispatchAllImports(env);
    } else if (work === "the hourly cron's decay and liveness") {
      setNow('2027-06-01T00:00:00.000Z');
      await runScheduled(env);
    } else if (work === 'a liveness check of its link') {
      delivery = await deliverLiveness([{ user_id: a.id, link_id: due! }]);
    } else {
      delivery = await deliverFetches([{ user_id: a.id, link_id: 'gone-link' }]);
    }
    expect(await allRows()).toBe(rows);
    expect(await rowsOf(a.id, await linkIdsOf(a.id))).toEqual(aRows);
    expect(await objectsOf(a.id)).toEqual(objects);
    expect(origin.log.length + ai.requests.length).toBe(calls);
    expect(fetches.length).toBe(fetchesBefore);
    expect(enrich).toEqual([]);
    expect(liveness).toEqual([]);
    if (delivery) {
      expect(delivery.retried).toEqual([]);
      expect(delivery.acked).toEqual(['m0']);
    }
  });
});

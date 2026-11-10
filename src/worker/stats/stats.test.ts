import { afterEach, describe, expect, it } from 'vitest';
import { runScheduled } from '../decay/cron';
import { FakeAi } from '../test/ai';
import {
  api,
  createToken,
  env,
  recordLivenessQueue,
  seedLinks,
  setNow,
  signIn,
  type TestUser,
} from '../test/helpers';
import { statsHooks } from './stats';

const NOW = '2026-11-10T12:00:00.000Z';
const DAY = 86_400_000;

/** The stored time `days` before NOW. */
function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * DAY).toISOString();
}

afterEach(() => {
  statsHooks.beforeSection = undefined;
});

/** Sets a column of one link directly. */
async function setLink(id: string, column: string, value: unknown): Promise<void> {
  await env.DB.prepare(`UPDATE links SET ${column} = ? WHERE id = ?`).bind(value, id).run();
}

/** Stores a topic of the user's, under `parent` (an id) or at the top level; returns its id. */
async function addTopic(user: TestUser, name: string, parent: string | null = null) {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO topics (id, user_id, name, parent_id) VALUES (?, ?, ?, ?)')
    .bind(id, user.id, name, parent)
    .run();
  return id;
}

/** Stores a tag of the user's on `links`, in that order; returns its id. */
async function addTag(user: TestUser, name: string, links: string[]) {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO tags (id, user_id, name) VALUES (?, ?, ?)').bind(id, user.id, name),
    ...links.map((l) =>
      env.DB.prepare('INSERT INTO link_tags (link_id, tag_id, position) VALUES (?, ?, 1)').bind(
        l,
        id,
      ),
    ),
  ]);
  return id;
}

/** Stores a workspace of the user's holding `links`; returns its id. */
async function addWorkspace(user: TestUser, name: string, links: string[]) {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO workspaces (id, user_id, name, name_key, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(id, user.id, name, name.toLowerCase(), NOW),
    ...links.map((l, i) =>
      env.DB.prepare(
        'INSERT INTO workspace_links (workspace_id, link_id, position) VALUES (?, ?, ?)',
      ).bind(id, l, i + 1),
    ),
  ]);
  return id;
}

/** Seeds `n` links of the user's on distinct hosts; returns their ids. */
function seedMany(user: TestUser, n: number, prefix = 'l', extra: { state?: string } = {}) {
  return seedLinks(
    user,
    Array.from({ length: n }, (_, i) => ({ url: `https://${prefix}${i}.example/`, ...extra })),
  );
}

async function stats(user: TestUser, query = '') {
  return api('GET', `/api/v1/stats${query}`, { as: user.session });
}

describe('library statistics', () => {
  it('counts the library, its content, topics, tags, workspaces and hosts', async () => {
    setNow(NOW);
    const user = await signIn();
    const states = ['pending', 'pending', 'active', 'active', 'active', 'unreachable', 'expired'];
    const ids = await seedLinks(user, [
      ...states.map((state, i) => ({ url: `https://h${i % 3}.example/${i}`, state })),
      { url: 'https://h0.example/archived', state: 'archived' },
    ]);
    const [a, b, c, d, e] = ids as [string, string, string, string, string];
    await setLink(a, 'pin_position', 1);
    await addWorkspace(user, 'Trip', [b]);
    await setLink(a, 'content_kind', 'html');
    await setLink(b, 'content_kind', 'html');
    await setLink(c, 'content_kind', 'pdf');
    await setLink(d, 'content_kind', 'other');
    await setLink(a, 'has_snapshot', 1);
    await setLink(c, 'reader_empty', 1);
    const top = await addTopic(user, 'Software');
    const mid = await addTopic(user, 'Testing', top);
    const leaf = await addTopic(user, 'Property-based testing', mid);
    await setLink(a, 'topic_id', top);
    await setLink(b, 'topic_id', mid);
    await setLink(c, 'topic_id', leaf);
    await setLink(d, 'topic_id', leaf);
    await addTag(user, 'rust', [a, b]);
    await addTag(user, 'go', [e]);

    const r = await stats(user);
    expect(r.status).toBe(200);
    expect(r.json.library).toEqual({
      total: 8,
      by_state: { pending: 2, active: 3, unreachable: 1, expired: 1, archived: 1 },
      pinned: 1,
      in_workspace: 1,
      limit: 20000,
    });
    expect(r.json.content).toEqual({
      by_kind: { html: 2, pdf: 1, other: 1, unfetched: 4 },
      with_snapshot: 1,
      reader_empty: 1,
    });
    expect(r.json.topics).toMatchObject({
      total: 3,
      by_level: { '1': 1, '2': 1, '3': 1 },
      links_without_topic: 4,
    });
    expect(r.json.topics.largest[0]).toEqual({
      id: leaf,
      name: 'Property-based testing',
      path: ['Software', 'Testing', 'Property-based testing'],
      count: 2,
    });
    expect(r.json.tags).toMatchObject({ total: 2, used_once: 1, links_without_tags: 5 });
    expect(r.json.workspaces.total).toBe(1);
    expect(r.json.hosts.distinct).toBe(3);
    expect(r.json.hosts.top[0]).toEqual({ host: 'h0.example', count: 4 });
  });

  it.each([
    ['no links', [] as string[]],
    ['only active links', ['active', 'active']],
    ['one link in each state', ['pending', 'active', 'unreachable', 'expired', 'archived']],
  ])('gives every state and content kind, adding up to the total, with %s', async (_, states) => {
    const user = await signIn();
    await seedLinks(
      user,
      states.map((state, i) => ({ url: `https://s${i}.example/`, state })),
    );
    const r = await stats(user);
    const byState = r.json.library.by_state as Record<string, number>;
    expect(Object.keys(byState).sort()).toEqual(
      ['active', 'archived', 'expired', 'pending', 'unreachable'].sort(),
    );
    expect(Object.keys(r.json.content.by_kind).sort()).toEqual(
      ['html', 'other', 'pdf', 'unfetched'].sort(),
    );
    expect(Object.values(byState).reduce((x, y) => x + y, 0)).toBe(r.json.library.total);
    expect(r.json.library.total).toBe(states.length);
  });

  it('answers zeros and empty lists for an empty library', async () => {
    const user = await signIn();
    const r = await stats(user);
    expect(r.status).toBe(200);
    expect(r.json.library).toEqual({
      total: 0,
      by_state: { pending: 0, active: 0, unreachable: 0, expired: 0, archived: 0 },
      pinned: 0,
      in_workspace: 0,
      limit: 20000,
    });
    expect(r.json.content).toEqual({
      by_kind: { html: 0, pdf: 0, other: 0, unfetched: 0 },
      with_snapshot: 0,
      reader_empty: 0,
    });
    expect(r.json.topics).toEqual({
      total: 0,
      by_level: { '1': 0, '2': 0, '3': 0 },
      links_without_topic: 0,
      largest: [],
    });
    expect(r.json.tags).toEqual({ total: 0, used_once: 0, links_without_tags: 0, top: [] });
    expect(r.json.workspaces).toEqual({ total: 0, largest: [] });
    expect(r.json.hosts).toEqual({ distinct: 0, top: [] });
  });

  it('counts only the signed-in owner’s library', async () => {
    const a = await signIn('owner@example.test', 'A');
    const b = await signIn('other@example.test', 'B');
    const [la = ''] = await seedMany(a, 1, 'a');
    const bLinks = await seedMany(b, 3, 'b', { state: 'active' });
    const bTopic = await addTopic(b, 'Hidden topic');
    await setLink(bLinks[0]!, 'topic_id', bTopic);
    await addTag(b, 'hidden-tag', bLinks);
    await addWorkspace(b, 'Hidden workspace', bLinks);
    await addTag(a, 'mine', [la]);

    const r = await stats(a);
    expect(r.json.library.total).toBe(1);
    expect(r.json.library.by_state.active).toBe(0);
    expect(r.json.topics.total).toBe(0);
    expect(r.json.tags.total).toBe(1);
    expect(r.json.workspaces.total).toBe(0);
    expect(r.json.hosts.distinct).toBe(1);
    const text = JSON.stringify(r.json);
    for (const hidden of ['Hidden topic', 'hidden-tag', 'Hidden workspace', 'b0.example']) {
      expect(text).not.toContain(hidden);
    }
  });

  it('lists the 10 largest topics, tags, workspaces and hosts, ties by name', async () => {
    const user = await signIn();
    const links = await seedLinks(
      user,
      Array.from({ length: 30 }, (_, i) => ({ url: `https://x${i % 11}.example/${i}` })),
    );
    // Eleven tags: 'tag-0'…'tag-8' on 12…4 links, then 'beta' and 'alpha' on 2 each.
    const names = [...Array.from({ length: 9 }, (_, i) => `tag-${i}`), 'beta', 'alpha'];
    for (const [i, name] of names.entries()) {
      await addTag(user, name, links.slice(0, i < 9 ? 12 - i : 2));
    }
    const parent = await addTopic(user, 'Parent');
    for (const [i, name] of names.entries()) {
      const t = await addTopic(user, `topic-${name}`, i === 0 ? parent : null);
      for (const l of links.slice(i * 2, i * 2 + (i < 9 ? 3 : 1))) await setLink(l, 'topic_id', t);
    }
    for (const [i, name] of names.entries()) {
      await addWorkspace(user, `ws-${name}`, links.slice(0, i < 9 ? 12 - i : 2));
    }

    const r = await stats(user);
    const tagNames = r.json.tags.top.map((t: { name: string }) => t.name);
    expect(tagNames).toHaveLength(10);
    expect(tagNames.slice(0, 9)).toEqual(names.slice(0, 9));
    expect(tagNames[9]).toBe('alpha');
    expect(r.json.tags.top[0]).toMatchObject({ name: 'tag-0', count: 12 });
    const wsNames = r.json.workspaces.largest.map((w: { name: string }) => w.name);
    expect(wsNames).toHaveLength(10);
    expect(wsNames[9]).toBe('ws-alpha');
    expect(r.json.topics.largest).toHaveLength(10);
    const child = r.json.topics.largest.find((t: { name: string }) => t.name === 'topic-tag-0');
    expect(child.path).toEqual(['Parent', 'topic-tag-0']);
    // Hosts: x0…x7 hold 3 links each, x8, x9 and x10 hold 2; ties go by host, A to Z.
    const hosts = r.json.hosts.top.map((h: { host: string }) => h.host);
    expect(hosts).toHaveLength(10);
    expect(hosts.slice(8)).toEqual(['x10.example', 'x8.example']);
  });
});

describe('the stats route', () => {
  it('answers 401 without credentials, and 200 with a token', async () => {
    const r = await api('GET', '/api/v1/stats');
    expect(r.status).toBe(401);
    expect(r.json).toEqual({ error: 'unauthorized' });
    const user = await signIn();
    const token = await createToken(user);
    const ok = await api('GET', '/api/v1/stats', { bearer: token.secret });
    expect(ok.status).toBe(200);
  });

  it('changes nothing and ignores query parameters', async () => {
    setNow(NOW);
    const user = await signIn();
    await seedLinks(user, [
      { url: 'https://p.example/', state: 'pending' },
      { url: 'https://e.example/', state: 'expired' },
      { url: 'https://d.example/', state: 'active', lastUsedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    await api('POST', '/api/v1/imports', {
      as: user.session,
      body: 'https://i.example/\n',
      headers: { 'Content-Type': 'text/plain' },
    });
    const snapshot = async () =>
      Promise.all(
        ['links', 'users', 'imports', 'import_links', 'link_index_state'].map(async (t) =>
          JSON.stringify((await env.DB.prepare(`SELECT * FROM ${t}`).all()).results),
        ),
      );
    const before = await snapshot();
    const r1 = await stats(user);
    const r2 = await stats(user, '?days=7&x=1');
    expect(await snapshot()).toEqual(before);
    expect(r2.json).toEqual(r1.json);
  });

  it('answers within 2 seconds for a library of 20,000 links', { timeout: 120_000 }, async () => {
    setNow(NOW);
    const user = await signIn();
    const states = ['pending', 'active', 'unreachable', 'expired', 'archived'];
    const ids = await seedLinks(
      user,
      Array.from({ length: 20_000 }, (_, i) => ({
        url: `https://h${i % 500}.example/${i}`,
        state: states[i % states.length],
        lastUsedAt: new Date(Date.parse(NOW) - (i % 90) * 86_400_000).toISOString(),
      })),
    );
    const topic = await addTopic(user, 'Big');
    await addTag(user, 'big', ids.slice(0, 1000));
    await env.DB.prepare('UPDATE links SET topic_id = ? WHERE user_id = ? AND rowid % 3 = 0')
      .bind(topic, user.id)
      .run();
    const day = (i: number) => new Date(Date.parse(NOW) - (i % 29) * 86_400_000).toISOString();
    for (let i = 0; i < 20_000; i += 500) {
      await env.DB.batch(
        ids.slice(i, i + 500).flatMap((id, j) => [
          env.DB.prepare('INSERT INTO link_uses (link_id, user_id, at) VALUES (?, ?, ?)').bind(
            id,
            user.id,
            day(i + j),
          ),
          env.DB.prepare(
            `INSERT INTO link_events (link_id, user_id, kind, at, outcome, reason)
             VALUES (?, ?, 'fetch', ?, ?, ?)`,
          ).bind(id, user.id, day(i + j), j % 7 ? 'ok' : 'failed', j % 7 ? null : 'HTTP 503'),
        ]),
      );
    }
    const t0 = Date.now();
    const r = await stats(user);
    const elapsed = Date.now() - t0;
    expect(r.status).toBe(200);
    expect(r.json.library.total).toBe(20_000);
    expect(elapsed).toBeLessThanOrEqual(2000);
  });

  it('answers 500 and no partial result when a section fails', async () => {
    const user = await signIn();
    statsHooks.beforeSection = (name) => {
      if (name === 'tags') throw new Error('the tags query failed');
    };
    const r = await stats(user);
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ error: 'internal' });
  });
});

/**
 * Seeds one link of the user's at `points` (start points 60) in `state`;
 * returns its id.
 */
async function atPoints(user: TestUser, points: number, state = 'active'): Promise<string> {
  const useCount = Math.max(0, points - 60);
  const [id = ''] = await seedLinks(user, [
    {
      url: `https://p${crypto.randomUUID()}.example/`,
      state,
      useCount,
      lastUsedAt: daysAgo(60 + useCount - points),
    },
  ]);
  return id;
}

describe('expiry outlook', () => {
  it('buckets the unprotected links by points, as their decay notes say', async () => {
    setNow(NOW);
    const user = await signIn();
    const table = [-1, 0, 1, 7, 8, 30, 31];
    const ids = [];
    for (const p of table) ids.push(await atPoints(user, p));
    await setLink(await atPoints(user, 0), 'pin_position', 1);
    await addWorkspace(user, 'Kept', [await atPoints(user, 0)]);
    await atPoints(user, -20, 'archived');

    const r = await stats(user);
    expect(r.json.expiry.expiring).toEqual({ today: 2, within_7_days: 2, within_30_days: 2 });
    for (const [i, id] of ids.entries()) {
      const note = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json.decay_note;
      const p = table[i]!;
      if (p <= 0) expect(note).toContain('expires today');
      else expect(note).toContain(`expires in ${p} ${p === 1 ? 'day' : 'days'}`);
    }
  });

  it('gives every point range of the histogram, in order', async () => {
    setNow(NOW);
    const user = await signIn();
    const empty = await stats(user);
    expect(empty.json.expiry.points_histogram).toEqual(
      ['≤0', '1–7', '8–30', '31–60', '61–90', '>90'].map((range) => ({ range, count: 0 })),
    );
    for (const p of [-1, 0, 1, 7, 8, 30, 31, 60, 61, 90, 91]) await atPoints(user, p);
    await atPoints(user, 5, 'expired');
    const r = await stats(user);
    expect(r.json.expiry.points_histogram).toEqual([
      { range: '≤0', count: 2 },
      { range: '1–7', count: 2 },
      { range: '8–30', count: 2 },
      { range: '31–60', count: 2 },
      { range: '61–90', count: 2 },
      { range: '>90', count: 1 },
    ]);
  });

  it('counts the protected links at 0 points or below', async () => {
    setNow(NOW);
    const user = await signIn();
    await setLink(await atPoints(user, -3), 'pin_position', 1);
    await addWorkspace(user, 'Kept', [await atPoints(user, 0)]);
    await setLink(await atPoints(user, 5), 'pin_position', 2);
    await setLink(await atPoints(user, -3, 'expired'), 'pin_position', 3);
    await setLink(await atPoints(user, -9, 'archived'), 'pin_position', 4);
    const r = await stats(user);
    expect(r.json.expiry.protected_at_risk).toBe(2);
  });

  it('counts the expired links awaiting removal, within 7 and 30 days cumulatively', async () => {
    setNow(NOW);
    const user = await signIn();
    for (const removalIn of [-1, 3, 20, 100]) {
      const id = await atPoints(user, -5, 'expired');
      await setLink(id, 'expired_at', daysAgo(180 - removalIn));
    }
    const pinned = await atPoints(user, -5, 'expired');
    await setLink(pinned, 'expired_at', daysAgo(179));
    await setLink(pinned, 'pin_position', 1);
    const r = await stats(user);
    expect(r.json.expiry.awaiting_removal).toEqual({
      total: 4,
      within_7_days: 2,
      within_30_days: 3,
    });
  });

  it('gives the owner’s decay settings', async () => {
    const user = await signIn();
    const put = await api('PUT', '/api/v1/settings/decay', {
      as: user.session,
      body: { start_points: 30, remove_days: 90, use_boost: 50 },
    });
    expect(put.status).toBe(200);
    const r = await stats(user);
    expect(r.json.expiry.settings).toEqual({ start_points: 30, remove_days: 90 });
  });
});

describe('health', () => {
  it('counts the unreachable links with their 5 most common reasons', async () => {
    const user = await signIn();
    const reasons = [
      ...Array(3).fill('HTTP 503'),
      ...Array(2).fill('timed out'),
      'host not found',
      'HTTP 404',
      'blocked by a bot check',
      'TLS failure',
    ];
    const ids = await seedMany(user, reasons.length, 'u', { state: 'unreachable' });
    for (const [i, id] of ids.entries()) await setLink(id, 'state_reason', reasons[i]);
    const r = await stats(user);
    expect(r.json.health.unreachable).toEqual({
      count: 9,
      by_reason: [
        { reason: 'HTTP 503', count: 3 },
        { reason: 'timed out', count: 2 },
        { reason: 'blocked by a bot check', count: 1 },
        { reason: 'host not found', count: 1 },
        { reason: 'HTTP 404', count: 1 },
      ],
    });
  });

  it('counts the links failing their liveness checks', async () => {
    setNow(NOW);
    const user = await signIn();
    const [ok = '', recent = '', old = ''] = await seedMany(user, 3, 'd', { state: 'active' });
    await setLink(ok, 'liveness_failures', 0);
    await setLink(recent, 'liveness_failures', 1);
    await setLink(recent, 'dead_since', daysAgo(2));
    await setLink(old, 'liveness_failures', 3);
    await setLink(old, 'dead_since', daysAgo(30));
    const r = await stats(user);
    expect(r.json.health.dead).toEqual({ count: 2, dead_over_30_days: 1 });
  });

  it('counts the links in every enrichment status, with the failures’ reasons', async () => {
    const user = await signIn();
    const statuses = [
      'no_key',
      'queued',
      'enriched',
      'failed',
      'failed',
      'failed',
      'skipped',
      'waiting_for_key',
      null,
    ];
    const ids = await seedMany(user, statuses.length, 'e');
    for (const [i, id] of ids.entries()) await setLink(id, 'enrichment_status', statuses[i]);
    await setLink(ids[3]!, 'enrichment_reason', 'provider_failed');
    await setLink(ids[4]!, 'enrichment_reason', 'provider_failed');
    await setLink(ids[5]!, 'enrichment_reason', 'the result could not be used');
    const r = await stats(user);
    expect(r.json.health.enrichment).toEqual({
      no_key: 1,
      queued: 1,
      enriched: 1,
      failed: 3,
      skipped: 1,
      waiting_for_key: 1,
      none: 1,
      failed_by_reason: [
        { reason: 'provider_failed', count: 2 },
        { reason: 'the result could not be used', count: 1 },
      ],
    });
  });

  it.each([
    ['none', 'no key'],
    ['verified', 'a key the provider accepted'],
    ['rejected', 'a key the provider later rejected'],
  ])('gives the AI key status %s for %s', async (status) => {
    new FakeAi();
    const user = await signIn();
    if (status !== 'none') {
      const put = await api('PUT', '/api/v1/settings/ai', {
        as: user.session,
        body: { provider: 'anthropic', api_key: 'sk-ant-test-key-1234' },
      });
      expect(put.status).toBe(200);
    }
    if (status === 'rejected') {
      await env.DB.prepare(
        "UPDATE users SET ai_key_status = 'rejected', ai_key_rejected_message = 'invalid' WHERE id = ?",
      )
        .bind(user.id)
        .run();
    }
    const r = await stats(user);
    expect(r.json.health.ai_key).toBe(status);
  });
});

/** Imports a file of `urls` through the API at the current clock; returns the import's id. */
async function importUrls(user: TestUser, urls: string[]): Promise<string> {
  const r = await api('POST', '/api/v1/imports', {
    as: user.session,
    body: urls.join('\n') + '\n',
    headers: { 'Content-Type': 'text/plain' },
  });
  expect(r.status).toBe(201);
  return r.json.id;
}

describe('background backlog', () => {
  it('counts the pending fetches, the retries and the queued enrichments', async () => {
    const user = await signIn();
    const [p1 = '', , , q1 = '', q2 = ''] = await seedMany(user, 5, 'b');
    await setLink(p1, 'fetch_attempts', 2);
    for (const id of [q1, q2]) {
      await setLink(id, 'state', 'active');
      await setLink(id, 'enrichment_status', 'queued');
    }
    const r = await stats(user);
    expect(r.json.backlog).toMatchObject({
      fetch_pending: 3,
      fetch_retrying: 1,
      enrichment_queued: 2,
    });
  });

  it('lists the 10 newest imports still waiting or in progress, as the import reports them', async () => {
    const user = await signIn();
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      setNow(Date.parse(NOW) + i * 60_000);
      ids.push(await importUrls(user, [`https://imp${i}.example/a`, `https://imp${i}.example/b`]));
    }
    setNow(Date.parse(NOW) + 20 * 60_000);
    const finished = await importUrls(user, ['https://done.example/']);
    await env.DB.batch([
      env.DB.prepare('UPDATE import_links SET dispatched_at = ? WHERE import_id IN (?, ?)').bind(
        NOW,
        finished,
        ids[11],
      ),
      env.DB.prepare(
        `UPDATE links SET state = 'active'
         WHERE id IN (SELECT link_id FROM import_links WHERE import_id = ?)`,
      ).bind(finished),
    ]);
    const r = await stats(user);
    const listed = r.json.backlog.imports as { id: string }[];
    expect(listed.map((i) => i.id)).toEqual(ids.slice(2).reverse());
    const report = await api('GET', `/api/v1/imports/${ids[11]}`, { as: user.session });
    expect(listed[0]).toEqual({
      id: ids[11],
      created_at: report.json.created_at,
      added: 2,
      waiting: report.json.progress.waiting,
      in_progress: report.json.progress.in_progress,
      done: report.json.progress.done,
    });
  });

  it('counts the stale links of the meaning index and the vectors waiting deletion', async () => {
    const user = await signIn();
    const other = await signIn('other@example.test', 'B');
    const [indexed = '', stale = ''] = await seedMany(user, 2, 'm', { state: 'active' });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO link_passages (vector_id, link_id, user_id, version, position, text)
         VALUES (?, ?, ?, 0, 0, 'text')`,
      ).bind(`${indexed}:0:0`, indexed, user.id),
      env.DB.prepare(
        'INSERT INTO link_passages (vector_id, link_id, user_id, version, position, text) VALUES (?, ?, ?, 0, 0, ?)',
      ).bind(`${stale}:0:0`, stale, user.id, 'text'),
    ]);
    // The note's change moves the stale link's text version past its passage.
    await api('PATCH', `/api/v1/links/${stale}`, { as: user.session, body: { note: 'new' } });
    await env.DB.batch([
      env.DB.prepare('INSERT INTO vector_deletions (vector_id, user_id) VALUES (?, ?)').bind(
        'v1',
        user.id,
      ),
      env.DB.prepare('INSERT INTO vector_deletions (vector_id, user_id) VALUES (?, ?)').bind(
        'v2',
        user.id,
      ),
      env.DB.prepare('INSERT INTO vector_deletions (vector_id, user_id) VALUES (?, ?)').bind(
        'v3',
        other.id,
      ),
    ]);
    const r = await stats(user);
    expect(r.json.backlog.index_stale).toBe(1);
    expect(r.json.backlog.vector_deletions).toBe(2);
  });

  it('counts the links due a liveness check, as the hourly run enqueues them', async () => {
    setNow(NOW);
    const user = await signIn();
    const seed = async (state: string, opts: Record<string, unknown>) => {
      const [id = ''] = await seedLinks(user, [
        {
          url: `https://live${crypto.randomUUID()}.example/`,
          state,
          lastUsedAt: NOW,
          addedAt: daysAgo(30),
        },
      ]);
      for (const [k, v] of Object.entries(opts)) await setLink(id, k, v);
      return id;
    };
    const due1 = await seed('active', { last_checked_at: daysAgo(8) });
    await seed('active', { last_checked_at: daysAgo(2) });
    const due2 = await seed('pending', { pin_position: 1, added_at: daysAgo(8) });
    await seed('active', {
      last_checked_at: daysAgo(8),
      check_enqueued_at: new Date(Date.parse(NOW) - 3_600_000).toISOString(),
    });
    await seed('expired', { last_checked_at: daysAgo(8) });
    await seed('archived', { last_checked_at: daysAgo(8) });

    const r = await stats(user);
    expect(r.json.backlog.liveness_due).toBe(2);
    const sent = recordLivenessQueue();
    await runScheduled(env);
    expect(sent.map((m) => m.body.link_id).sort()).toEqual([due1, due2].sort());
  });

  it.each([
    ['the throttle’s next slot', 12 * 60_000, null, 12 * 60_000],
    ['the later import window', 60_000, 5 * 60_000, 5 * 60_000],
    ['nothing, once the slot has passed', -60_000, null, null],
    ['nothing, with no slot', null, null, null],
  ])('gives when background work clears: %s', async (_, next, windowEnd, expected) => {
    setNow(NOW);
    const user = await signIn();
    const t = Date.parse(NOW);
    await env.DB.prepare(
      'UPDATE users SET throttle_next_at = ?, import_window_end = ? WHERE id = ?',
    )
      .bind(next === null ? null : t + next, windowEnd === null ? null : t + windowEnd, user.id)
      .run();
    const r = await stats(user);
    expect(r.json.backlog.throttle_clear_at).toBe(
      expected === null ? null : new Date(t + expected).toISOString(),
    );
  });
});

/** Records a use of the link at `at`, directly. */
async function useAt(user: TestUser, link: string, at: string): Promise<void> {
  await env.DB.prepare('INSERT INTO link_uses (link_id, user_id, at) VALUES (?, ?, ?)')
    .bind(link, user.id, at)
    .run();
}

describe('activity', () => {
  const T = '2026-11-10T00:30:00.000Z';

  it('gives links added and uses per UTC day over the last 30 days, oldest first', async () => {
    setNow(T);
    const user = await signIn();
    const added = [
      '2026-11-10T00:10:00.000Z',
      '2026-11-09T23:50:00.000Z',
      '2026-11-09T23:59:59.999Z',
      '2026-10-11T23:59:00.000Z',
      '2026-10-12T00:00:00.000Z',
      '2026-11-05T08:00:00.000Z',
    ];
    const ids = await seedLinks(
      user,
      added.map((addedAt, i) => ({ url: `https://a${i}.example/`, addedAt, lastUsedAt: T })),
    );
    await useAt(user, ids[0]!, '2026-11-09T10:00:00.000Z');
    await useAt(user, ids[1]!, '2026-11-09T11:00:00.000Z');
    await useAt(user, ids[1]!, '2026-10-01T11:00:00.000Z');

    const r = await stats(user);
    const days = r.json.activity.added_per_day as { day: string; count: number }[];
    expect(days).toHaveLength(30);
    expect(days[0]!.day).toBe('2026-10-12');
    expect(days.at(-1)!.day).toBe('2026-11-10');
    const at = (list: { day: string; count: number }[], day: string) =>
      list.find((d) => d.day === day)?.count;
    expect(at(days, '2026-10-12')).toBe(1);
    expect(at(days, '2026-11-09')).toBe(2);
    expect(at(days, '2026-11-10')).toBe(1);
    expect(at(days, '2026-11-05')).toBe(1);
    expect(days.reduce((sum, d) => sum + d.count, 0)).toBe(5);
    const uses = r.json.activity.uses_per_day as { day: string; count: number }[];
    expect(uses).toHaveLength(30);
    expect(at(uses, '2026-11-09')).toBe(2);
    expect(uses.reduce((sum, d) => sum + d.count, 0)).toBe(2);
    expect(r.json.activity.added_last_7_days).toBe(4);
    expect(r.json.activity.added_last_30_days).toBe(5);
  });

  it('lists the 10 most used links of the last 30 days, and counts the never used', async () => {
    setNow(T);
    const user = await signIn();
    const ids = await seedLinks(
      user,
      Array.from({ length: 12 }, (_, i) => ({
        url: `https://u${i}.example/`,
        useCount: i < 10 ? 1 : 0,
      })),
    );
    // Links 0 and 1 tie on 3 uses; link 0 was used last, yesterday.
    for (const day of ['2026-11-01', '2026-11-02', '2026-11-09']) {
      await useAt(user, ids[0]!, `${day}T10:00:00.000Z`);
    }
    for (const day of ['2026-11-01', '2026-11-02', '2026-11-08']) {
      await useAt(user, ids[1]!, `${day}T10:00:00.000Z`);
    }
    // Link 2 was used only 31 days ago.
    await useAt(user, ids[2]!, '2026-10-10T10:00:00.000Z');
    for (const i of [3, 4, 5, 6, 7, 8, 9]) await useAt(user, ids[i]!, '2026-11-03T10:00:00.000Z');
    await setLink(ids[2]!, 'use_count', 1);
    const r = await stats(user);
    const most = r.json.activity.most_used as { id: string; uses: number }[];
    expect(most.map((m) => m.id).slice(0, 2)).toEqual([ids[0], ids[1]]);
    expect(most[0]).toEqual({ id: ids[0], title: 'u0.example', host: 'u0.example', uses: 3 });
    expect(most.map((m) => m.id)).not.toContain(ids[2]);
    expect(most).toHaveLength(9);
    expect(r.json.activity.never_used).toBe(2);
  });

  it('counts the fetch attempts of the last 30 days and their failures’ reasons', async () => {
    setNow(T);
    const user = await signIn();
    const [id = ''] = await seedMany(user, 1, 'f');
    const event = (at: string, outcome: string, reason: string | null) =>
      env.DB.prepare(
        `INSERT INTO link_events (link_id, user_id, kind, at, outcome, reason)
         VALUES (?, ?, 'fetch', ?, ?, ?)`,
      ).bind(id, user.id, at, outcome, reason);
    await env.DB.batch([
      event('2026-11-09T10:00:00.000Z', 'ok', null),
      event('2026-11-01T10:00:00.000Z', 'ok', null),
      event('2026-10-12T00:00:00.000Z', 'ok', null),
      event('2026-11-02T10:00:00.000Z', 'failed', 'HTTP 503'),
      event('2026-11-03T10:00:00.000Z', 'failed', 'HTTP 503'),
      event('2026-10-01T10:00:00.000Z', 'failed', 'timed out'),
    ]);
    const r = await stats(user);
    expect(r.json.activity.fetches).toEqual({
      ok: 3,
      failed: 2,
      failed_by_reason: [{ reason: 'HTTP 503', count: 2 }],
    });
  });

  it('lists the owner’s last 10 imports with their counts', async () => {
    const user = await signIn();
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) {
      setNow(Date.parse(T) + i * 60_000);
      ids.push(await importUrls(user, [`https://imp${i}.example/`, 'http://localhost/x']));
    }
    const r = await stats(user);
    const listed = r.json.activity.imports as { id: string }[];
    expect(listed.map((i) => i.id)).toEqual(ids.slice(1).reverse());
    expect(listed[0]).toEqual({
      id: ids[10],
      created_at: new Date(Date.parse(T) + 10 * 60_000).toISOString(),
      url_lines: 2,
      added: 1,
      duplicates: 0,
      invalid: 1,
      not_imported: 0,
    });
  });
});

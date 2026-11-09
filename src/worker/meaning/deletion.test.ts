import { describe, expect, it } from 'vitest';
import { evaluateDecay } from '../decay/decay';
import {
  api,
  count,
  deliverIndexing,
  env,
  recordIndexQueue,
  runEveryMinute,
  seedLinks,
  setNow,
  signIn,
  type TestUser,
} from '../test/helpers';
import { ARTICLES, meaning, seedArticle } from '../test/meaning';

/** Queues `n` vector ids for deletion and puts their vectors in the fake index. */
async function queueVectors(n: number, namespace = 'someone'): Promise<string[]> {
  const ids = Array.from({ length: n }, (_, i) => `vector-${i}`);
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?1 - 1)
     INSERT INTO vector_deletions (vector_id, user_id) SELECT 'vector-' || i, ?2 FROM n`,
  )
    .bind(n, namespace)
    .run();
  meaning.index.upsert(ids.map((id) => ({ id, namespace, values: [1, 0, 0, 0] })));
  return ids;
}

describe('deleting vectors from the index', () => {
  it('deletes the queued vectors, at most 1,000 to a call, until none is queued', async () => {
    const ids = await queueVectors(2_500);

    await runEveryMinute();

    const calls = meaning.callsOf('deleteByIds');
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((c) => c.ids!.length <= 1_000)).toBe(true);
    expect(new Set(calls.flatMap((c) => c.ids!))).toEqual(new Set(ids));
    expect(await count('vector_deletions')).toBe(0);
    expect(meaning.index.all()).toEqual([]);
  });

  it('keeps the ids queued when the index fails, and still backfills', async () => {
    const user = await signIn();
    const [stale] = await seedLinks(user, [{ url: 'https://stale.example/' }]);
    await queueVectors(5);
    const sent = recordIndexQueue();
    meaning.fail('deleteByIds');

    await runEveryMinute();

    expect(await count('vector_deletions')).toBe(5);
    expect(sent.map((m) => m.body.link_id)).toEqual([stale]);

    meaning.recover();
    await runEveryMinute();
    expect(await count('vector_deletions')).toBe(0);
    expect(meaning.index.all()).toEqual([]);
  });
});

/** The vector ids of a link's passages. */
async function vectorIdsOf(linkId: string): Promise<string[]> {
  const rows = await env.DB.prepare('SELECT vector_id FROM link_passages WHERE link_id = ?')
    .bind(linkId)
    .all<{ vector_id: string }>();
  return rows.results.map((r) => r.vector_id);
}

async function queuedIds(): Promise<string[]> {
  const rows = await env.DB.prepare('SELECT vector_id FROM vector_deletions').all<{
    vector_id: string;
  }>();
  return rows.results.map((r) => r.vector_id);
}

/** Indexes a link by hand, as the queue consumer would. */
async function indexLink(user: TestUser, linkId: string) {
  await deliverIndexing([{ user_id: user.id, link_id: linkId }]);
}

describe('deleting a link that is indexed', () => {
  it.each([
    {
      path: 'the owner deletes it',
      state: 'active',
      remove: async (user: TestUser, id: string) => {
        const r = await api('DELETE', `/api/v1/links/${id}`, { as: user.session });
        expect(r.status).toBe(204);
      },
    },
    {
      path: 'decay removes it',
      state: 'expired',
      remove: async (user: TestUser, id: string) => {
        const t = Date.parse('2026-11-09T10:00:00.000Z');
        setNow(t);
        await env.DB.prepare('UPDATE links SET expired_at = ? WHERE id = ?')
          .bind(new Date(t - 181 * 86_400_000).toISOString(), id)
          .run();
        await evaluateDecay(env, user.id);
      },
    },
  ])(
    'removes its passages with it and queues all their vectors when $path',
    async ({ state, remove }) => {
      const user = await signIn();
      const id = await seedArticle(user, { ...ARTICLES.alarms, state });
      await indexLink(user, id);
      const vectors = await vectorIdsOf(id);
      expect(vectors.length).toBeGreaterThan(0);

      await remove(user, id);

      expect(await count('links', 'id = ?', id)).toBe(0);
      expect(await count('link_passages', 'link_id = ?', id)).toBe(0);
      expect((await queuedIds()).sort()).toEqual([...vectors].sort());
    },
  );

  it('is no longer returned by a passage request, though its vectors are still in the index', async () => {
    const user = await signIn();
    const id = await seedArticle(user, ARTICLES.alarms);
    await indexLink(user, id);
    const returned = async () =>
      (
        (await api('GET', '/api/v1/passages?q=run+a+task+later', { as: user.session })).json
          .items as { link_id: string }[]
      ).map((i) => i.link_id);
    expect(await returned()).toContain(id);

    await api('DELETE', `/api/v1/links/${id}`, { as: user.session });

    expect(await returned()).toEqual([]);
    expect(meaning.index.all(user.id).length).toBeGreaterThan(0);
    await runEveryMinute();
    expect(meaning.index.all(user.id)).toEqual([]);
  });
});

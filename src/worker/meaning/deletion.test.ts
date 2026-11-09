import { describe, expect, it } from 'vitest';
import { count, env, recordIndexQueue, runEveryMinute, seedLinks, signIn } from '../test/helpers';
import { meaning } from '../test/meaning';

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

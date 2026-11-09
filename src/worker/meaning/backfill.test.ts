import { describe, expect, it } from 'vitest';
import {
  env,
  recordIndexQueue,
  runEveryMinute,
  seedLinks,
  setNow,
  signIn,
  deliverIndexing,
} from '../test/helpers';
import { ARTICLES, seedArticle } from '../test/meaning';
import type { TestUser } from '../test/helpers';

const T = Date.parse('2026-11-09T10:00:00.000Z');

/** Runs the every-minute job `minutes` after T and returns the links it queued for indexing, by user. */
async function runAt(minutes: number): Promise<Map<string, string[]>> {
  setNow(T + minutes * 60_000);
  const sent = recordIndexQueue();
  await runEveryMinute();
  const byUser = new Map<string, string[]>();
  for (const { body } of sent)
    byUser.set(body.user_id, [...(byUser.get(body.user_id) ?? []), body.link_id]);
  return byUser;
}

/** `count` links of the user with no passages. */
function seed(user: TestUser, count: number, host: string): Promise<string[]> {
  return seedLinks(
    user,
    Array.from({ length: count }, (_, i) => ({ url: `https://${host}.example/${i}` })),
  );
}

describe('the backfill', () => {
  it('queues at most 60 stale links a minute for each user, none twice within 10 minutes', async () => {
    const a = await signIn('a@example.test', 'A');
    const b = await signIn('b@example.test', 'B');
    const c = await signIn('c@example.test', 'C');
    const aLinks = await seed(a, 150, 'a');
    await seed(b, 4, 'b');
    // An indexed link whose note changed since is stale as well.
    const changed = await seedArticle(b, ARTICLES.alarms);
    await deliverIndexing([{ user_id: b.id, link_id: changed }]);
    await env.DB.prepare('UPDATE links SET note = ? WHERE id = ?')
      .bind('Changed since.', changed)
      .run();
    await seed(c, 5, 'c');
    await env.DB.prepare('UPDATE users SET deletion_requested_at = ? WHERE id = ?')
      .bind(new Date(T).toISOString(), c.id)
      .run();

    const first = await runAt(0);
    expect(new Set(first.get(a.id)).size).toBe(60);
    expect(first.get(a.id)).toHaveLength(60);
    expect(first.get(b.id)).toHaveLength(5);
    expect(first.get(b.id)).toContain(changed);
    expect(first.get(c.id)).toBeUndefined();

    const second = await runAt(1);
    expect(second.get(a.id)).toHaveLength(60);
    expect(second.get(a.id)!.filter((id) => first.get(a.id)!.includes(id))).toEqual([]);
    expect(second.get(b.id)).toBeUndefined();

    const third = await runAt(2);
    expect(third.get(a.id)).toHaveLength(30);
    const queuedOnce = [...first.get(a.id)!, ...second.get(a.id)!, ...third.get(a.id)!];
    expect(new Set(queuedOnce)).toEqual(new Set(aLinks));
    expect((await runAt(3)).get(a.id)).toBeUndefined();

    // Ten minutes on, the links queued first and never indexed are queued again.
    expect(new Set((await runAt(11)).get(a.id))).toEqual(new Set(first.get(a.id)));
  });

  it('leaves the order of a user’s stale links to recency of use, most recent first', async () => {
    const user = await signIn();
    const ids = await seed(user, 80, 'recent');
    const queued = (await runAt(0)).get(user.id)!;
    expect(new Set(queued)).toEqual(new Set(ids.slice(20)));
  });

  it('indexes a library of 10,000 links within 3 hours', { timeout: 180_000 }, async () => {
    const user = await signIn();
    await seed(user, 10_000, 'big');
    const queued = new Set<string>();
    let minutes = 0;
    for (; queued.size < 10_000 && minutes < 180; minutes++) {
      const ids = (await runAt(minutes)).get(user.id) ?? [];
      for (const id of ids) expect(queued.has(id)).toBe(false);
      ids.forEach((id) => queued.add(id));
      // The index worker would have made their passages by the next minute.
      await env.DB.prepare(
        `INSERT INTO link_passages (vector_id, link_id, user_id, version, position, text)
         SELECT value || ':0:0', value, ?, 0, 0, 'indexed' FROM json_each(?)`,
      )
        .bind(user.id, JSON.stringify(ids))
        .run();
    }
    expect(queued.size).toBe(10_000);
    expect(minutes).toBeLessThanOrEqual(180);
  });
});

import { describe, expect, it } from 'vitest';
import { api, deliverIndexing, signIn, type TestUser } from '../test/helpers';
import { ARTICLES, meaning, seedArticle, type Article } from '../test/meaning';

/** Seeds and indexes the articles; the links' ids, in order. */
async function indexed(user: TestUser, articles: Article[]): Promise<string[]> {
  const ids: string[] = [];
  for (const article of articles) ids.push(await seedArticle(user, article));
  const r = await deliverIndexing(ids.map((link_id) => ({ user_id: user.id, link_id })));
  expect(r.retried).toEqual([]);
  return ids;
}

const related = (user: TestUser, id: string) =>
  api('GET', `/api/v1/links/${id}/related`, { as: user.session });

describe('GET /api/v1/links/{id}/related', () => {
  it('returns the other links near in meaning, best first, without the link itself', async () => {
    const user = await signIn();
    const [alarms, queues] = await indexed(user, [
      ARTICLES.alarms,
      ARTICLES.queues,
      ARTICLES.tomatoes,
    ]);

    const r = await related(user, alarms!);

    expect(r.status).toBe(200);
    expect(r.json.items.map((i: { id: string }) => i.id)).toEqual([queues]);
    expect(r.json.items[0]).toMatchObject({ title: ARTICLES.queues.title, state: 'active' });
    expect(r.json.items[0].score).toBeGreaterThanOrEqual(0.65);
  });

  it.each([
    {
      label: 'an expired link',
      seed: async (user: TestUser) => {
        const [alarms] = await indexed(user, [
          ARTICLES.alarms,
          { ...ARTICLES.queues, state: 'expired' },
        ]);
        return alarms!;
      },
    },
    {
      label: 'a link whose reader text alone is near in meaning',
      seed: async (user: TestUser) => {
        const [alarms] = await indexed(user, [
          ARTICLES.alarms,
          { ...ARTICLES.tomatoes, text: ARTICLES.alarms.text },
        ]);
        return alarms!;
      },
    },
    {
      label: 'a link whose metadata is near in meaning but below the related threshold',
      seed: async (user: TestUser) => {
        // Shares one word group of the two each mentions: a similarity of 0.5.
        const [alarms] = await indexed(user, [
          ARTICLES.alarms,
          { url: 'https://example.com/worker-garden', title: 'A worker in the garden' },
        ]);
        return alarms!;
      },
    },
    {
      label: 'any link when the link is not indexed yet',
      seed: async (user: TestUser) => {
        await indexed(user, [ARTICLES.queues]);
        return seedArticle(user, ARTICLES.alarms);
      },
    },
    {
      label: 'another user’s link',
      seed: async (user: TestUser) => {
        const other = await signIn('other@example.test');
        await indexed(other, [ARTICLES.queues]);
        meaning.ignoreNamespaces = true;
        const [alarms] = await indexed(user, [ARTICLES.alarms]);
        return alarms!;
      },
    },
  ])('leaves out $label', async ({ seed }) => {
    const user = await signIn();
    const id = await seed(user);
    const r = await related(user, id);
    expect(r.status).toBe(200);
    expect(r.json.items).toEqual([]);
  });

  it('answers 404 for a link that is not the user’s, and 503 when the index fails', async () => {
    const user = await signIn();
    const [alarms] = await indexed(user, [ARTICLES.alarms, ARTICLES.queues]);
    expect((await related(user, 'missing')).status).toBe(404);

    meaning.fail('query');
    const r = await related(user, alarms!);
    expect(r.status).toBe(503);
    expect(r.json.error).toBe('search_unavailable');
  });
});

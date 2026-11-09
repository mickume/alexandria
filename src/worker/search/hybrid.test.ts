import { describe, expect, it } from 'vitest';
import { api, deliverIndexing, signIn, type TestUser } from '../test/helpers';
import { ARTICLES, meaning, seedArticle } from '../test/meaning';

/** GET /api/v1/search as the user. */
function search(user: TestUser, query: string, extra = '') {
  return api('GET', `/api/v1/search?q=${encodeURIComponent(query)}${extra}`, { as: user.session });
}

/** Indexes the links as the queue consumer would. */
async function index(user: TestUser, ids: string[]) {
  const r = await deliverIndexing(ids.map((link_id) => ({ user_id: user.id, link_id })));
  expect(r.retried).toEqual([]);
}

/** The three articles of the fixtures, the first tagged 'infra' and pinned later by a test, indexed. */
async function library(user: TestUser): Promise<string[]> {
  const ids = [
    await seedArticle(user, { ...ARTICLES.alarms, tags: ['infra'] }),
    await seedArticle(user, ARTICLES.queues),
    await seedArticle(user, ARTICLES.tomatoes),
  ];
  await index(user, ids);
  return ids;
}

describe('the search mode', () => {
  it.each(['cloudflare queues', 'tag:infra', '', 'cloudflare state:any', 'zzz-nothing'])(
    'answers "%s" byte for byte as before without a mode and with mode=keyword',
    async (query) => {
      const user = await signIn();
      await library(user);

      const bare = await search(user, query);
      const keyword = await search(user, query, '&mode=keyword');

      expect(keyword.status).toBe(bare.status);
      const text = await bare.response.clone().text();
      expect(await keyword.response.text()).toBe(text);
      expect(bare.json).not.toHaveProperty('meaning');
      for (const item of bare.json.items) expect(item).not.toHaveProperty('match');
    },
  );

  it.each(['', 'HYBRID', 'semantic', 'keyword,hybrid'])(
    'refuses mode "%s" without embedding anything',
    async (mode) => {
      const user = await signIn();
      await library(user);
      meaning.calls.length = 0;

      const r = await search(user, 'alarms', `&mode=${encodeURIComponent(mode)}`);

      expect(r.status).toBe(400);
      expect(r.json).toEqual({
        error: 'invalid_mode',
        field: 'mode',
        message: 'mode takes keyword, hybrid',
      });
      expect(meaning.calls).toEqual([]);
    },
  );

  it.each(['', '   ', 'tag:infra', 'state:archived', 'host:example.com'])(
    'answers the query "%s" of filters only or nothing as keyword does, with meaning used',
    async (query) => {
      const user = await signIn();
      await library(user);
      meaning.calls.length = 0;

      const keyword = await search(user, query, '&mode=keyword');
      const hybrid = await search(user, query, '&mode=hybrid');

      expect(hybrid.status).toBe(200);
      expect(hybrid.json).toEqual({ ...keyword.json, meaning: 'used' });
      expect(meaning.calls).toEqual([]);
    },
  );
});

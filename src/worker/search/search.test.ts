import { describe, expect, it } from 'vitest';
import { FakeOrigin } from '../test/origin';
import {
  addAndFetch,
  api,
  deliverFetches,
  env,
  recordFetchQueue,
  signIn,
  type TestUser,
} from '../test/helpers';
import { indexReaderText } from './search';

/** The ids of the user's links whose index row holds `word` as a word prefix. */
async function indexed(user: TestUser, word: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT link_id FROM link_search WHERE link_search MATCH ? ORDER BY link_id`,
  )
    .bind(
      `owner : "u${user.id.replace(/-/g, '')}" AND {title tags topic summary host original_url note reader_text} : "${word}"*`,
    )
    .all<{ link_id: string }>();
  return rows.results.map((r) => r.link_id);
}

async function add(user: TestUser, url: string): Promise<string> {
  const r = await api('POST', '/api/v1/links', { as: user.session, body: { url } });
  expect(r.status).toBe(201);
  return r.json.link.id;
}

async function patch(user: TestUser, id: string, body: Record<string, unknown>) {
  const r = await api('PATCH', `/api/v1/links/${id}`, { as: user.session, body });
  expect(r.status).toBe(200);
}

const articlePage = (word: string) => `<!doctype html><html><head><title>Airships</title></head>
<body><article><h1>Airships</h1>
<p>${'An airship floats because it is lighter than the air around it. '.repeat(20)}</p>
<p>The ${word} was the most famous kind of airship ever built, and people remember it.</p>
<p>${'Engines push it forward and fins steer it through the sky. '.repeat(20)}</p>
</article></body></html>`;

describe('the search index', () => {
  describe('follows every write to a link', () => {
    it('adding a link', async () => {
      const user = await signIn();
      const id = await add(user, 'https://bravo.example/page');
      expect(await indexed(user, 'bravo')).toEqual([id]);
    });

    it.each([
      ['title', { title: 'alpha' }, { title: 'bravo' }],
      ['summary', { summary: 'about alpha' }, { summary: 'about bravo' }],
      ['tags', { tags: ['alpha'] }, { tags: ['bravo'] }],
      ['topic', { topic: 'Alpha' }, { topic: 'Bravo' }],
      ['note', { note: 'see alpha' }, { note: 'see bravo' }],
    ])('editing the %s', async (_field, first, second) => {
      const user = await signIn();
      const id = await add(user, 'https://edits.example/');
      await patch(user, id, first);
      expect(await indexed(user, 'alpha')).toEqual([id]);
      await patch(user, id, second);
      expect(await indexed(user, 'alpha')).toEqual([]);
      expect(await indexed(user, 'bravo')).toEqual([id]);
    });

    it('renaming a tag or a topic the link carries', async () => {
      const user = await signIn();
      const id = await add(user, 'https://renames.example/');
      await patch(user, id, { tags: ['alpha'], topic: 'Alphatopic' });
      await env.DB.prepare(`UPDATE tags SET name = 'bravo' WHERE user_id = ?`).bind(user.id).run();
      await env.DB.prepare(`UPDATE topics SET name = 'Bravotopic' WHERE user_id = ?`)
        .bind(user.id)
        .run();
      expect(await indexed(user, 'alpha')).toEqual([]);
      expect(await indexed(user, 'bravo')).toEqual([id]);
      expect(await indexed(user, 'bravotopic')).toEqual([id]);
    });

    it('deleting the link', async () => {
      const user = await signIn();
      const id = await add(user, 'https://alpha.example/');
      await patch(user, id, { tags: ['alpha'], note: 'alpha' });
      expect(await indexed(user, 'alpha')).toEqual([id]);
      expect((await api('DELETE', `/api/v1/links/${id}`, { as: user.session })).status).toBe(204);
      expect(await indexed(user, 'alpha')).toEqual([]);
      const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM link_search').first<{
        n: number;
      }>();
      expect(rows?.n).toBe(0);
    });

    it("holds one row per link, each with its owner's id and nobody else's", async () => {
      const a = await signIn('owner@example.test');
      const b = await signIn('other@example.test');
      const mine = await add(a, 'https://same.example/');
      const theirs = await add(b, 'https://same.example/');
      expect(await indexed(a, 'same')).toEqual([mine]);
      expect(await indexed(b, 'same')).toEqual([theirs]);
    });
  });

  describe('holds the reader-view text the fetch worker stores', () => {
    it('replaces the text when the page is fetched again', async () => {
      const user = await signIn();
      const url = 'https://airships.example/history';
      const origin = new FakeOrigin().page(url, articlePage('zeppelin'));
      const { id } = await addAndFetch(user, url);
      expect(await indexed(user, 'zeppelin')).toEqual([id]);

      origin.page(url, articlePage('dirigible'));
      const sent = recordFetchQueue();
      const r = await api('POST', `/api/v1/links/${id}/refresh`, { as: user.session });
      expect(r.status).toBe(202);
      await deliverFetches(sent.map((m) => m.body));
      expect(await indexed(user, 'zeppelin')).toEqual([]);
      expect(await indexed(user, 'dirigible')).toEqual([id]);
    });

    it('drops the text when a fetch stores none', async () => {
      const user = await signIn();
      const url = 'https://airships.example/file';
      const origin = new FakeOrigin().page(url, articlePage('zeppelin'));
      const { id } = await addAndFetch(user, url);
      origin.page(url, 'zeppelin as plain bytes', 'application/octet-stream');
      const sent = recordFetchQueue();
      await api('POST', `/api/v1/links/${id}/refresh`, { as: user.session });
      await deliverFetches(sent.map((m) => m.body));
      expect(await indexed(user, 'zeppelin')).toEqual([]);
    });

    it('indexes at most the first 500,000 characters', async () => {
      const user = await signIn();
      const id = await add(user, 'https://long.example/');
      const text = 'filler '.repeat(78_572).slice(0, 550_000) + ' tailword ' + 'x'.repeat(49_990);
      expect(text.length).toBe(600_000);
      await indexReaderText(env, id, `headword ${text}`);
      expect(await indexed(user, 'headword')).toEqual([id]);
      expect(await indexed(user, 'tailword')).toEqual([]);
    });
  });
});

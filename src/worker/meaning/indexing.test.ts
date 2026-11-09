import { describe, expect, it } from 'vitest';
import { PASSAGE_MAX } from './cut';
import { api, deliverIndexing, env, seedLinks, signIn, type TestUser } from '../test/helpers';
import { ARTICLES, meaning, seedArticle, type Article } from '../test/meaning';

interface PassageRow {
  vector_id: string;
  version: number;
  position: number;
  text: string;
}

/** The passages stored for a link, in order. */
async function passagesOf(linkId: string): Promise<PassageRow[]> {
  const rows = await env.DB.prepare(
    'SELECT vector_id, version, position, text FROM link_passages WHERE link_id = ? ORDER BY position',
  )
    .bind(linkId)
    .all<PassageRow>();
  return rows.results;
}

/** The text version of a link: 0 for a link whose text never changed. */
async function versionOf(linkId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COALESCE((SELECT text_version FROM link_index_state WHERE link_id = ?), 0) AS version',
  )
    .bind(linkId)
    .first<{ version: number }>();
  return row!.version;
}

/** The vector ids waiting to be deleted from the index. */
async function queuedDeletions(): Promise<string[]> {
  const rows = await env.DB.prepare('SELECT vector_id FROM vector_deletions').all<{
    vector_id: string;
  }>();
  return rows.results.map((r) => r.vector_id);
}

/** The ids of every vector the fake index was asked to store. */
function upsertedIds(): string[] {
  return meaning.callsOf('upsert').flatMap((c) => c.ids ?? []);
}

/** Indexes one link as the queue consumer would. */
function index(user: TestUser, linkId: string) {
  return deliverIndexing([{ user_id: user.id, link_id: linkId }]);
}

/** About `length` characters of words that belong to no word group. */
function filler(length: number): string {
  return 'lorem ipsum dolor '.repeat(Math.ceil(length / 18)).slice(0, length);
}

describe('indexing a link by meaning', () => {
  const page: Article = {
    ...ARTICLES.alarms,
    text: filler(4_000),
    note: 'Read before the migration.',
    topic: 'Cloudflare',
    tags: ['workers', 'alarms'],
  };

  it.each([
    { name: 'a fetched page with a note', article: page, min: 4, max: 4 },
    {
      name: 'a pending link with no reader text',
      article: { ...ARTICLES.queues, text: null, state: 'pending' },
      min: 1,
      max: 1,
    },
    {
      name: 'an unreachable link',
      article: { ...ARTICLES.queues, text: null, state: 'unreachable' },
      min: 1,
      max: 1,
    },
    {
      name: 'an archived link',
      article: { ...ARTICLES.tomatoes, state: 'archived' },
      min: 2,
      max: 2,
    },
    {
      name: 'a link with a 20,000-character note',
      article: { ...ARTICLES.tomatoes, text: null, note: filler(20_000) },
      min: 14,
      max: 20,
    },
  ])('cuts $name into passages and stores one vector for each', async ({ article, min, max }) => {
    const user = await signIn();
    const id = await seedArticle(user, article);
    const r = await index(user, id);
    expect(r).toEqual({ acked: ['m0'], retried: [] });

    const passages = await passagesOf(id);
    expect(passages.length).toBeGreaterThanOrEqual(min);
    expect(passages.length).toBeLessThanOrEqual(max);
    const version = await versionOf(id);
    expect(passages.every((p) => p.version === version)).toBe(true);
    expect(passages.every((p) => p.text.length >= 1 && p.text.length <= PASSAGE_MAX)).toBe(true);
    expect(passages.map((p) => p.position)).toEqual(passages.map((_, n) => n));
    expect(passages.map((p) => p.vector_id)).toEqual(
      passages.map((_, n) => `${id}:${version}:${n}`),
    );

    const first = passages[0]!.text;
    expect(first.startsWith(article.title)).toBe(true);
    for (const part of [article.summary, article.topic, ...(article.tags ?? [])]) {
      if (part) expect(first).toContain(part);
    }
    if (article.note && article.note.length < PASSAGE_MAX) expect(first).toContain(article.note);

    const stored = meaning.index.all().map((v) => [v.id, v.namespace]);
    expect(stored.sort()).toEqual(passages.map((p) => [p.vector_id, user.id]).sort());
  });

  it('replaces the passages of a link whose text changed and queues the old vectors for deletion', async () => {
    const user = await signIn();
    const id = await seedArticle(user, { ...ARTICLES.alarms, note: 'Read about alarms later.' });
    await index(user, id);
    const before = await passagesOf(id);

    const edit = await api('PATCH', `/api/v1/links/${id}`, {
      as: user.session,
      body: { note: 'Water the tomatoes.' },
    });
    expect(edit.status).toBe(200);
    expect(await index(user, id)).toEqual({ acked: ['m0'], retried: [] });

    const after = await passagesOf(id);
    const version = await versionOf(id);
    expect(version).toBeGreaterThan(before[0]!.version);
    expect(after.every((p) => p.version === version)).toBe(true);
    expect(after[0]!.text).toContain('Water the tomatoes.');
    expect(after.some((p) => p.text.includes('Read about alarms later.'))).toBe(false);
    expect((await queuedDeletions()).sort()).toEqual(before.map((p) => p.vector_id).sort());
    const stored = meaning.index.all(user.id).map((v) => v.id);
    expect(stored).toEqual(expect.arrayContaining(after.map((p) => p.vector_id)));
  });

  it('does not embed a link whose passages are current', async () => {
    const user = await signIn();
    const id = await seedArticle(user, ARTICLES.queues);
    await index(user, id);
    const before = await passagesOf(id);
    meaning.calls.length = 0;

    expect(await index(user, id)).toEqual({ acked: ['m0'], retried: [] });
    expect(meaning.calls).toEqual([]);
    expect(await passagesOf(id)).toEqual(before);
    expect(await queuedDeletions()).toEqual([]);
  });
});

describe('an indexing job that cannot finish', () => {
  it.each([
    { call: 'embed', earlier: false },
    { call: 'upsert', earlier: false },
    { call: 'embed', earlier: true },
    { call: 'upsert', earlier: true },
  ] as const)(
    'hands the message back and changes nothing when $call fails (indexed before: $earlier)',
    async ({ call, earlier }) => {
      const user = await signIn();
      const id = await seedArticle(user, ARTICLES.alarms);
      if (earlier) {
        await index(user, id);
        await api('PATCH', `/api/v1/links/${id}`, {
          as: user.session,
          body: { note: 'A new note.' },
        });
      }
      const passages = await passagesOf(id);
      const view = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
      const deletions = await queuedDeletions();

      meaning.calls.length = 0;
      meaning.fail(call);
      expect(await index(user, id)).toEqual({ acked: [], retried: ['m0'] });
      // The job got as far as the failing call, and no further.
      expect(meaning.callsOf(call)).toHaveLength(1);
      expect(meaning.callsOf(call === 'embed' ? 'upsert' : 'deleteByIds')).toHaveLength(0);

      expect(await passagesOf(id)).toEqual(passages);
      expect((await api('GET', `/api/v1/links/${id}`, { as: user.session })).json).toEqual(view);
      expect(await queuedDeletions()).toEqual(deletions);
    },
  );

  it.each([
    {
      name: 'its text changes',
      during: (user: TestUser, id: string) =>
        api('PATCH', `/api/v1/links/${id}`, {
          as: user.session,
          body: { note: 'Changed meanwhile.' },
        }),
    },
    {
      name: 'the link is deleted',
      during: (user: TestUser, id: string) =>
        api('DELETE', `/api/v1/links/${id}`, { as: user.session }),
    },
  ])(
    'stores nothing and queues the vectors it stored for deletion when $name while it runs',
    async ({ during }) => {
      const user = await signIn();
      const id = await seedArticle(user, ARTICLES.alarms);
      meaning.onEmbed = async () => {
        meaning.onEmbed = undefined;
        await during(user, id);
      };

      expect(await index(user, id)).toEqual({ acked: ['m0'], retried: [] });

      expect(await passagesOf(id)).toEqual([]);
      const ids = upsertedIds();
      expect(ids.length).toBeGreaterThan(0);
      expect((await queuedDeletions()).sort()).toEqual([...ids].sort());
    },
  );

  it('leaves the older passages of a link whose text changed while it ran', async () => {
    const user = await signIn();
    const id = await seedArticle(user, ARTICLES.alarms);
    await index(user, id);
    await api('PATCH', `/api/v1/links/${id}`, { as: user.session, body: { note: 'Second note.' } });
    const before = await passagesOf(id);
    meaning.onEmbed = async () => {
      meaning.onEmbed = undefined;
      await api('PATCH', `/api/v1/links/${id}`, {
        as: user.session,
        body: { note: 'Third note.' },
      });
    };

    expect(await index(user, id)).toEqual({ acked: ['m0'], retried: [] });

    expect(await passagesOf(id)).toEqual(before);
  });

  it.each([
    { name: 'a link that no longer exists', setup: async () => ({ link: crypto.randomUUID() }) },
    {
      name: 'a link of an account marked for deletion',
      setup: async (user: TestUser) => {
        const link = await seedArticle(user, ARTICLES.alarms);
        await env.DB.prepare('UPDATE users SET deletion_requested_at = ? WHERE id = ?')
          .bind('2026-11-01T00:00:00.000Z', user.id)
          .run();
        return { link };
      },
    },
  ])('acknowledges a message for $name without calling anyone', async ({ setup }) => {
    const user = await signIn();
    const { link } = await setup(user);

    expect(await index(user, link)).toEqual({ acked: ['m0'], retried: [] });

    expect(meaning.calls).toEqual([]);
    expect(await passagesOf(link)).toEqual([]);
  });
});

describe('what indexing leaves alone', () => {
  it('changes neither the link as the API shows it nor the stream’s change feed', async () => {
    const user = await signIn();
    const id = await seedArticle(user, ARTICLES.alarms);
    const view = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
    const after = new Date(Date.parse(view.updated_at) + 1).toISOString();

    expect(await index(user, id)).toEqual({ acked: ['m0'], retried: [] });

    expect((await api('GET', `/api/v1/links/${id}`, { as: user.session })).json).toEqual(view);
    const feed = await api('GET', `/api/v1/links?changed_since=${encodeURIComponent(after)}`, {
      as: user.session,
    });
    expect(feed.json.items).toEqual([]);
  });

  it('writes the vectors of each link into the namespace of its owner', async () => {
    const a = await signIn('a@example.test', 'A');
    const b = await signIn('b@example.test', 'B');
    const owners = new Map<string, string>();
    for (const [user, articles] of [
      [a, [ARTICLES.alarms, ARTICLES.queues]],
      [b, [ARTICLES.tomatoes, ARTICLES.alarms]],
    ] as const) {
      for (const article of articles) {
        const [id] = await seedLinks(user, [{ url: `${article.url}?${user.id}` }]);
        await env.DB.prepare('UPDATE links SET title = ? WHERE id = ?')
          .bind(article.title, id!)
          .run();
        owners.set(id!, user.id);
      }
    }

    const r = await deliverIndexing(
      [...owners].map(([link_id, user_id]) => ({ user_id, link_id })),
    );
    expect(r.acked).toHaveLength(4);

    const vectors = meaning.index.all();
    expect(vectors.length).toBeGreaterThanOrEqual(4);
    for (const v of vectors) expect(v.namespace).toBe(owners.get(v.id.split(':')[0]!));
  });
});

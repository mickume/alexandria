import { describe, expect, it } from 'vitest';
import { PASSAGE_MAX } from './cut';
import { FakeAi } from '../test/ai';
import { FakeOrigin } from '../test/origin';
import {
  addAndFetch,
  api,
  deliverEnrichments,
  deliverFetches,
  deliverIndexing,
  env,
  recordEnrichQueue,
  recordIndexQueue,
  seedLinks,
  signIn,
  type TestUser,
} from '../test/helpers';
import { ARTICLES, meaning, seedArticle, type Article } from '../test/meaning';
import { blogArticle } from '../fetcher/fixtures/pages';

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
      name: 'an expired link',
      article: { ...ARTICLES.tomatoes, state: 'expired' },
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

  it('labels each vector with whether it holds the link’s metadata or its reader text', async () => {
    const user = await signIn();
    const id = await seedArticle(user, { ...page, note: filler(2_000) });
    await index(user, id);

    const kinds = (await passagesOf(id)).map(
      (p) => meaning.index.all().find((v) => v.id === p.vector_id)?.metadata?.kind,
    );
    expect(kinds).toEqual(['metadata', 'metadata', 'reader', 'reader', 'reader']);
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

describe('the metadata a link is indexed by', () => {
  it('holds its topic path, joined with >', async () => {
    const user = await signIn();
    const id = await seedArticle(user, { ...ARTICLES.queues, topic: 'Platform > Queues' });
    await index(user, id);
    expect((await passagesOf(id))[0]!.text).toContain('Platform > Queues');
  });
});

describe('queueing a link for indexing', () => {
  interface Library {
    user: TestUser;
    ids: string[];
  }

  /** Three indexed links, all tagged 'infra'; the first two under the topic 'Platform', the third under 'Garden'. */
  async function library(): Promise<Library> {
    const user = await signIn();
    const ids = [
      await seedArticle(user, { ...ARTICLES.alarms, tags: ['infra'], topic: 'Platform' }),
      await seedArticle(user, { ...ARTICLES.queues, tags: ['infra'], topic: 'Platform' }),
      await seedArticle(user, { ...ARTICLES.tomatoes, tags: ['infra'], topic: 'Garden' }),
    ];
    await deliverIndexing(ids.map((link_id) => ({ user_id: user.id, link_id })));
    return { user, ids };
  }

  /** The id of one of the user's topics or tags, by name. */
  async function vocabularyId(user: TestUser, kind: 'topics' | 'tags', name: string) {
    const list = await api('GET', `/api/v1/${kind}`, { as: user.session });
    return (list.json.items as { id: string; name: string }[]).find((i) => i.name === name)!.id;
  }

  const edit =
    (body: Record<string, unknown>) =>
    ({ user, ids }: Library) =>
      api('PATCH', `/api/v1/links/${ids[0]}`, { as: user.session, body });
  const rename =
    (kind: 'topics' | 'tags', from: string, to: string) =>
    async ({ user }: Library) =>
      api('PATCH', `/api/v1/${kind}/${await vocabularyId(user, kind, from)}`, {
        as: user.session,
        body: { name: to },
      });
  const merge =
    (kind: 'topics' | 'tags', from: string, into: string) =>
    async ({ user }: Library) =>
      api('POST', `/api/v1/${kind}/${await vocabularyId(user, kind, from)}/merge`, {
        as: user.session,
        body: { into: await vocabularyId(user, kind, into) },
      });
  const post =
    (action: string) =>
    ({ user, ids }: Library) =>
      api('POST', `/api/v1/links/${ids[0]}/${action}`, { as: user.session });

  it.each([
    { name: 'an edit of the title', write: edit({ title: 'A new title' }), queued: [0] },
    { name: 'an edit of the summary', write: edit({ summary: 'A new summary.' }), queued: [0] },
    { name: 'an edit of the tags', write: edit({ tags: ['infra', 'alarms'] }), queued: [0] },
    { name: 'an edit of the topic', write: edit({ topic: 'Garden' }), queued: [0] },
    { name: 'an edit of the note', write: edit({ note: 'A new note.' }), queued: [0] },
    {
      name: 'a rename of a tag three links carry',
      write: rename('tags', 'infra', 'ops'),
      queued: [0, 1, 2],
    },
    {
      name: 'a rename of a topic two links carry',
      write: rename('topics', 'Platform', 'Infrastructure'),
      queued: [0, 1],
    },
    {
      name: 'a rename of a topic whose child carries a link',
      prepare: async ({ user, ids }: Library) => {
        await api('PATCH', `/api/v1/links/${ids[2]}`, {
          as: user.session,
          body: { topic: 'Platform > Beds' },
        });
      },
      write: rename('topics', 'Platform', 'Infrastructure'),
      queued: [0, 1, 2],
    },
    {
      name: 'a merge of a topic two links carry into another',
      write: merge('topics', 'Platform', 'Garden'),
      queued: [0, 1],
    },
    {
      name: 'a merge of a tag one link carries into another',
      prepare: async (lib: Library) => {
        await edit({ tags: ['infra', 'extra'] })(lib);
      },
      write: merge('tags', 'extra', 'infra'),
      queued: [0],
    },
    {
      name: 'an edit that sets the title the link already has',
      write: edit({ title: ARTICLES.alarms.title }),
      queued: [],
    },
    { name: 'a pin', write: post('pin'), queued: [] },
    {
      name: 'a use',
      write: ({ user, ids }: Library) =>
        api('GET', `/api/v1/links/${ids[0]}/open`, { as: user.session }),
      queued: [],
    },
  ] as {
    name: string;
    prepare?: (lib: Library) => Promise<void>;
    write: (lib: Library) => Promise<{ status: number }>;
    queued: number[];
  }[])('sends one message for each link whose text changed: $name', async (row) => {
    const lib = await library();
    await row.prepare?.(lib);
    // Indexing what the preparation changed, so that only the write itself can make a link stale.
    await deliverIndexing(lib.ids.map((link_id) => ({ user_id: lib.user.id, link_id })));
    const sent = recordIndexQueue();

    const written = await row.write(lib);

    expect([200, 302]).toContain(written.status);
    expect(sent.map((m) => m.body.link_id).sort()).toEqual(
      row.queued.map((i) => lib.ids[i]!).sort(),
    );
    expect(sent.every((m) => m.body.user_id === lib.user.id)).toBe(true);
  });

  it('sends one message for a first fetch that stores reader text', async () => {
    new FakeOrigin().page('https://news.example/queued', blogArticle);
    const user = await signIn();
    const sent = recordIndexQueue();

    const { id } = await addAndFetch(user, 'https://news.example/queued');

    expect(sent.map((m) => m.body)).toEqual([{ user_id: user.id, link_id: id }]);
  });

  it('sends one message for a refresh that stores reader text again', async () => {
    new FakeOrigin().page('https://news.example/refreshed', blogArticle);
    const user = await signIn();
    const { id } = await addAndFetch(user, 'https://news.example/refreshed');
    await deliverIndexing([{ user_id: user.id, link_id: id }]);
    const sent = recordIndexQueue();

    await deliverFetches([{ user_id: user.id, link_id: id, refresh: true }]);

    expect(sent.map((m) => m.body)).toEqual([{ user_id: user.id, link_id: id }]);
  });

  it('sends one message when enrichment stores a summary, a topic and tags', async () => {
    new FakeOrigin().page('https://news.example/enriched', blogArticle);
    new FakeAi().answer({ summary: 'A summary.', tags: ['one', 'two', 'three'], topic: 'A topic' });
    const user = await signIn();
    await api('PUT', '/api/v1/settings/ai', {
      as: user.session,
      body: { provider: 'anthropic', api_key: 'sk-ant-abcd1234' },
    });
    const enrich = recordEnrichQueue();
    const { id } = await addAndFetch(user, 'https://news.example/enriched');
    await deliverIndexing([{ user_id: user.id, link_id: id }]);
    const sent = recordIndexQueue();

    await deliverEnrichments(enrich.map((m) => m.body));

    expect(sent.map((m) => m.body)).toEqual([{ user_id: user.id, link_id: id }]);
  });

  it('still saves an edit when the queue cannot be reached, and leaves the link for the backfill', async () => {
    const { user, ids } = await library();
    const failing = {
      send: async () => Promise.reject(new Error('the queue is down')),
      sendBatch: async () => Promise.reject(new Error('the queue is down')),
    };
    env.INDEX_QUEUE = failing as unknown as typeof env.INDEX_QUEUE;

    const r = await api('PATCH', `/api/v1/links/${ids[0]}`, {
      as: user.session,
      body: { note: 'Saved all the same.' },
    });

    expect(r.status).toBe(200);
    expect(r.json.note).toBe('Saved all the same.');
  });
});

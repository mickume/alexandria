import { describe, expect, it } from 'vitest';
import { FakeOrigin } from '../test/origin';
import {
  addAndFetch,
  api,
  deliverFetches,
  env,
  recordFetchQueue,
  seedLinks,
  setNow,
  signIn,
  type TestUser,
} from '../test/helpers';
import { indexReaderText, indexReaderTextStatement } from './search';

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

/** Stores `text` as the link's reader-view text, as the fetch worker does. */
async function setReaderText(user: TestUser, id: string, text: string) {
  await env.DB.prepare(
    'INSERT OR REPLACE INTO link_texts (link_id, user_id, text) VALUES (?, ?, ?)',
  )
    .bind(id, user.id, text)
    .run();
  await indexReaderText(env, id, text);
}

async function search(user: TestUser, q: string, extra = '') {
  return api('GET', `/api/v1/search?q=${encodeURIComponent(q)}${extra}`, { as: user.session });
}

async function foundIds(user: TestUser, q: string): Promise<string[]> {
  const r = await search(user, q);
  expect(r.status).toBe(200);
  return r.json.items.map((i: { link: { id: string } }) => i.link.id);
}

/** Separates the times of the writes that follow, one second apart from `start`. */
function clockFrom(start: string) {
  let t = Date.parse(start);
  return () => setNow((t += 1000));
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

describe('GET /api/v1/search', () => {
  describe('finds a link by each field that holds the words', () => {
    const fields: [string, (u: TestUser) => Promise<string>][] = [
      [
        'title',
        async (u) => {
          const id = await add(u, 'https://one.example/');
          await patch(u, id, { title: 'Cloudflare Queues explained' });
          return id;
        },
      ],
      [
        'summary',
        async (u) => {
          const id = await add(u, 'https://one.example/');
          await patch(u, id, { summary: 'How Cloudflare queues messages between workers' });
          return id;
        },
      ],
      [
        'tag',
        async (u) => {
          const id = await add(u, 'https://one.example/');
          await patch(u, id, { tags: ['cloudflare', 'queues'] });
          return id;
        },
      ],
      [
        'topic',
        async (u) => {
          const id = await add(u, 'https://one.example/');
          await patch(u, id, { topic: 'Cloudflare queues' });
          return id;
        },
      ],
      ['host', (u) => add(u, 'https://queues.cloudflare.example/')],
      ['original URL', (u) => add(u, 'https://one.example/page?ref=cloudflare-queues')],
      [
        'note',
        async (u) => {
          const id = await add(u, 'https://one.example/');
          await patch(u, id, { note: 'read about cloudflare queues before the migration' });
          return id;
        },
      ],
      [
        'reader text',
        async (u) => {
          const id = await add(u, 'https://one.example/');
          await setReaderText(u, id, 'This article explains Cloudflare Queues in depth.');
          return id;
        },
      ],
    ];

    it.each(fields)('%s', async (_field, seed) => {
      const user = await signIn();
      const id = await seed(user);
      const other = await add(user, 'https://other.example/');
      await patch(user, other, { title: 'Kafka streams', note: 'nothing else' });
      expect(await foundIds(user, 'queu')).toEqual([id]);
      expect(await foundIds(user, 'QUEUES cloud')).toEqual([id]);
      expect(await foundIds(user, 'queues kafka')).toEqual([]);
    });
  });

  it('matches without regard to accents and leaves archived links out', async () => {
    const user = await signIn();
    const cafe = await add(user, 'https://cafe.example/');
    await patch(user, cafe, { title: 'Café culture' });
    const archived = await add(user, 'https://old.example/');
    await patch(user, archived, { title: 'Cafe history' });
    await api('POST', `/api/v1/links/${archived}/archive`, { as: user.session });
    expect(await foundIds(user, 'culture cafe')).toEqual([cafe]);
    expect(await foundIds(user, 'CAFÉ')).toEqual([cafe]);
  });

  it('ranks by the weighted fields, then pinned, then the more recently used', async () => {
    const user = await signIn();
    const tick = clockFrom('2026-05-01T08:00:00.000Z');
    const text = 'A long article that mentions queues once among many other words.';
    tick();
    const a = await add(user, 'https://a.example/');
    await setReaderText(user, a, text);
    tick();
    const b = await add(user, 'https://b.example/');
    await patch(user, b, { title: 'queues' });
    tick();
    const c = await add(user, 'https://c.example/');
    await patch(user, c, { tags: ['queues'] });
    tick();
    const d = await add(user, 'https://d.example/');
    await setReaderText(user, d, text);
    tick();
    const e = await add(user, 'https://e.example/');
    await setReaderText(user, e, text);
    expect((await api('POST', `/api/v1/links/${e}/pin`, { as: user.session })).status).toBe(200);
    expect(await foundIds(user, 'queues')).toEqual([b, c, e, d, a]);
  });

  it('gives each result a snippet of at most 32 words from the best column, as text segments', async () => {
    const user = await signIn();
    const id = await add(user, 'https://long.example/');
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`);
    words[300] = 'durable';
    words[301] = 'objects';
    words[303] = '<b>x</b>';
    await setReaderText(user, id, words.join(' '));
    const r = await search(user, 'durable');
    expect(r.status).toBe(200);
    const snippet: { text: string; match: boolean }[] = r.json.items[0].snippet;
    const passage = snippet.map((s) => s.text).join('');
    expect(passage.trim().split(/\s+/).length).toBeLessThanOrEqual(32);
    expect(snippet).toContainEqual({ text: 'durable', match: true });
    expect(snippet.some((s) => !s.match && s.text.includes('<b>x</b>'))).toBe(true);
    expect(words.join(' ')).toContain(passage);
  });

  it("returns only the user's own links and workspaces", async () => {
    const a = await signIn('owner@example.test');
    const b = await signIn('other@example.test');
    const mine = await add(a, 'https://same.example');
    await patch(a, mine, { note: 'shared words' });
    const theirs = await add(b, 'https://same.example');
    await patch(b, theirs, { note: 'shared words' });
    const w = await api('POST', '/api/v1/workspaces', { as: b.session, body: { name: 'shared' } });
    expect(w.status).toBe(201);
    await seedLinks(
      b,
      Array.from({ length: 1000 }, (_, i) => ({ url: `https://shared-${i}.example/` })),
    );
    for (const q of ['shared', 'shared host:same.example', 'tag:x', 'state:any']) {
      const r = await search(a, q);
      expect(r.status).toBe(200);
      const ids = r.json.items.map((i: { link: { id: string } }) => i.link.id);
      expect(ids.every((id: string) => id === mine)).toBe(true);
      expect(r.json.workspaces).toEqual([]);
    }
    expect(await foundIds(a, 'shared')).toEqual([mine]);
  });

  it('answers an empty or blank query with the stream', async () => {
    const user = await signIn();
    await seedLinks(user, [
      { url: 'https://one.example/' },
      { url: 'https://two.example/', pinPosition: 1 },
      { url: 'https://three.example/' },
    ]);
    const stream = await api('GET', '/api/v1/links', { as: user.session });
    const expected = stream.json.items.map((l: { id: string }) => l.id);
    for (const query of ['', '?q=', '?q=%20%20%20']) {
      const r = await api('GET', `/api/v1/search${query}`, { as: user.session });
      expect(r.status).toBe(200);
      expect(r.json.items.map((i: { link: { id: string } }) => i.link.id)).toEqual(expected);
      expect(r.json.items.every((i: { snippet: unknown[] }) => i.snippet.length === 0)).toBe(true);
      expect(r.json.workspaces).toEqual([]);
    }
  });

  it('pages the results with the cursor, 50 by default and at most 100', async () => {
    const user = await signIn();
    await seedLinks(
      user,
      Array.from({ length: 120 }, (_, i) => ({ url: `https://kiwi-${i}.example/` })),
    );
    const first = await search(user, 'kiwi');
    expect(first.json.items).toHaveLength(50);
    expect((await search(user, 'kiwi', '&limit=101')).status).toBe(400);
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const extra: string = `&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const r = await search(user, 'kiwi', extra);
      expect(r.status).toBe(200);
      for (const item of r.json.items) seen.add(item.link.id);
      cursor = r.json.next_cursor;
    } while (cursor);
    expect(seen.size).toBe(120);
    expect((await search(user, 'kiwi', '&cursor=forged')).json.error).toBe('invalid_cursor');
  });

  it('lists the matching workspaces on the first page only', async () => {
    const user = await signIn();
    const other = await signIn('other@example.test');
    const created = await api('POST', '/api/v1/workspaces', {
      as: user.session,
      body: { name: 'Kitchen remodel' },
    });
    const ws = created.json.id;
    await api('PATCH', `/api/v1/workspaces/${ws}`, {
      as: user.session,
      body: { note: 'tiles and grout' },
    });
    const theirs = await api('POST', '/api/v1/workspaces', {
      as: other.session,
      body: { name: 'Bathroom' },
    });
    await api('PATCH', `/api/v1/workspaces/${theirs.json.id}`, {
      as: other.session,
      body: { note: 'tiles and grout' },
    });
    for (const n of [1, 2]) {
      const id = await add(user, `https://grout-${n}.example/`);
      expect(id).toBeTruthy();
    }
    const r = await search(user, 'grout', '&limit=1');
    expect(r.json.workspaces).toHaveLength(1);
    expect(r.json.workspaces[0]).toMatchObject({ id: ws, name: 'Kitchen remodel' });
    expect(r.json.workspaces[0].snippet).toContainEqual({ text: 'grout', match: true });
    const next = await search(
      user,
      'grout',
      `&limit=1&cursor=${encodeURIComponent(r.json.next_cursor)}`,
    );
    expect(next.status).toBe(200);
    expect(next.json.items).toHaveLength(1);
    expect(next.json.workspaces).toEqual([]);
  });

  it('refuses a query over 200 characters and accepts one of exactly 200', async () => {
    const user = await signIn();
    const long = await search(user, 'x'.repeat(201));
    expect(long.status).toBe(400);
    expect(long.json).toMatchObject({ error: 'query_too_long', field: 'q' });
    expect((await search(user, 'x'.repeat(200))).status).toBe(200);
  });

  it.each(['state:gone', 'is:starred', 'state:', 'is:'])(
    'refuses the filter %j, naming it',
    async (q) => {
      const user = await signIn();
      const r = await search(user, q);
      expect(r.status).toBe(400);
      expect(r.json).toMatchObject({ error: 'invalid_filter', field: 'q' });
      expect(r.json.message).toContain(q);
    },
  );

  it("takes the engine's operators and punctuation as text, never failing", async () => {
    const user = await signIn();
    const id = await add(user, 'https://ops.example/');
    await patch(user, id, { title: 'not queues' });
    expect(await foundIds(user, 'NOT queues')).toEqual([id]);
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const atoms = [...'abcxyz019 "*():-^'.split(''), ' AND ', ' OR ', ' NOT ', ' NEAR ', 'NEAR('];
    for (let i = 0; i < 500; i++) {
      let q = '';
      const length = Math.floor(random() * 60);
      while (q.length < length) q += atoms[Math.floor(random() * atoms.length)];
      q = q.slice(0, 200);
      const r = await search(user, q);
      expect([200, 400], q).toContain(r.status);
      if (r.status === 400) expect(r.json.error, q).toBe('invalid_filter');
    }
  });
});

describe('search over 10,000 links', () => {
  it('answers within 500 ms at the 95th percentile', { timeout: 600_000 }, async () => {
    const user = await signIn();
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]!;
    const vocabulary = Array.from({ length: 300 }, (_, i) => `term${i}x`);
    const common = ['cloud', 'design', 'history', 'notes', 'guide', 'review', 'python', 'garden'];
    const sentence = () =>
      Array.from({ length: 12 }, () => pick(random() < 0.3 ? common : vocabulary)).join(' ');

    const topics = Array.from({ length: 40 }, (_, i) => ({
      id: crypto.randomUUID(),
      name: `Topic ${i}`,
    }));
    const tags = vocabulary.map((name) => ({ id: crypto.randomUUID(), name }));
    await env.DB.batch([
      ...topics.map((t) =>
        env.DB.prepare('INSERT INTO topics (id, user_id, name) VALUES (?, ?, ?)').bind(
          t.id,
          user.id,
          t.name,
        ),
      ),
      ...tags.map((t) =>
        env.DB.prepare('INSERT INTO tags (id, user_id, name) VALUES (?, ?, ?)').bind(
          t.id,
          user.id,
          t.name,
        ),
      ),
    ]);
    const ids: string[] = [];
    for (let start = 0; start < 10_000; start += 250) {
      const statements: D1PreparedStatement[] = [];
      for (let i = start; i < start + 250; i++) {
        const id = crypto.randomUUID();
        ids.push(id);
        const host = `site${i % 500}.example`;
        const at = new Date(Date.parse('2026-01-01T00:00:00.000Z') + i * 60_000).toISOString();
        statements.push(
          env.DB.prepare(
            `INSERT INTO links (id, user_id, url, original_url, host, title, summary, topic_id, note,
               state, added_at, last_used_at, pin_position, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            id,
            user.id,
            `https://${host}/p${i}`,
            `https://${host}/p${i}`,
            host,
            sentence(),
            sentence(),
            pick(topics).id,
            i % 10 === 0 ? sentence() : '',
            i % 7 === 0 ? 'archived' : 'active',
            at,
            at,
            i < 20 ? i + 1 : null,
            at,
          ),
        );
        const three = new Set([pick(tags), pick(tags), pick(tags)]);
        [...three].forEach((tag, position) =>
          statements.push(
            env.DB.prepare(
              'INSERT INTO link_tags (link_id, tag_id, position) VALUES (?, ?, ?)',
            ).bind(id, tag.id, position),
          ),
        );
      }
      await env.DB.batch(statements);
    }
    for (let start = 0; start < 2_000; start += 50) {
      const statements: D1PreparedStatement[] = [];
      for (let i = start; i < start + 50; i++) {
        const length = 2_000 + Math.floor(random() * 18_000);
        let text = '';
        while (text.length < length) text += `${sentence()}. `;
        const id = ids[i * 5]!;
        statements.push(
          env.DB.prepare('INSERT INTO link_texts (link_id, user_id, text) VALUES (?, ?, ?)').bind(
            id,
            user.id,
            text,
          ),
          indexReaderTextStatement(env.DB, id, text),
        );
      }
      await env.DB.batch(statements);
    }

    const queries = [
      () => pick(common),
      () => `${pick(common)} ${pick(vocabulary)}`,
      () => pick(vocabulary),
      () => `${pick(common)} tag:${pick(vocabulary)}`,
      () => `${pick(common)} state:any`,
      () => `${pick(common)} is:pinned`,
      () => `${pick(common)} host:site${Math.floor(random() * 500)}.example`,
    ];
    const durations: number[] = [];
    for (let i = 0; i < 100; i++) {
      const q = queries[i % queries.length]!();
      const started = performance.now();
      const r = await search(user, q);
      durations.push(performance.now() - started);
      expect(r.status, q).toBe(200);
    }
    durations.sort((a, b) => a - b);
    const p95 = durations[94]!;
    expect(p95).toBeLessThanOrEqual(500);
  });
});

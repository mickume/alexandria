import { describe, expect, it } from 'vitest';
import {
  api,
  count,
  env,
  deliverEnrichments,
  deliverFetches,
  recordEnrichQueue,
  recordFetchQueue,
  seedLinks,
  setNow,
  signIn,
  type SentMessage,
  type TestUser,
} from '../test/helpers';
import type { FetchMessage } from '../env';
import { FakeAi } from '../test/ai';
import { FakeOrigin } from '../test/origin';
import { blogArticle } from '../fetcher/fixtures/pages';
import { sendThrottled } from '../enrich/throttle';
import { dispatchImports } from './dispatch';
import { parseImportFile } from './parse';

const encode = (text: string) => new TextEncoder().encode(text);

/** Uploads `file` as a text/plain body (or with another declared type). */
function upload(user: TestUser, file: string | Uint8Array, type: string | null = 'text/plain') {
  return api('POST', '/api/v1/imports', {
    as: user.session,
    body: typeof file === 'string' ? encode(file) : file,
    headers: type ? { 'Content-Type': type } : {},
  });
}

/** Uploads `file` as the part 'file' of a multipart form. */
function uploadForm(
  user: TestUser,
  file: string | Uint8Array | null,
  type = 'text/plain',
  name = 'links.txt',
) {
  const form = new FormData();
  if (file !== null) form.append('file', new File([file as BlobPart], name, { type }));
  return api('POST', '/api/v1/imports', { as: user.session, body: form });
}

async function counts(user: TestUser) {
  return {
    links: await count('links', 'user_id = ?', user.id),
    imports: await count('imports', 'user_id = ?', user.id),
  };
}

async function linkByUrl(user: TestUser, url: string) {
  return env.DB.prepare('SELECT * FROM links WHERE user_id = ? AND url = ?')
    .bind(user.id, url)
    .first<Record<string, unknown>>();
}

describe('parseImportFile', () => {
  it.each([
    [
      'https://a.example\nhttps://b.example',
      [
        { line: 1, url: 'https://a.example' },
        { line: 2, url: 'https://b.example' },
      ],
    ],
    [
      '﻿https://a.example\r\n\r\n# notes\r\n   # indented comment\r\nhttps://b.example some note here',
      [
        { line: 1, url: 'https://a.example' },
        { line: 5, url: 'https://b.example' },
      ],
    ],
    ['  https://c.example\tx', [{ line: 1, url: 'https://c.example' }]],
    ['https://d.example\n', [{ line: 1, url: 'https://d.example' }]],
    [
      'Reading list\nnot a url\nexample.com\nftp://e.example\nsee https://f.example/x here',
      [{ line: 5, url: 'https://f.example/x' }],
    ],
    [
      [
        '<p align="center">My links</p>',
        '## Rust',
        'The [book](https://rust.example/book "The Book"), read it.',
        '- <https://a.example/x>, see also',
        '* **HTTPS://b.example/p_(q)**',
        '> Quote: https://c.example/q?x=1.',
        '| [y](https://d.example/y) | https://e.example/ |',
        '`http://f.example/code`',
      ].join('\n'),
      [
        { line: 3, url: 'https://rust.example/book' },
        { line: 4, url: 'https://a.example/x' },
        { line: 5, url: 'HTTPS://b.example/p_(q)' },
        { line: 6, url: 'https://c.example/q?x=1' },
        { line: 7, url: 'https://d.example/y' },
        { line: 8, url: 'http://f.example/code' },
      ],
    ],
  ])('reads %j', (text, lines) => {
    expect(parseImportFile(encode(text), 'text/plain')).toEqual({ ok: true, lines });
  });

  it.each([
    [null, null],
    ['text/plain; charset=utf-8', null],
    ['text/markdown', null],
    ['text/x-markdown', null],
    ['application/octet-stream', 'links.md'],
    ['application/octet-stream', 'LINKS.TXT'],
  ])('accepts the type %s with the name %s', (type, name) => {
    expect(parseImportFile(encode('https://a.example'), type, name)).toMatchObject({ ok: true });
  });
});

describe('POST /api/v1/imports refuses', () => {
  const UNSUPPORTED = {
    error: 'unsupported_file',
    field: 'file',
    message: 'only text or Markdown files (.txt, .md) are accepted',
  };

  const unsupported: [string, () => string | Uint8Array, string, boolean][] = [
    ['an HTML file', () => '<!doctype html><a href="https://a.example">a</a>', 'text/html', false],
    ['a JSON file', () => '["https://a.example"]', 'application/json', false],
    ['a part of type image/png', () => 'https://a.example', 'image/png', true],
    ['bytes that are not UTF-8', () => new Uint8Array([0xc3, 0x28]), 'text/plain', false],
    ['a NUL byte', () => 'https://a.example\u0000', 'text/plain', false],
  ];

  it.each(unsupported)('%s', async (_case, file, type, multipart) => {
    const user = await signIn();
    const before = await counts(user);
    const r = multipart
      ? await uploadForm(user, file(), type, 'cat.png')
      : await upload(user, file(), type);
    expect(r.status).toBe(400);
    expect(r.json).toEqual(UNSUPPORTED);
    expect(await counts(user)).toEqual(before);
  });

  describe('a file over the limits', () => {
    const TOO_LARGE = {
      error: 'import_too_large',
      message: 'too large: at most 5,000 URLs / 2 MB per import',
    };
    const urls = (n: number) =>
      Array.from({ length: n }, (_, i) => `https://l${i}.example/`).join('\n');
    const padded = (bytes: number) => {
      const head = 'https://only.example/\n';
      const comment = '# '.padEnd(99, 'x') + '\n';
      let body = head;
      while (body.length + comment.length <= bytes) body += comment;
      return body + '#'.repeat(bytes - body.length);
    };

    it.each([
      ['2,097,153 bytes', () => padded(2_097_153), 409],
      ['5,001 URL lines', () => urls(5_001), 409],
      [
        '5,000 URL lines with comments and blank lines',
        () => `# list\n\n${urls(5_000)}\n${'# c\n\n'.repeat(150)}`,
        201,
      ],
      ['exactly 2,097,152 bytes', () => padded(2_097_152), 201],
    ] as const)('%s', { timeout: 120_000 }, async (_case, file, status) => {
      const user = await signIn();
      const before = await counts(user);
      const text = file();
      const r = await upload(user, text);
      expect(r.status).toBe(status);
      if (status === 409) {
        expect(r.json).toEqual(TOO_LARGE);
        expect(await counts(user)).toEqual(before);
      }
    });
  });

  it.each(['', '\n\n', '# only a comment\n', '# https://a.example\nnot a url\nexample.com\n'])(
    'a file without a URL line: %j',
    async (text) => {
      const user = await signIn();
      const before = await counts(user);
      const r = await upload(user, text);
      expect(r.status).toBe(400);
      expect(r.json).toMatchObject({ error: 'no_urls', field: 'file' });
      expect(await counts(user)).toEqual(before);
    },
  );

  it('a form without a file part', async () => {
    const user = await signIn();
    const r = await uploadForm(user, null);
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: 'no_urls', field: 'file' });
  });
});

describe('POST /api/v1/imports adds', () => {
  it.each(['text/plain body', 'multipart form'])(
    'every new URL of a %s as a pending link, and keeps the report',
    async (form) => {
      const user = await signIn();
      setNow('2026-11-07T10:00:00.000Z');
      const file = 'https://a.example/x?utm_source=y\nhttps://b.example';
      const r = form === 'multipart form' ? await uploadForm(user, file) : await upload(user, file);
      expect(r.status).toBe(201);
      expect(r.json.counts).toEqual({
        url_lines: 2,
        added: 2,
        duplicates: 0,
        invalid: 0,
        not_imported: 0,
      });
      expect(r.json.stopped_at_limit).toBeNull();
      expect(r.json.created_at).toBe('2026-11-07T10:00:00.000Z');
      const a = await linkByUrl(user, 'https://a.example/x');
      expect(a).toMatchObject({
        original_url: 'https://a.example/x?utm_source=y',
        state: 'pending',
        title: 'a.example',
      });
      expect(await linkByUrl(user, 'https://b.example')).toMatchObject({ state: 'pending' });
      const again = await api('GET', `/api/v1/imports/${r.json.id}`, { as: user.session });
      expect(again.status).toBe(200);
      expect(again.json).toMatchObject({
        id: r.json.id,
        created_at: r.json.created_at,
        counts: r.json.counts,
        invalid: [],
        duplicates: [],
        stopped_at_limit: null,
      });
    },
  );

  it('reports duplicates of the library and of earlier lines, boosting nothing', async () => {
    const user = await signIn();
    const other = await signIn('other@example.test');
    await seedLinks(user, [
      { url: 'https://c.example', lastUsedAt: '2026-01-01T00:00:00.000Z', useCount: 2 },
    ]);
    await seedLinks(other, [{ url: 'https://d.example' }]);
    const r = await upload(
      user,
      'https://c.example/\nhttps://d.example\nhttps://D.example#x\nhttps://c.example?utm_medium=m',
    );
    expect(r.status).toBe(201);
    expect(r.json.counts).toMatchObject({ added: 1, duplicates: 3 });
    expect(r.json.duplicates).toEqual([
      { line: 1, url: 'https://c.example' },
      { line: 3, url: 'https://d.example' },
      { line: 4, url: 'https://c.example' },
    ]);
    expect(await linkByUrl(user, 'https://c.example')).toMatchObject({
      last_used_at: '2026-01-01T00:00:00.000Z',
      use_count: 2,
    });
  });

  it('reports invalid addresses with their line numbers, ignoring lines without one', async () => {
    const user = await signIn();
    const r = await upload(
      user,
      'https://a.example\nnot-a-url\njavascript:alert(1)\nhttp://localhost/x\nhttps://\nhttps://b.example',
    );
    expect(r.json.counts).toMatchObject({ url_lines: 4, invalid: 2, added: 2 });
    expect(r.json.invalid).toEqual([
      { line: 4, text: 'http://localhost/x' },
      { line: 5, text: 'https://' },
    ]);
    expect(await count('links', 'user_id = ?', user.id)).toBe(2);
  });

  it('takes a Markdown file named .md whatever its declared type', async () => {
    const user = await signIn();
    const r = await uploadForm(
      user,
      '# Links\n\n- [A](https://a.example/)\n- [B](https://b.example/page)\n',
      'application/octet-stream',
      'links.md',
    );
    expect(r.status).toBe(201);
    expect(r.json.counts).toMatchObject({ url_lines: 2, added: 2 });
    expect(await linkByUrl(user, 'https://b.example/page')).not.toBeNull();
  });

  it('puts the added links in file order at the top of the stream', async () => {
    const user = await signIn();
    const t = Date.parse('2026-11-07T10:00:00.000Z');
    const [older] = await seedLinks(user, [
      { url: 'https://older.example', lastUsedAt: new Date(t - 86_400_000).toISOString() },
    ]);
    setNow(t);
    await upload(user, 'https://z.example\nhttps://a.example\nhttps://m.example');
    const rows = await Promise.all(
      ['https://z.example', 'https://a.example', 'https://m.example'].map((u) =>
        linkByUrl(user, u),
      ),
    );
    expect(rows.map((r) => r!.last_used_at)).toEqual([
      new Date(t).toISOString(),
      new Date(t - 1).toISOString(),
      new Date(t - 2).toISOString(),
    ]);
    expect(rows.every((r) => r!.added_at === new Date(t).toISOString())).toBe(true);
    const stream = await api('GET', '/api/v1/links', { as: user.session });
    expect(stream.json.items.map((l: { host: string }) => l.host)).toEqual([
      'z.example',
      'a.example',
      'm.example',
      'older.example',
    ]);
    expect(stream.json.items.at(-1).id).toBe(older);
  });

  it('stays above a link used a moment before the import', async () => {
    const user = await signIn();
    const t = Date.parse('2026-11-07T10:00:00.000Z');
    await seedLinks(user, [
      { url: 'https://recent.example', lastUsedAt: new Date(t - 1).toISOString() },
    ]);
    setNow(t);
    await upload(user, 'https://z.example\nhttps://a.example\nhttps://m.example');
    const stream = await api('GET', '/api/v1/links', { as: user.session });
    expect(stream.json.items.map((l: { host: string }) => l.host)).toEqual([
      'z.example',
      'a.example',
      'm.example',
      'recent.example',
    ]);
  });

  it('stops at the library limit and says on which line', { timeout: 120_000 }, async () => {
    const user = await signIn();
    await seedLinks(
      user,
      Array.from({ length: 19_998 }, (_, i) => ({ url: `https://seed${i}.example` })),
    );
    const existing = 'https://seed0.example';
    const r = await upload(
      user,
      `https://n1.example\n${existing}\nhttps://n2.example\nhttps://n3.example\nhttps://n4.example`,
    );
    expect(r.status).toBe(201);
    expect(r.json.counts).toEqual({
      url_lines: 5,
      added: 2,
      duplicates: 1,
      invalid: 0,
      not_imported: 2,
    });
    expect(r.json.stopped_at_limit).toEqual({ line: 4 });
    expect(await count('links', 'user_id = ?', user.id)).toBe(20_000);

    const full = await upload(user, `# full\n${existing}\nhttps://n9.example\nhttps://n10.example`);
    expect(full.json.counts).toEqual({
      url_lines: 3,
      added: 0,
      duplicates: 1,
      invalid: 0,
      not_imported: 2,
    });
    expect(full.json.stopped_at_limit).toEqual({ line: 3 });
  });

  it('accounts for every URL line exactly once', { timeout: 300_000 }, async () => {
    let seed = 11;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const user = await signIn();
    const known = Array.from({ length: 40 }, (_, i) => `https://known${i}.example`);
    await seedLinks(
      user,
      known.map((url) => ({ url })),
    );
    for (let file = 0; file < 50; file++) {
      if (file === 25) {
        // The second half runs near the limit.
        const have = await count('links', 'user_id = ?', user.id);
        await seedLinks(
          user,
          Array.from({ length: 19_900 - have }, (_, i) => ({ url: `https://fill${i}.example` })),
        );
      }
      const lines = Array.from({ length: 1 + Math.floor(random() * 300) }, (_, i) => {
        const kind = Math.floor(random() * 7);
        const n = Math.floor(random() * 400);
        if (kind === 0) return `https://new${file}-${i}.example/page`;
        if (kind === 1) return known[n % known.length]!;
        if (kind === 2) return `HTTPS://Repeat${n % 20}.example/#frag`;
        if (kind === 3) return `https://repeat${n % 20}.example/?utm_source=x`;
        if (kind === 4) return ['not a url', 'ftp://x.example', 'http://10.0.0.1/', '::'][n % 4]!;
        if (kind === 5) return '# a comment';
        return '';
      });
      if (!lines.some((l) => /^https?:\/\//i.test(l))) lines.push('https://one.example/');
      const before = await count('links', 'user_id = ?', user.id);
      const r = await upload(user, lines.join('\n'));
      expect(r.status).toBe(201);
      const c = r.json.counts;
      expect(c.added + c.duplicates + c.invalid + c.not_imported).toBe(c.url_lines);
      expect(await count('links', 'user_id = ?', user.id)).toBe(before + c.added);
    }
  });
});

/** The import's links by line, and the line of each link. */
async function linesOf(importId: string) {
  const rows = await env.DB.prepare(
    'SELECT link_id, line FROM import_links WHERE import_id = ? ORDER BY line',
  )
    .bind(importId)
    .all<{ link_id: string; line: number }>();
  return {
    link: (line: number) => rows.results.find((r) => r.line === line)!.link_id,
    line: (linkId: string) => rows.results.find((r) => r.link_id === linkId)?.line,
  };
}

const urls = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `https://${prefix}${i + 1}.example/`).join('\n');

/** Runs the dispatcher for `user` at time `at` and returns the links it sent. */
async function dispatchAt(sent: SentMessage<FetchMessage>[], user: TestUser, at: number) {
  setNow(at);
  const before = sent.length;
  await dispatchImports(env, user.id);
  return sent.slice(before).map((m) => m.body.link_id);
}

describe('dispatching imported links', () => {
  const t = Date.parse('2026-11-07T10:00:00.000Z');

  it('sends them in file order, at most 20 a minute', async () => {
    const user = await signIn();
    const sent = recordFetchQueue();
    setNow(t);
    const r = await upload(user, urls('d', 45));
    const at = (n: number) => sent.slice(0, n).map((m) => m.body.link_id);
    const byUpload = at(sent.length);
    const runs = [
      byUpload,
      await dispatchAt(sent, user, t),
      await dispatchAt(sent, user, t + 30_000),
      await dispatchAt(sent, user, t + 60_000),
      await dispatchAt(sent, user, t + 120_000),
    ];
    const { line } = await linesOf(r.json.id);
    const lines = runs.map((ids) => ids.map((id) => line(id)));
    const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    expect(lines).toEqual([range(1, 20), [], [], range(21, 40), range(41, 45)]);
    expect(sent.every((m) => m.body.user_id === user.id && !m.delaySeconds)).toBe(true);
  });

  it.each([
    {
      case: 'two imports of one user',
      setup: async (a: TestUser) => {
        const first = await upload(a, urls('first', 15));
        await upload(a, urls('second', 15));
        return first.json.id as string;
      },
    },
    {
      case: "an import while 'enrich all' has 15 waiting",
      setup: async (a: TestUser) => {
        const ids = await seedLinks(
          a,
          Array.from({ length: 15 }, (_, i) => ({ url: `https://enrich${i}.example` })),
        );
        await sendThrottled(env, a.id, ids);
        await upload(a, urls('after', 15));
        return null;
      },
    },
  ])('shares one budget: $case', async ({ case: name, setup }) => {
    const a = await signIn();
    const b = await signIn('other@example.test');
    const sent = recordFetchQueue();
    setNow(t);
    const firstImport = await setup(a);
    await upload(b, urls('b', 20));
    for (const offset of [0, 20_000, 40_000, 59_999]) await dispatchAt(sent, a, t + offset);
    const ofA = sent.filter((m) => m.body.user_id === a.id).map((m) => m.body.link_id);
    const ofB = sent.filter((m) => m.body.user_id === b.id);
    expect(ofB).toHaveLength(20);
    if (name === 'two imports of one user') {
      expect(ofA).toHaveLength(20);
      const { line } = await linesOf(firstImport!);
      expect(ofA.slice(0, 15).map((id) => line(id))).toEqual(
        Array.from({ length: 15 }, (_, i) => i + 1),
      );
      expect(ofA.slice(15).every((id) => line(id) === undefined)).toBe(true);
    } else {
      // 15 enrichment slots fall in this minute: at most 5 are left for the import.
      expect(ofA.length).toBeLessThanOrEqual(5);
      await dispatchAt(sent, a, t + 120_000);
      expect(sent.filter((m) => m.body.user_id === a.id).length).toBe(15);
    }
  });

  it("starts 'enrich all' after the minute an import's links took", async () => {
    const user = await signIn();
    recordFetchQueue();
    setNow(t);
    await upload(user, urls('x', 20));
    const ids = await seedLinks(user, [{ url: 'https://later.example' }]);
    const enrich = (await import('../test/helpers')).recordEnrichQueue();
    setNow(t + 10_000);
    await sendThrottled(env, user.id, ids);
    expect(enrich[0]!.body.slot).toBe(t + 60_000);
  });

  it('skips a deleted link and one already sent, without using the budget', async () => {
    const user = await signIn();
    const sent = recordFetchQueue();
    setNow(t);
    // The import is made while another import holds the minute's budget.
    const blocker = await upload(user, urls('block', 20));
    expect(sent).toHaveLength(20);
    const r = await upload(user, urls('s', 21));
    expect(sent).toHaveLength(20);
    const { link } = await linesOf(r.json.id);
    expect((await api('DELETE', `/api/v1/links/${link(3)}`, { as: user.session })).status).toBe(
      204,
    );
    const refreshed = await api('POST', `/api/v1/links/${link(4)}/refresh`, { as: user.session });
    expect(refreshed.status).toBe(202);
    expect(sent.at(-1)!.body).toMatchObject({ link_id: link(4), refresh: true });
    expect(blocker.status).toBe(201);

    const run = await dispatchAt(sent, user, t + 60_000);
    expect(run).toEqual([1, 2, ...Array.from({ length: 17 }, (_, i) => i + 5)].map(link));
    expect(sent.filter((m) => m.body.link_id === link(4))).toHaveLength(1);

    setNow(t + 70_000);
    const more = await upload(user, urls('m', 25));
    const next = await linesOf(more.json.id);
    await api('DELETE', `/api/v1/links/${next.link(1)}`, { as: user.session });
    const nextRun = await dispatchAt(sent, user, t + 120_000);
    expect(nextRun).toEqual(Array.from({ length: 20 }, (_, i) => next.link(i + 2)));
  });

  it('sends a pasted link at once, outside the budget', async () => {
    const user = await signIn();
    const sent = recordFetchQueue();
    setNow(t);
    await upload(user, urls('p', 100));
    expect(sent).toHaveLength(20);
    const pasted = await api('POST', '/api/v1/links', {
      as: user.session,
      body: { url: 'https://pasted.example' },
    });
    expect(sent.at(-1)!.body.link_id).toBe(pasted.json.link.id);
    expect(await dispatchAt(sent, user, t + 30_000)).toEqual([]);
    expect(await dispatchAt(sent, user, t + 60_000)).toHaveLength(20);
  });

  it('runs every minute for every user with links waiting', async () => {
    const a = await signIn();
    const b = await signIn('other@example.test');
    const sent = recordFetchQueue();
    setNow(t);
    await upload(a, urls('a', 30));
    await upload(b, urls('b', 30));
    expect(sent).toHaveLength(40);
    setNow(t + 60_000);
    const { default: worker } = await import('../index');
    const { createExecutionContext, waitOnExecutionContext } = await import('cloudflare:test');
    const ctx = createExecutionContext();
    await worker.scheduled!(
      { cron: '* * * * *', scheduledTime: t + 60_000, noRetry() {} } as ScheduledController,
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(sent).toHaveLength(60);
  });
});

describe('an import’s progress and report', () => {
  it('counts the links waiting, in progress, done and enriched', async () => {
    const user = await signIn();
    new FakeAi();
    const key = await api('PUT', '/api/v1/settings/ai', {
      as: user.session,
      body: { provider: 'anthropic', api_key: 'sk-ant-abcd1234' },
    });
    expect(key.status).toBe(200);
    const origin = new FakeOrigin();
    for (let i = 1; i <= 30; i++) origin.page(`https://pr${i}.example/`, blogArticle);
    const fetches = recordFetchQueue();
    const r = await upload(user, urls('pr', 30));
    expect(fetches).toHaveLength(20);
    const enrichments = recordEnrichQueue();
    await deliverFetches(fetches.slice(0, 5).map((m) => m.body));
    expect(enrichments).toHaveLength(5);
    await deliverEnrichments(enrichments.slice(0, 3).map((m) => m.body));
    const progress = await api('GET', `/api/v1/imports/${r.json.id}`, { as: user.session });
    expect(progress.status).toBe(200);
    expect(progress.json.counts.added).toBe(30);
    expect(progress.json.progress).toEqual({ waiting: 10, in_progress: 15, done: 5, enriched: 3 });
  });

  it('serves the report as a plain-text file', async () => {
    const user = await signIn();
    await seedLinks(user, [{ url: 'https://a.example' }]);
    setNow('2026-11-07T10:00:00.000Z');
    const file = [
      'https://n1.example',
      'https://n2.example',
      'http://localhost/x',
      'https://n3.example',
      'https://a.example',
      'https://n4.example',
      'https://nope',
      'https://n5.example',
      'https://n6.example',
      'https://n7.example',
    ].join('\n');
    const r = await upload(user, file);
    const report = await api('GET', `/api/v1/imports/${r.json.id}/report`, { as: user.session });
    expect(report.status).toBe(200);
    expect(report.headers.get('Content-Type')).toMatch(/^text\/plain/);
    expect(report.headers.get('Content-Disposition')).toBe(
      'attachment; filename="alexandria-import-2026-11-07.txt"',
    );
    const text = await report.response.text();
    for (const expected of [
      'added: 7',
      'duplicates: 1',
      'invalid: 2',
      'line 3: http://localhost/x',
      'line 7: https://nope',
      'line 5: duplicate of https://a.example',
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain('library full');
  });

  it('says in the report where the library limit stopped the import', async () => {
    const user = await signIn();
    await seedLinks(
      user,
      Array.from({ length: 19_999 }, (_, i) => ({ url: `https://seed${i}.example` })),
    );
    const r = await upload(user, 'https://x1.example\nhttps://x2.example\nhttps://x3.example');
    const report = await api('GET', `/api/v1/imports/${r.json.id}/report`, { as: user.session });
    expect(await report.response.text()).toContain(
      'library full (20,000 links): stopped at line 2, 2 lines not imported',
    );
  });

  it.each(['/', '/report'])(
    'answers 404 for an import that is not the user’s: %s',
    async (suffix) => {
      const a = await signIn();
      const b = await signIn('other@example.test');
      const theirs = await upload(b, 'https://b.example');
      for (const id of [theirs.json.id, 'no-such-import']) {
        const r = await api('GET', `/api/v1/imports/${id}${suffix === '/' ? '' : suffix}`, {
          as: a.session,
        });
        expect(r.status).toBe(404);
        expect(r.json).toEqual({ error: 'not_found' });
      }
    },
  );
});

describe('importing into a workspace', () => {
  /** A workspace of `user` named `name`, holding the links of `urls` in order. */
  async function workspaceWith(user: TestUser, name: string, urls: string[] = []) {
    const created = await api('POST', '/api/v1/workspaces', { as: user.session, body: { name } });
    const id = created.json.id as string;
    for (const url of urls) {
      const link = await linkByUrl(user, url);
      await api('POST', `/api/v1/workspaces/${id}/links`, {
        as: user.session,
        body: { link_id: link!.id },
      });
    }
    return id;
  }

  async function memberUrls(user: TestUser, workspaceId: string) {
    const r = await api('GET', `/api/v1/workspaces/${workspaceId}/links`, { as: user.session });
    return (r.json.items as { url: string }[]).map((m) => m.url);
  }

  it.each(['form part', 'query parameter'])(
    'adds every link of the file in file order, leaving members where they are (%s)',
    async (how) => {
      const user = await signIn();
      await seedLinks(user, [{ url: 'https://kept.example' }, { url: 'https://member.example' }]);
      const id = await workspaceWith(user, 'Trip', ['https://member.example']);
      const file = [
        'https://new-a.example',
        'https://kept.example',
        'http://10.0.0.1/',
        'https://member.example',
        'https://new-b.example',
        'https://new-a.example',
      ].join('\n');
      let r;
      if (how === 'form part') {
        const form = new FormData();
        form.append('file', new File([file], 'links.txt', { type: 'text/plain' }));
        form.append('workspace_id', id);
        r = await api('POST', '/api/v1/imports', { as: user.session, body: form });
      } else {
        r = await api('POST', `/api/v1/imports?workspace_id=${id}`, {
          as: user.session,
          body: encode(file),
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      expect(r.status).toBe(201);
      const workspace = { id, name: 'Trip', added: 3 };
      expect(r.json).toMatchObject({ counts: { added: 2, duplicates: 3, invalid: 1 }, workspace });
      expect(await memberUrls(user, id)).toEqual([
        'https://member.example',
        'https://new-a.example',
        'https://kept.example',
        'https://new-b.example',
      ]);
      const again = await api('GET', `/api/v1/imports/${r.json.id}`, { as: user.session });
      expect(again.json.workspace).toEqual(workspace);
      const text = await (
        await api('GET', `/api/v1/imports/${r.json.id}/report`, { as: user.session })
      ).response.text();
      expect(text).toContain('workspace: Trip (3 links added to it)');
    },
  );

  it('refuses a workspace that is not the user’s, importing nothing', async () => {
    const user = await signIn();
    const other = await signIn('other@example.test');
    const theirs = await workspaceWith(other, 'Theirs');
    for (const id of [theirs, 'no-such-workspace']) {
      const r = await api('POST', `/api/v1/imports?workspace_id=${id}`, {
        as: user.session,
        body: encode('https://a.example'),
        headers: { 'Content-Type': 'text/plain' },
      });
      expect(r).toMatchObject({
        status: 400,
        json: { error: 'unknown_workspace', field: 'workspace_id' },
      });
    }
    expect(await counts(user)).toEqual({ links: 0, imports: 0 });
  });

  it('reports no workspace once the workspace is deleted, or when none was chosen', async () => {
    const user = await signIn();
    const id = await workspaceWith(user, 'Gone');
    const into = await api('POST', `/api/v1/imports?workspace_id=${id}`, {
      as: user.session,
      body: encode('https://a.example'),
      headers: { 'Content-Type': 'text/plain' },
    });
    const plain = await upload(user, 'https://b.example');
    expect(plain.json.workspace).toBeNull();
    await api('DELETE', `/api/v1/workspaces/${id}`, { as: user.session });
    const again = await api('GET', `/api/v1/imports/${into.json.id}`, { as: user.session });
    expect(again.json.workspace).toBeNull();
  });
});

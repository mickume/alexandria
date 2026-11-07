import { describe, expect, it } from 'vitest';
import {
  api,
  count,
  env,
  recordFetchQueue,
  seedLinks,
  setNow,
  signIn,
  type SentMessage,
  type TestUser,
} from '../test/helpers';
import type { FetchMessage } from '../env';
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
function uploadForm(user: TestUser, file: string | Uint8Array | null, type = 'text/plain') {
  const form = new FormData();
  if (file !== null) form.append('file', new File([file], 'links.txt', { type }));
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
  ])('reads %j', (text, lines) => {
    expect(parseImportFile(encode(text), 'text/plain')).toEqual({ ok: true, lines });
  });

  it('accepts an absent type and text/plain with a charset', () => {
    expect(parseImportFile(encode('https://a.example'), null)).toMatchObject({ ok: true });
    expect(parseImportFile(encode('https://a.example'), 'text/plain; charset=utf-8')).toMatchObject(
      { ok: true },
    );
  });
});

describe('POST /api/v1/imports refuses', () => {
  const UNSUPPORTED = {
    error: 'unsupported_file',
    field: 'file',
    message: 'only plain-text files with one URL per line are accepted',
  };

  it.each([
    ['an HTML file', () => '<!doctype html><a href="https://a.example">a</a>', 'text/html', false],
    ['HTML declared as text', () => '<html><body>', 'text/plain', false],
    ['XML declared as text', () => '<?xml version="1.0"?>', 'text/plain', false],
    ['a JSON file', () => '["https://a.example"]', 'application/json', false],
    ['a JSON object declared as text', () => '{"urls": []}', 'text/plain', false],
    ['a part of type image/png', () => 'https://a.example', 'image/png', true],
    ['bytes that are not UTF-8', () => new Uint8Array([0xc3, 0x28]), 'text/plain', false],
    ['a NUL byte', () => 'https://a.example\u0000', 'text/plain', false],
  ] as const)('%s', async (_case, file, type, multipart) => {
    const user = await signIn();
    const before = await counts(user);
    const r = multipart ? await uploadForm(user, file(), type) : await upload(user, file(), type);
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

  it.each(['', '\n\n', '# only a comment\n'])('a file without a URL line: %j', async (text) => {
    const user = await signIn();
    const before = await counts(user);
    const r = await upload(user, text);
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: 'no_urls', field: 'file' });
    expect(await counts(user)).toEqual(before);
  });

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

  it('reports invalid lines with their numbers and text', async () => {
    const user = await signIn();
    const r = await upload(
      user,
      'https://a.example\nnot-a-url\njavascript:alert(1)\nhttp://localhost/x\nhttps://b.example',
    );
    expect(r.json.counts).toMatchObject({ invalid: 3, added: 2 });
    expect(r.json.invalid).toEqual([
      { line: 2, text: 'not-a-url' },
      { line: 3, text: 'javascript:alert(1)' },
      { line: 4, text: 'http://localhost/x' },
    ]);
    expect(await count('links', 'user_id = ?', user.id)).toBe(2);
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
      if (!lines.some((l) => l && !l.startsWith('#'))) lines.push('https://one.example/');
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

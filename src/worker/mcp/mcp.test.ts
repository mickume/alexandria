import { describe, expect, it, vi } from 'vitest';
import {
  api,
  count,
  createToken,
  deliverIndexing,
  env,
  mcp,
  mcpTool,
  ORIGIN,
  seedLinks,
  setNow,
  signIn,
  type TestUser,
} from '../test/helpers';
import { indexReaderText } from '../search/search';
import { ARTICLES, meaning, seedArticle } from '../test/meaning';
import { readerKey, snapshotKey } from '../fetcher/snapshots';

/** A signed-in user with a personal access token. */
async function agent(email = 'owner@example.test'): Promise<TestUser & { secret: string }> {
  const user = await signIn(email);
  const { secret } = await createToken(user);
  return { ...user, secret };
}

const TOOLS = [
  'add_link',
  'add_to_workspace',
  'archive_link',
  'get_link',
  'get_link_content',
  'list_recent',
  'list_workspaces',
  'pin_link',
  'search_links',
  'search_passages',
];

describe('the MCP endpoint', () => {
  it('initializes as the token’s user with its instructions', async () => {
    const t = '2026-11-07T10:00:00.000Z';
    setNow(t);
    const a = await agent();
    const r = await mcp(a.secret, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toMatch(/^application\/json/);
    expect(r.json.result.serverInfo.name).toBe('alexandria');
    expect(r.json.result.capabilities.tools).toBeTruthy();
    const instructions: string = r.json.result.instructions;
    expect(instructions).toMatch(/private library of web links/);
    expect(instructions.indexOf('search_links')).toBeLessThan(instructions.indexOf('add_link'));
    expect(instructions).toMatch(/answer a question[^.]*use search_passages/);
    expect(instructions).toMatch(/use get_link_content to read a whole link/i);
    const tokens = await api('GET', '/api/v1/tokens', { as: a.session });
    expect(tokens.json.items[0].last_used_at).toBe(t);
  });

  it('lists exactly the ten tools with their arguments', async () => {
    const a = await agent();
    const r = await mcp(a.secret, 'tools/list', {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: { name: string; description: string; inputSchema: Record<string, any> }[] =
      r.json.result.tools;
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
    expect(tools.every((t) => t.description.length > 0)).toBe(true);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema]));
    expect(byName.add_link!.required).toEqual(['url']);
    expect(Object.keys(byName.add_link!.properties).sort()).toEqual(['tags', 'url', 'workspace']);
    expect(byName.get_link_content!.properties.format.enum).toEqual(['text', 'html']);
    expect(byName.get_link_content!.required.sort()).toEqual(['format', 'id']);
    for (const name of ['search_links', 'list_recent']) {
      expect(byName[name]!.properties.limit.type).toBe('integer');
      expect(byName[name]!.required ?? []).not.toContain('limit');
    }
    const described = tools.find((t) => t.name === 'search_links')!.description;
    expect(described).toMatch(/meaning/);
    expect(described).toMatch(/words/);
    expect(byName.search_passages!.required).toEqual(['query']);
    expect(byName.search_passages!.properties.limit).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 20,
    });
  });

  describe('refuses a request without a valid token', () => {
    it.each([
      ['no Authorization header', async () => ({ bearer: null, headers: {} })],
      ['an unknown secret', async () => ({ bearer: 'alx_unknown', headers: {} })],
      [
        'a revoked token',
        async () => {
          const user = await signIn();
          const token = await createToken(user);
          await api('DELETE', `/api/v1/tokens/${token.id}`, { as: user.session });
          return { bearer: token.secret, headers: {} };
        },
      ],
      [
        'a session cookie alone',
        async () => {
          const user = await signIn();
          return {
            bearer: null,
            headers: { Cookie: `alexandria_session=${user.session}`, Origin: ORIGIN },
          };
        },
      ],
    ] as const)('%s', async (_case, setup) => {
      const { bearer, headers } = await setup();
      const before = await count('links');
      const r = await mcp(
        bearer,
        'tools/call',
        { name: 'add_link', arguments: { url: 'https://example.net/' } },
        { headers },
      );
      expect(r.status).toBe(401);
      expect(r.json).toEqual({ error: 'unauthorized' });
      expect(r.headers.get('WWW-Authenticate')).toMatch(/^Bearer/);
      expect(await count('links')).toBe(before);
    });
  });

  it.each(['GET', 'DELETE'])('answers %s with 405', async (method) => {
    const a = await agent();
    const r = await mcp(a.secret, '', undefined, { method });
    expect(r.status).toBe(405);
    expect(r.headers.get('Allow')).toBe('POST');
  });

  it('counts each request once against the rate limit shared with the API', async () => {
    setNow('2026-11-07T10:00:05.000Z');
    const a = await agent();
    await seedLinks(a, [{ url: 'https://one.example' }]);
    for (let i = 0; i < 300; i++) {
      expect((await api('GET', '/api/v1/me', { bearer: a.secret })).status).toBe(200);
    }
    for (let i = 0; i < 300; i++) {
      const r = await mcpTool(a.secret, 'list_recent', {});
      expect(r.response.status).toBe(200);
      expect(r.isError).toBeFalsy();
    }
    const r = await mcp(a.secret, 'tools/call', { name: 'list_recent', arguments: {} });
    expect(r.status).toBe(429);
    expect(r.json).toEqual({ error: 'rate_limited' });
    const retry = Number(r.headers.get('Retry-After'));
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
  });

  it('answers an unexpected failure as a tool error and keeps answering', async () => {
    const a = await agent();
    await seedLinks(a, [{ url: 'https://one.example' }]);
    const prepare = env.DB.prepare.bind(env.DB);
    const spy = vi.spyOn(env.DB, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('FROM link_views l'))
        throw new Error('D1_ERROR: disk on fire at /secret/path');
      return prepare(sql);
    });
    const failed = await mcpTool(a.secret, 'list_recent', {});
    spy.mockRestore();
    expect(failed.response.status).toBe(200);
    expect(failed.response.json.error).toBeUndefined();
    expect(failed.isError).toBe(true);
    expect(failed.structuredContent).toEqual({
      error: 'internal_error',
      message: 'something went wrong, try again',
    });
    expect(JSON.stringify(failed)).not.toContain('disk on fire');
    const next = await mcpTool(a.secret, 'list_recent', {});
    expect(next.isError).toBeFalsy();
    expect(next.structuredContent.items).toHaveLength(1);
  });
});

async function linkCount(user: TestUser) {
  return count('links', 'user_id = ?', user.id);
}

/** Creates a workspace through the API and returns its id. */
async function createWorkspace(user: TestUser, name: string): Promise<string> {
  const r = await api('POST', '/api/v1/workspaces', { as: user.session, body: { name } });
  expect(r.status).toBe(201);
  return r.json.id;
}

async function workspaceLinks(user: TestUser, id: string): Promise<string[]> {
  const r = await api('GET', `/api/v1/workspaces/${id}/links`, { as: user.session });
  return r.json.items.map((l: { id: string }) => l.id);
}

describe('add_link', () => {
  it('adds a new link as POST /api/v1/links does', async () => {
    const a = await agent();
    const r = await mcpTool(a.secret, 'add_link', {
      url: 'https://example.net/paper?utm_source=x',
    });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.status).toBe('added');
    expect(r.structuredContent.link).toMatchObject({
      url: 'https://example.net/paper',
      state: 'pending',
      title: 'example.net',
    });
    expect(JSON.parse(r.content[0]!.text)).toEqual(r.structuredContent);
    const stream = await api('GET', '/api/v1/links', { as: a.session });
    expect(stream.json.items[0].id).toBe(r.structuredContent.link.id);
  });

  it('boosts a link already in the library', async () => {
    setNow('2026-11-07T10:00:00.000Z');
    const a = await agent();
    await seedLinks(a, [
      { url: 'https://example.net/paper', useCount: 2, lastUsedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const r = await mcpTool(a.secret, 'add_link', { url: 'https://EXAMPLE.net/paper#x' });
    expect(r.structuredContent.status).toBe('boosted');
    expect(await linkCount(a)).toBe(1);
    expect(r.structuredContent.link).toMatchObject({
      use_count: 2,
      last_used_at: '2026-11-07T10:00:00.000Z',
    });
  });

  it('applies tags as a manual edit and files the link into a workspace once', async () => {
    const a = await agent();
    const research = await createWorkspace(a, 'Research');
    const [old] = await seedLinks(a, [{ url: 'https://old.example' }]);
    await api('POST', `/api/v1/workspaces/${research}/links`, {
      as: a.session,
      body: { link_id: old },
    });
    const first = await mcpTool(a.secret, 'add_link', {
      url: 'https://new.example/x',
      tags: [' Reading ', 'ml'],
      workspace: 'research',
    });
    expect(first.isError).toBeFalsy();
    const id = first.structuredContent.link.id;
    expect(first.structuredContent.link.tags).toEqual(['reading', 'ml']);
    expect(first.structuredContent.link.workspaces).toEqual([{ id: research, name: 'Research' }]);
    const stored = await api('GET', `/api/v1/links/${id}`, { as: a.session });
    expect(stored.json.edited_fields).toContain('tags');
    expect(await workspaceLinks(a, research)).toEqual([old, id]);

    const again = await mcpTool(a.secret, 'add_link', {
      url: 'https://new.example/x',
      workspace: research,
    });
    expect(again.structuredContent.status).toBe('boosted');
    expect(again.structuredContent.link.tags).toEqual(['reading', 'ml']);
    expect(await workspaceLinks(a, research)).toEqual([old, id]);
  });

  it.each(['javascript:alert(1)', 'http://localhost', 'not a url'])(
    'refuses the url %j as POST /api/v1/links does',
    async (url) => {
      const a = await agent();
      const r = await mcpTool(a.secret, 'add_link', { url });
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toEqual({
        error: 'invalid_url',
        field: 'url',
        url,
        message: 'not a valid web address',
      });
      expect(r.response.json.error).toBeUndefined();
      expect(await linkCount(a)).toBe(0);
    },
  );

  describe('stores nothing when an argument is refused', () => {
    it.each([
      ['a workspace that does not exist', { workspace: 'Nowhere' }, 'not_found', undefined],
      ["another user's workspace", { workspace: 'THEIRS' }, 'not_found', undefined],
      ['a tag of two words', { tags: ['two words'] }, 'invalid_arguments', 'tags'],
      ['an empty tag', { tags: ['ok', ''] }, 'invalid_arguments', 'tags'],
      [
        'too many tags',
        { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) },
        'invalid_arguments',
        'tags',
      ],
    ])('%s', async (_case, args, error, field) => {
      const a = await agent();
      const b = await agent('other@example.test');
      const theirs = await createWorkspace(b, 'Theirs');
      const mine = await createWorkspace(a, 'Mine');
      const workspace = (args as { workspace?: string }).workspace;
      const r = await mcpTool(a.secret, 'add_link', {
        url: 'https://example.net/',
        ...args,
        ...(workspace === 'THEIRS' ? { workspace: theirs } : {}),
      });
      expect(r.isError).toBe(true);
      expect(r.structuredContent.error).toBe(error);
      expect(typeof r.structuredContent.message).toBe('string');
      if (field) expect(r.structuredContent.field).toBe(field);
      expect(await linkCount(a)).toBe(0);
      expect(await workspaceLinks(a, mine)).toEqual([]);
      expect(await workspaceLinks(b, theirs)).toEqual([]);
    });

    it('a new url while the library is full', { timeout: 60_000 }, async () => {
      const a = await agent();
      await seedLinks(
        a,
        Array.from({ length: 20_000 }, (_, i) => ({ url: `https://full${i}.example` })),
      );
      const r = await mcpTool(a.secret, 'add_link', { url: 'https://one-more.example/' });
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toEqual({
        error: 'library_full',
        message: 'library full (20,000 links)',
      });
      expect(await linkCount(a)).toBe(20_000);
    });
  });

  it(
    'counts once against the rate limit, however many operations it performs',
    { timeout: 120_000 },
    async () => {
      setNow('2026-11-07T10:00:05.000Z');
      const a = await agent();
      await createWorkspace(a, 'Research');
      for (let i = 0; i < 300; i++) {
        expect((await api('GET', '/api/v1/me', { bearer: a.secret })).status).toBe(200);
      }
      for (let i = 0; i < 299; i++) {
        const r = await mcpTool(a.secret, 'add_link', {
          url: `https://rl${i}.example/`,
          tags: ['rate'],
          workspace: 'Research',
        });
        expect(r.isError, JSON.stringify(r.structuredContent)).toBeFalsy();
      }
      const r = await mcp(a.secret, 'tools/call', {
        name: 'add_link',
        arguments: { url: 'https://one-too-many.example/', tags: ['rate'], workspace: 'Research' },
      });
      expect(r.status).toBe(429);
      expect(r.json).toEqual({ error: 'rate_limited' });
      expect(await linkCount(a)).toBe(299);
    },
  );
});

/** The use counts and last-used times of the user's links, by id. */
async function uses(user: TestUser) {
  const rows = await env.DB.prepare(
    'SELECT id, use_count, last_used_at FROM links WHERE user_id = ? ORDER BY id',
  )
    .bind(user.id)
    .all();
  return rows.results;
}

/** Stores reader-view text for a link, as the fetch worker does, and indexes it. */
async function readerText(user: TestUser, id: string, text: string) {
  await env.DB.prepare(
    'INSERT OR REPLACE INTO link_texts (link_id, user_id, text) VALUES (?, ?, ?)',
  )
    .bind(id, user.id, text)
    .run();
  await indexReaderText(env, id, text);
}

describe('search_links and list_recent', () => {
  it.each([
    ['cloudflare queues', undefined, 3],
    ['cloudflare queues', 2, 2],
    ['tag:infra queues', undefined, 1],
    ['zzz-nothing', undefined, 0],
  ] as const)('search_links %j with limit %s', async (query, limit, expected) => {
    const a = await agent();
    const ids = await seedLinks(
      a,
      Array.from({ length: 8 }, (_, i) => ({ url: `https://s${i}.example` })),
    );
    for (const id of ids.slice(0, 3)) {
      await readerText(a, id, 'How Cloudflare Queues deliver messages between Workers.');
    }
    for (const id of ids.slice(3)) await readerText(a, id, 'A recipe for bread and butter.');
    await api('PATCH', `/api/v1/links/${ids[0]}`, { as: a.session, body: { tags: ['infra'] } });
    const before = await uses(a);
    const r = await mcpTool(a.secret, 'search_links', { query, ...(limit ? { limit } : {}) });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.items).toHaveLength(expected);
    const direct = await api(
      'GET',
      `/api/v1/search?q=${encodeURIComponent(query)}&limit=${limit ?? 10}&mode=hybrid`,
      { as: a.session },
    );
    expect(r.structuredContent).toEqual(direct.json);
    expect(r.structuredContent.meaning).toBe('used');
    expect(await uses(a)).toEqual(before);
  });

  it('search_links finds a link by meaning that shares no word with the query', async () => {
    const a = await agent();
    const id = await seedArticle(a, ARTICLES.alarms);
    await deliverIndexing([{ user_id: a.id, link_id: id }]);

    const r = await mcpTool(a.secret, 'search_links', { query: 'timer delay' });

    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.items.map((i: { link: { id: string } }) => i.link.id)).toEqual([id]);
    expect(r.structuredContent.items[0].match).toBe('meaning');
  });

  it('list_recent returns the first page of the stream', async () => {
    const a = await agent();
    const ids = await seedLinks(
      a,
      Array.from({ length: 30 }, (_, i) => ({ url: `https://r${i}.example` })),
    );
    await api('POST', `/api/v1/links/${ids[5]}/pin`, { as: a.session });
    const before = await uses(a);
    const r = await mcpTool(a.secret, 'list_recent', {});
    const direct = await api('GET', '/api/v1/links?limit=20', { as: a.session });
    expect(r.structuredContent).toEqual(direct.json);
    expect(r.structuredContent.items[0].id).toBe(ids[5]);
    expect(
      (await mcpTool(a.secret, 'list_recent', { limit: 5 })).structuredContent.items,
    ).toHaveLength(5);
    expect(await uses(a)).toEqual(before);
  });

  it.each([
    ['search_links', { query: 'x', limit: 0 }, 'limit'],
    ['search_links', { query: 'x', limit: 101 }, 'limit'],
    ['list_recent', { limit: 2.5 }, 'limit'],
    ['search_links', {}, 'query'],
    ['search_links', { query: '' }, 'query'],
  ])('%s refuses %j', async (tool, args, field) => {
    const a = await agent();
    const r = await mcpTool(a.secret, tool, args);
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ error: 'invalid_arguments', field });
    expect(r.response.json.error).toBeUndefined();
  });
});

/** Stores a fetched link's copies as the fetch worker does: snapshot, reader view and text. */
async function storeCopies(
  user: TestUser,
  id: string,
  kind: 'html' | 'pdf',
  {
    snapshot = '<html><title>T</title><body><p>Body</p></body></html>',
    text = 'The reader text.',
  } = {},
) {
  await env.DB.prepare(
    "UPDATE links SET state = 'active', content_kind = ?, has_snapshot = 1, fetched_at = ? WHERE id = ?",
  )
    .bind(kind, '2026-01-02T00:00:00.000Z', id)
    .run();
  await env.SNAPSHOTS.put(snapshotKey(user.id, id), kind === 'pdf' ? '%PDF-1.4 bytes' : snapshot);
  if (kind === 'html') {
    await env.SNAPSHOTS.put(
      readerKey(user.id, id),
      JSON.stringify({ title: 'T', byline: null, html: `<p>${text}</p>` }),
    );
  }
  await readerText(user, id, text);
}

async function useOf(id: string) {
  return env.DB.prepare('SELECT use_count, last_used_at FROM links WHERE id = ?')
    .bind(id)
    .first<{ use_count: number; last_used_at: string }>();
}

describe('search_passages', () => {
  /** An agent whose library holds three articles, indexed. */
  async function librarian() {
    const a = await agent();
    const ids: string[] = [];
    for (const article of [ARTICLES.alarms, ARTICLES.queues, ARTICLES.tomatoes]) {
      ids.push(await seedArticle(a, article));
    }
    await deliverIndexing(ids.map((link_id) => ({ user_id: a.id, link_id })));
    return { a, ids };
  }

  it.each([
    { name: 'a question', args: { query: 'run a task later' }, limit: 8, found: true },
    {
      name: 'a question with a limit',
      args: { query: 'run a task later', limit: 1 },
      limit: 1,
      found: true,
    },
    {
      name: 'a question with a filter',
      args: { query: 'run a task later host:example.com' },
      limit: 8,
      found: true,
    },
    {
      name: 'a question nothing answers',
      args: { query: 'quarterly tax return' },
      limit: 8,
      found: false,
    },
  ])(
    'answers $name as GET /api/v1/passages does, recording no use',
    async ({ args, limit, found }) => {
      const { a, ids } = await librarian();
      const before = await uses(a);

      const r = await mcpTool(a.secret, 'search_passages', args);

      expect(r.isError).toBeFalsy();
      const direct = await api(
        'GET',
        `/api/v1/passages?q=${encodeURIComponent(args.query)}&limit=${limit}`,
        { as: a.session },
      );
      expect(r.structuredContent).toEqual(direct.json);
      expect(JSON.parse(r.content[0]!.text)).toEqual(r.structuredContent);
      expect(r.structuredContent.items.length > 0).toBe(found);
      if (found) {
        expect(r.structuredContent.items[0]).toMatchObject({
          link_id: ids[0],
          title: ARTICLES.alarms.title,
          url: ARTICLES.alarms.url,
        });
      }
      expect(await uses(a)).toEqual(before);
    },
  );

  it.each([
    { name: 'a question of filters only', query: 'tag:infra', error: 'invalid_question' },
    { name: 'a blank question', query: '   ', error: 'invalid_question' },
    { name: 'a question over 200 characters', query: 'x'.repeat(201), error: 'query_too_long' },
    { name: 'a refused filter', query: 'x state:bogus', error: 'invalid_filter' },
    { name: 'an index that fails', query: 'alarms', error: 'search_unavailable', fail: true },
  ])('answers $name with the API’s error as a tool error', async ({ query, error, fail }) => {
    const { a } = await librarian();
    if (fail) meaning.fail('embed');

    const r = await mcpTool(a.secret, 'search_passages', { query });

    expect(r.isError).toBe(true);
    const direct = await api('GET', `/api/v1/passages?q=${encodeURIComponent(query)}&limit=8`, {
      as: a.session,
    });
    expect(direct.json.error).toBe(error);
    expect(r.structuredContent).toEqual(direct.json);
  });

  it.each([
    { args: { query: 'alarms', limit: 21 }, field: 'limit' },
    { args: { query: 'alarms', limit: 0 }, field: 'limit' },
    { args: { query: '' }, field: 'query' },
    { args: {}, field: 'query' },
  ])('refuses the arguments $args as invalid_arguments naming $field', async ({ args, field }) => {
    const a = await agent();

    const r = await mcpTool(a.secret, 'search_passages', args);

    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ error: 'invalid_arguments', field });
    expect(meaning.calls).toEqual([]);
  });
});

describe('get_link and get_link_content', () => {
  it('get_link returns the link as GET /api/v1/links/{id} does, recording no use', async () => {
    const a = await agent();
    const [id] = await seedLinks(a, [{ url: 'https://enriched.example', state: 'active' }]);
    await api('PATCH', `/api/v1/links/${id}`, {
      as: a.session,
      body: { summary: 'A summary.', tags: ['infra'], topic: 'Ops' },
    });
    const before = await useOf(id!);
    const r = await mcpTool(a.secret, 'get_link', { id });
    const direct = await api('GET', `/api/v1/links/${id}`, { as: a.session });
    expect(r.structuredContent).toEqual(direct.json);
    expect(r.structuredContent).toMatchObject({
      summary: 'A summary.',
      tags: ['infra'],
      topic: 'Ops',
    });
    expect(await useOf(id!)).toEqual(before);
  });

  it.each(['html', 'pdf'] as const)(
    'get_link_content returns the reader text of a %s link and records a use',
    async (kind) => {
      const t = '2026-11-07T10:00:00.000Z';
      const a = await agent();
      const [id] = await seedLinks(a, [{ url: `https://${kind}.example`, useCount: 1 }]);
      await storeCopies(a, id!, kind, { text: `The ${kind} text about queues.` });
      setNow(t);
      const r = await mcpTool(a.secret, 'get_link_content', { id, format: 'text' });
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toEqual({
        id,
        format: 'text',
        content: `The ${kind} text about queues.`,
      });
      expect(await useOf(id!)).toEqual({ use_count: 2, last_used_at: t });
      const history = await api('GET', `/api/v1/links/${id}/history`, { as: a.session });
      expect(history.json.items[0]).toEqual({ kind: 'use', at: t });
    },
  );

  it('get_link_content returns the snapshot HTML and records a use', async () => {
    const a = await agent();
    const [id] = await seedLinks(a, [{ url: 'https://snap.example' }]);
    const html = '<html><title>T</title><body><p>Kept as it was.</p></body></html>';
    await storeCopies(a, id!, 'html', { snapshot: html });
    const r = await mcpTool(a.secret, 'get_link_content', { id, format: 'html' });
    expect(r.structuredContent).toEqual({ id, format: 'html', content: html });
    expect((await useOf(id!))!.use_count).toBe(1);
  });

  it.each([
    ['html of a PDF link', 'pdf', 'html', 'not_html'],
    ['text of a pending link', 'pending', 'text', 'no_content'],
    ['html of a link that is not a web page', 'other', 'html', 'no_content'],
  ] as const)('get_link_content refuses %s', async (_case, kind, format, error) => {
    const a = await agent();
    const [id] = await seedLinks(a, [{ url: 'https://refused.example' }]);
    if (kind === 'pdf') await storeCopies(a, id!, 'pdf');
    if (kind === 'other') {
      await env.DB.prepare(
        `UPDATE links SET state = 'active', content_kind = 'other', has_snapshot = 0,
           notes = '["not a web page (image/png)"]' WHERE id = ?`,
      )
        .bind(id)
        .run();
    }
    const before = await useOf(id!);
    const r = await mcpTool(a.secret, 'get_link_content', { id, format });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error).toBe(error);
    if (error === 'not_html') {
      expect(r.structuredContent.message).toBe('this link is a PDF; use format text');
    }
    expect(await useOf(id!)).toEqual(before);
  });

  it.each([
    ['get_link', {}, 'id'],
    ['get_link_content', { format: 'pdf' }, 'format'],
    ['get_link_content', {}, 'format'],
  ])('%s refuses %j', async (tool, args, field) => {
    const a = await agent();
    const [id] = await seedLinks(a, [{ url: 'https://args.example' }]);
    const before = await useOf(id!);
    const r = await mcpTool(a.secret, tool, field === 'id' ? args : { id, ...args });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ error: 'invalid_arguments', field });
    expect(await useOf(id!)).toEqual(before);
  });
});

describe('workspaces, pins and the archive', () => {
  it.each([0, 3, 150])(
    'list_workspaces returns all %i workspaces',
    { timeout: 60_000 },
    async (n) => {
      const a = await agent();
      for (let i = 0; i < n; i++)
        await createWorkspace(a, `Workspace ${String(i).padStart(3, '0')}`);
      const r = await mcpTool(a.secret, 'list_workspaces', {});
      const pages: unknown[] = [];
      let cursor: string | null = null;
      do {
        const page: { json: { items: unknown[]; next_cursor: string | null } } = await api(
          'GET',
          `/api/v1/workspaces${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
          { as: a.session },
        );
        pages.push(...page.json.items);
        cursor = page.json.next_cursor;
      } while (cursor);
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toEqual({ items: pages });
      expect(pages).toHaveLength(n);
    },
  );

  it.each(['id', 'Research', 'RESEARCH'])(
    'add_to_workspace files a link by the workspace’s %s',
    async (form) => {
      const a = await agent();
      const research = await createWorkspace(a, 'Research');
      const [first, link] = await seedLinks(a, [
        { url: 'https://first.example' },
        { url: 'https://second.example' },
      ]);
      await api('POST', `/api/v1/workspaces/${research}/links`, {
        as: a.session,
        body: { link_id: first },
      });
      const workspace = form === 'id' ? research : form;
      const r = await mcpTool(a.secret, 'add_to_workspace', { link_id: link, workspace });
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toEqual({ workspace_id: research, link_id: link, position: 2 });
      expect(await workspaceLinks(a, research)).toEqual([first, link]);
      const again = await mcpTool(a.secret, 'add_to_workspace', { link_id: link, workspace });
      const direct = await api('POST', `/api/v1/workspaces/${research}/links`, {
        as: a.session,
        body: { link_id: link },
      });
      expect(again.structuredContent).toEqual(direct.json);
      expect(await workspaceLinks(a, research)).toEqual([first, link]);
    },
  );

  it.each([
    'an unknown link',
    "another user's link",
    'an unknown workspace',
    "another user's workspace",
  ])('add_to_workspace refuses %s', async (target) => {
    const a = await agent();
    const b = await agent('other@example.test');
    const mine = await createWorkspace(a, 'Mine');
    const theirs = await createWorkspace(b, 'Theirs');
    const [link] = await seedLinks(a, [{ url: 'https://mine.example' }]);
    const [theirLink] = await seedLinks(b, [{ url: 'https://theirs.example' }]);
    const args = {
      'an unknown link': { link_id: 'no-such-link', workspace: mine },
      "another user's link": { link_id: theirLink, workspace: mine },
      'an unknown workspace': { link_id: link, workspace: 'Nowhere' },
      "another user's workspace": { link_id: link, workspace: theirs },
    }[target];
    const r = await mcpTool(a.secret, 'add_to_workspace', args);
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error).toBe('not_found');
    expect(await workspaceLinks(a, mine)).toEqual([]);
    expect(await workspaceLinks(b, theirs)).toEqual([]);
  });

  it('pin_link pins at the bottom of the pinned section', async () => {
    const a = await agent();
    const [x, y] = await seedLinks(a, [{ url: 'https://a.example' }, { url: 'https://b.example' }]);
    await api('POST', `/api/v1/links/${x}/pin`, { as: a.session });
    const r = await mcpTool(a.secret, 'pin_link', { link_id: y });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ id: y, pinned: true, pin_position: 2 });
    const stream = await api('GET', '/api/v1/links', { as: a.session });
    expect(stream.json.items.slice(0, 2).map((l: { id: string }) => l.id)).toEqual([x, y]);
  });

  it('pin_link refuses a 31st pin', async () => {
    const a = await agent();
    const ids = await seedLinks(
      a,
      Array.from({ length: 31 }, (_, i) => ({
        url: `https://p${i}.example`,
        pinPosition: i < 30 ? i + 1 : null,
      })),
    );
    const r = await mcpTool(a.secret, 'pin_link', { link_id: ids[30] });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toEqual({ error: 'pin_limit', message: 'unpin something first' });
    const positions = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM links WHERE user_id = ? AND pin_position IS NOT NULL',
    )
      .bind(a.id)
      .first<{ n: number }>();
    expect(positions?.n).toBe(30);
  });

  it.each(['active', 'pinned', 'archived'])(
    'archive_link answers for a %s link as POST /api/v1/links/{id}/archive does',
    async (state) => {
      setNow('2026-11-07T10:00:00.000Z');
      const a = await agent();
      const [link, twin] = await seedLinks(a, [
        {
          url: 'https://link.example',
          state: state === 'archived' ? 'archived' : 'active',
          pinPosition: state === 'pinned' ? 1 : null,
        },
        {
          url: 'https://twin.example',
          state: state === 'archived' ? 'archived' : 'active',
          pinPosition: state === 'pinned' ? 2 : null,
        },
      ]);
      const r = await mcpTool(a.secret, 'archive_link', { link_id: link });
      const direct = await api('POST', `/api/v1/links/${twin}/archive`, { as: a.session });
      expect(Boolean(r.isError)).toBe(direct.status >= 400);
      const meaning = (body: Record<string, unknown>) => ({
        keys: Object.keys(body).sort(),
        state: body.state,
        pinned: body.pinned,
        archived_at: body.archived_at,
        error: body.error,
        message: body.message,
      });
      expect(meaning(r.structuredContent)).toEqual(meaning(direct.json));
      if (state === 'active') {
        expect(r.structuredContent.state).toBe('archived');
        const stream = await api('GET', '/api/v1/links', { as: a.session });
        expect(stream.json.items.map((l: { id: string }) => l.id)).not.toContain(link);
        const archive = await api('GET', '/api/v1/archive', { as: a.session });
        expect(archive.json.items.map((l: { id: string }) => l.id)).toContain(link);
      }
    },
  );
});

describe('one user, one contract', () => {
  it.each([
    ['get_link', (l: string) => ({ id: l })],
    ['get_link_content', (l: string) => ({ id: l, format: 'text' })],
    [
      'add_to_workspace (their link)',
      (l: string, _w: string, mine: { ws: string }) => ({ link_id: l, workspace: mine.ws }),
    ],
    [
      'add_to_workspace (their workspace)',
      (_l: string, w: string, mine: { link: string }) => ({ link_id: mine.link, workspace: w }),
    ],
    ['pin_link', (l: string) => ({ link_id: l })],
    ['archive_link', (l: string) => ({ link_id: l })],
  ] as const)(
    '%s answers for another user’s resource as for one that does not exist',
    async (name, args) => {
      const a = await agent();
      const b = await agent('other@example.test');
      const [mineLink] = await seedLinks(a, [{ url: 'https://mine.example' }]);
      const mineWs = await createWorkspace(a, 'Mine');
      const [theirLink] = await seedLinks(b, [{ url: 'https://shared.example', state: 'active' }]);
      await storeCopies(b, theirLink!, 'html');
      const theirWs = await createWorkspace(b, 'Theirs');
      const mine = { link: mineLink!, ws: mineWs };
      const tool = name.split(' ')[0]!;
      const before = await env.DB.prepare(
        'SELECT state, pin_position, use_count FROM links WHERE id = ?',
      )
        .bind(theirLink)
        .first();
      const foreign = await mcpTool(a.secret, tool, args(theirLink!, theirWs, mine));
      const nowhere = await mcpTool(a.secret, tool, args('no-such-id', 'no-such-id', mine));
      expect(foreign.isError).toBe(true);
      expect(foreign.structuredContent).toEqual(nowhere.structuredContent);
      expect(foreign.structuredContent.error).toBe('not_found');
      expect(
        await env.DB.prepare('SELECT state, pin_position, use_count FROM links WHERE id = ?')
          .bind(theirLink)
          .first(),
      ).toEqual(before);
      expect(await workspaceLinks(b, theirWs)).toEqual([]);
      expect(await workspaceLinks(a, mineWs)).toEqual([]);
      const found = await mcpTool(a.secret, 'search_links', { query: 'shared' });
      const recent = await mcpTool(a.secret, 'list_recent', { limit: 100 });
      const ids = [
        ...found.structuredContent.items.map((i: { link: { id: string } }) => i.link.id),
        ...recent.structuredContent.items.map((l: { id: string }) => l.id),
      ];
      expect(ids).not.toContain(theirLink);
    },
  );

  /** A body with every id, time and cursor replaced, so that twin libraries compare equal. */
  function normalised(body: unknown): unknown {
    return JSON.parse(
      JSON.stringify(body)
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'ID')
        .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, 'TIME')
        .replace(/"next_cursor":"[^"]+"/g, '"next_cursor":"CURSOR"')
        .replace(/twin-[ab]/g, 'twin'),
    );
  }

  /** Two users with the same library: links, one pinned, one fetched, one workspace. */
  async function twins() {
    setNow('2026-11-07T10:00:00.000Z');
    const users = [await agent('twin-a@example.test'), await agent('twin-b@example.test')];
    const libraries = [];
    for (const user of users) {
      const ids = await seedLinks(user, [
        { url: 'https://one.example', lastUsedAt: '2026-11-01T00:00:00.000Z' },
        { url: 'https://two.example', lastUsedAt: '2026-11-02T00:00:00.000Z', pinPosition: 1 },
        { url: 'https://read.example', lastUsedAt: '2026-11-03T00:00:00.000Z' },
      ]);
      await storeCopies(user, ids[2]!, 'html', { text: 'Twin reader text about queues.' });
      const ws = await createWorkspace(user, 'Research');
      libraries.push({ user, ids, ws });
    }
    return libraries as [(typeof libraries)[0], (typeof libraries)[0]];
  }

  type Lib = Awaited<ReturnType<typeof twins>>[0];
  const cases: [string, string, (l: Lib) => unknown, (l: Lib) => [string, string, unknown?]][] = [
    [
      'add_link new',
      'add_link',
      () => ({ url: 'https://new.example/' }),
      () => ['POST', '/api/v1/links', { url: 'https://new.example/' }],
    ],
    [
      'add_link duplicate',
      'add_link',
      () => ({ url: 'https://one.example' }),
      () => ['POST', '/api/v1/links', { url: 'https://one.example' }],
    ],
    [
      'add_link refused',
      'add_link',
      () => ({ url: 'not a url' }),
      () => ['POST', '/api/v1/links', { url: 'not a url' }],
    ],
    [
      'get_link',
      'get_link',
      (l) => ({ id: l.ids[0] }),
      (l) => ['GET', `/api/v1/links/${l.ids[0]}`],
    ],
    ['get_link refused', 'get_link', () => ({ id: 'nope' }), () => ['GET', '/api/v1/links/nope']],
    [
      'get_link_content refused',
      'get_link_content',
      () => ({ id: 'nope', format: 'text' }),
      () => ['GET', '/api/v1/links/nope/reader'],
    ],
    [
      'pin_link',
      'pin_link',
      (l) => ({ link_id: l.ids[0] }),
      (l) => ['POST', `/api/v1/links/${l.ids[0]}/pin`],
    ],
    [
      'pin_link refused',
      'pin_link',
      () => ({ link_id: 'nope' }),
      () => ['POST', '/api/v1/links/nope/pin'],
    ],
    [
      'archive_link',
      'archive_link',
      (l) => ({ link_id: l.ids[0] }),
      (l) => ['POST', `/api/v1/links/${l.ids[0]}/archive`],
    ],
    [
      'archive_link refused',
      'archive_link',
      () => ({ link_id: 'nope' }),
      () => ['POST', '/api/v1/links/nope/archive'],
    ],
    [
      'add_to_workspace',
      'add_to_workspace',
      (l) => ({ link_id: l.ids[0], workspace: l.ws }),
      (l) => ['POST', `/api/v1/workspaces/${l.ws}/links`, { link_id: l.ids[0] }],
    ],
    [
      'add_to_workspace refused',
      'add_to_workspace',
      (l) => ({ link_id: 'nope', workspace: l.ws }),
      (l) => ['POST', `/api/v1/workspaces/${l.ws}/links`, { link_id: 'nope' }],
    ],
    [
      'search_links',
      'search_links',
      () => ({ query: 'queues' }),
      () => ['GET', '/api/v1/search?q=queues&limit=10&mode=hybrid'],
    ],
    [
      'search_links refused',
      'search_links',
      () => ({ query: 'x'.repeat(201) }),
      () => ['GET', `/api/v1/search?q=${'x'.repeat(201)}&limit=10&mode=hybrid`],
    ],
    ['list_recent', 'list_recent', () => ({}), () => ['GET', '/api/v1/links?limit=20']],
  ];

  it.each(cases)('%s answers as the API does', async (_case, tool, args, request) => {
    const [a, b] = await twins();
    const r = await mcpTool(a.user.secret, tool, args(a));
    const [method, path, body] = request(b);
    const direct = await api(method, path, { bearer: b.user.secret, body });
    expect(r.response.json.error).toBeUndefined();
    expect(Boolean(r.isError)).toBe(direct.status >= 400);
    expect(normalised(r.structuredContent)).toEqual(normalised(direct.json));
    expect(JSON.parse(r.content[0]!.text)).toEqual(r.structuredContent);
  });

  it('get_link_content text carries what GET /api/v1/links/{id}/reader serves', async () => {
    const [a, b] = await twins();
    const r = await mcpTool(a.user.secret, 'get_link_content', { id: a.ids[2], format: 'text' });
    const direct = await api('GET', `/api/v1/links/${b.ids[2]}/reader`, { bearer: b.user.secret });
    expect(r.structuredContent.content).toBe(direct.json.text);
  });

  it('list_workspaces carries the items of GET /api/v1/workspaces', async () => {
    const [a, b] = await twins();
    const r = await mcpTool(a.user.secret, 'list_workspaces', {});
    const direct = await api('GET', '/api/v1/workspaces', { bearer: b.user.secret });
    expect(normalised(r.structuredContent.items)).toEqual(normalised(direct.json.items));
  });
});

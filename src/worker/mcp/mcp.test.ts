import { describe, expect, it, vi } from 'vitest';
import {
  api,
  count,
  createToken,
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
    const tokens = await api('GET', '/api/v1/tokens', { as: a.session });
    expect(tokens.json.items[0].last_used_at).toBe(t);
  });

  it('lists exactly the nine tools with their arguments', async () => {
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
      `/api/v1/search?q=${encodeURIComponent(query)}&limit=${limit ?? 10}`,
      { as: a.session },
    );
    expect(r.structuredContent).toEqual(direct.json);
    expect(await uses(a)).toEqual(before);
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

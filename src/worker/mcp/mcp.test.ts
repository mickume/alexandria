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

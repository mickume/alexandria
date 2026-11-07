import { describe, expect, it } from 'vitest';
import { api, count, env, seedLinks, signIn, type TestUser } from '../test/helpers';

function create(user: TestUser, body: unknown) {
  return api('POST', '/api/v1/workspaces', { as: user.session, body });
}

async function workspace(user: TestUser, name: string): Promise<string> {
  const r = await create(user, { name });
  expect(r.status).toBe(201);
  return r.json.id;
}

/** Puts `links` into a workspace directly, at positions 1..n. */
async function seedMembers(workspaceId: string, links: string[]): Promise<void> {
  await env.DB.batch(
    links.map((linkId, i) =>
      env.DB.prepare(
        'INSERT INTO workspace_links (workspace_id, link_id, position) VALUES (?, ?, ?)',
      ).bind(workspaceId, linkId, i + 1),
    ),
  );
}

async function members(workspaceId: string): Promise<[string, number][]> {
  const rows = await env.DB.prepare(
    'SELECT link_id, position FROM workspace_links WHERE workspace_id = ? ORDER BY position',
  )
    .bind(workspaceId)
    .all<{ link_id: string; position: number }>();
  return rows.results.map((r) => [r.link_id, r.position]);
}

describe('creating a workspace', () => {
  it('stores the trimmed name and the description, empty and without members', async () => {
    const user = await signIn();
    const r = await create(user, { name: '  Trip to Lisbon ', description: 'Places and bookings' });
    expect(r.status).toBe(201);
    expect(r.json).toEqual({
      id: expect.any(String),
      name: 'Trip to Lisbon',
      description: 'Places and bookings',
      note: '',
      link_count: 0,
      created_at: expect.any(String),
    });
  });

  it.each([
    { body: {}, error: 'invalid_name', field: 'name', create: true },
    { body: { name: '   ' }, error: 'invalid_name', field: 'name', create: false },
    { body: { name: 'x'.repeat(101) }, error: 'invalid_name', field: 'name', create: false },
    {
      body: { name: 'ok', description: 'd'.repeat(1001) },
      error: 'invalid_description',
      field: 'description',
      create: false,
    },
    {
      body: { name: 'ok', description: 'one\ntwo' },
      error: 'invalid_description',
      field: 'description',
      create: false,
    },
  ])('refuses $body', async ({ body, error, field, create: onlyCreate }) => {
    const user = await signIn();
    const id = await workspace(user, 'Existing');
    const before = await env.DB.prepare('SELECT * FROM workspaces WHERE id = ?').bind(id).first();
    const posted = await create(user, body);
    expect(posted.status).toBe(400);
    expect(posted.json).toEqual({ error, field, message: expect.any(String) });
    expect(await count('workspaces', 'user_id = ?', user.id)).toBe(1);
    if (!onlyCreate) {
      const patched = await api('PATCH', `/api/v1/workspaces/${id}`, { as: user.session, body });
      expect(patched.status).toBe(400);
      expect(patched.json).toEqual({ error, field, message: expect.any(String) });
      expect(
        await env.DB.prepare('SELECT * FROM workspaces WHERE id = ?').bind(id).first(),
      ).toEqual(before);
    }
  });

  it('accepts a name of exactly 100 characters', async () => {
    const user = await signIn();
    expect((await create(user, { name: 'x'.repeat(100) })).status).toBe(201);
  });

  it('refuses a name another workspace of the user carries, ignoring case', async () => {
    const user = await signIn();
    const lisbon = await workspace(user, 'Lisbon');
    const porto = await workspace(user, 'Porto');
    const taken = { error: 'name_taken', message: 'a workspace with this name already exists' };
    const r = await create(user, { name: ' lisbon ' });
    expect(r.status).toBe(409);
    expect(r.json).toEqual(taken);
    const p = await api('PATCH', `/api/v1/workspaces/${porto}`, {
      as: user.session,
      body: { name: 'LISBON' },
    });
    expect(p.status).toBe(409);
    expect(p.json).toEqual(taken);
    expect(
      (await env.DB.prepare('SELECT name FROM workspaces WHERE id = ?').bind(porto).first())?.name,
    ).toBe('Porto');
    expect(
      (
        await api('PATCH', `/api/v1/workspaces/${lisbon}`, {
          as: user.session,
          body: { name: 'lisbon' },
        })
      ).status,
    ).toBe(200);
    const other = await signIn('other@example.test', 'Other');
    expect((await create(other, { name: 'Lisbon' })).status).toBe(201);
  });

  it('refuses a 201st workspace', async () => {
    const user = await signIn();
    await env.DB.batch(
      Array.from({ length: 200 }, (_, i) =>
        env.DB.prepare(
          'INSERT INTO workspaces (id, user_id, name, name_key, created_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(`w${i}`, user.id, `W${i}`, `w${i}`, '2026-01-01T00:00:00.000Z'),
      ),
    );
    const r = await create(user, { name: 'One more' });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: 'workspace_limit', message: 'workspace limit reached (200)' });
    expect(await count('workspaces', 'user_id = ?', user.id)).toBe(200);
    await api('DELETE', '/api/v1/workspaces/w0', { as: user.session });
    expect((await create(user, { name: 'One more' })).status).toBe(201);
  });
});

describe('changing a workspace', () => {
  it('stores a new name and description and keeps the members and the note', async () => {
    const user = await signIn();
    const [a = '', b = ''] = await seedLinks(user, [
      { url: 'https://a.example/' },
      { url: 'https://b.example/' },
    ]);
    const id = await workspace(user, 'Lisbon');
    await seedMembers(id, [a, b]);
    await env.DB.prepare("UPDATE workspaces SET note = '# Plan' WHERE id = ?").bind(id).run();
    const r = await api('PATCH', `/api/v1/workspaces/${id}`, {
      as: user.session,
      body: { name: 'Lisbon 2027', description: '' },
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      id,
      name: 'Lisbon 2027',
      description: '',
      note: '# Plan',
      link_count: 2,
    });
    expect(await members(id)).toEqual([
      [a, 1],
      [b, 2],
    ]);
  });

  it('deletes the workspace and its memberships, keeping every link', async () => {
    const user = await signIn();
    const [a = '', b = ''] = await seedLinks(user, [
      { url: 'https://a.example/' },
      { url: 'https://b.example/' },
    ]);
    const id = await workspace(user, 'Gone');
    const kept = await workspace(user, 'Kept');
    await seedMembers(id, [a, b]);
    await seedMembers(kept, [b]);
    expect((await api('DELETE', `/api/v1/workspaces/${id}`, { as: user.session })).status).toBe(
      204,
    );
    expect((await api('GET', `/api/v1/workspaces/${id}`, { as: user.session })).status).toBe(404);
    for (const link of [a, b]) {
      expect((await api('GET', `/api/v1/links/${link}`, { as: user.session })).status).toBe(200);
    }
    const stream = await api('GET', '/api/v1/links', { as: user.session });
    expect(stream.json.items.map((l: { id: string }) => l.id).sort()).toEqual([a, b].sort());
    expect(await members(kept)).toEqual([[b, 1]]);
    expect(await count('workspace_links', 'workspace_id = ?', id)).toBe(0);
  });
});

describe('listing workspaces', () => {
  it('lists the user’s workspaces by name ignoring case, with their member counts', async () => {
    const user = await signIn();
    const links = await seedLinks(user, [
      { url: 'https://1.example/' },
      { url: 'https://2.example/' },
      { url: 'https://3.example/' },
    ]);
    const b = await workspace(user, 'b');
    await workspace(user, 'A');
    const c = await workspace(user, 'c');
    await seedMembers(b, [links[0]!, links[1]!]);
    await seedMembers(c, [links[2]!]);
    const other = await signIn('other@example.test', 'Other');
    await workspace(other, 'aa');
    const r = await api('GET', '/api/v1/workspaces', { as: user.session });
    expect(r.status).toBe(200);
    expect(r.json.items.map((w: { name: string }) => w.name)).toEqual(['A', 'b', 'c']);
    expect(r.json.items.map((w: { link_count: number }) => w.link_count)).toEqual([0, 2, 1]);
    expect(Object.keys(r.json.items[0]).sort()).toEqual([
      'created_at',
      'description',
      'id',
      'link_count',
      'name',
    ]);
    expect(r.json.next_cursor).toBeNull();
  });

  it('pages 100 at a time', async () => {
    const user = await signIn();
    await env.DB.batch(
      Array.from({ length: 123 }, (_, i) => {
        const name = `ws-${String(i).padStart(3, '0')}`;
        return env.DB.prepare(
          'INSERT INTO workspaces (id, user_id, name, name_key, created_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(`p${i}`, user.id, name, name, '2026-01-01T00:00:00.000Z');
      }),
    );
    const first = await api('GET', '/api/v1/workspaces', { as: user.session });
    expect(first.json.items).toHaveLength(100);
    const second = await api(
      'GET',
      `/api/v1/workspaces?cursor=${encodeURIComponent(first.json.next_cursor)}`,
      { as: user.session },
    );
    expect(second.json.items).toHaveLength(23);
    expect(second.json.next_cursor).toBeNull();
    const names = [...first.json.items, ...second.json.items].map((w: { name: string }) => w.name);
    expect(names).toEqual([...names].sort());
  });
});

describe('another user’s workspace', () => {
  it('is answered exactly as one that does not exist', async () => {
    const a = await signIn('a@example.test', 'A');
    const b = await signIn('b@example.test', 'B');
    const [aLink = ''] = await seedLinks(a, [{ url: 'https://a-link.example/' }]);
    const [bLink = ''] = await seedLinks(b, [{ url: 'https://b-link.example/' }]);
    const w = await workspace(b, 'Private');
    await seedMembers(w, [bLink]);
    const before = await env.DB.prepare('SELECT * FROM workspaces WHERE id = ?').bind(w).first();
    const requests = (id: string, link: string) =>
      [
        ['GET', `/api/v1/workspaces/${id}`, undefined],
        ['PATCH', `/api/v1/workspaces/${id}`, { name: 'x' }],
        ['DELETE', `/api/v1/workspaces/${id}`, undefined],
        ['GET', `/api/v1/workspaces/${id}/links`, undefined],
        ['POST', `/api/v1/workspaces/${id}/links`, { link_id: aLink }],
        ['DELETE', `/api/v1/workspaces/${id}/links/${link}`, undefined],
      ] as const;
    const others = requests(w, bLink);
    const nowhere = requests(crypto.randomUUID(), bLink);
    for (let i = 0; i < others.length; i++) {
      const [method, path, body] = others[i]!;
      const r = await api(method, path, { as: a.session, body });
      expect(r.status, `${method} ${path}`).toBe(404);
      expect(r.json).toEqual({ error: 'not_found' });
      const [m2, p2, b2] = nowhere[i]!;
      const r2 = await api(m2, p2, { as: a.session, body: b2 });
      expect([r2.status, r2.json]).toEqual([r.status, r.json]);
    }
    expect(await env.DB.prepare('SELECT * FROM workspaces WHERE id = ?').bind(w).first()).toEqual(
      before,
    );
    expect(await members(w)).toEqual([[bLink, 1]]);
  });
});

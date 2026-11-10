import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { api, count, env, seedLinks, setNow, signIn, type TestUser } from '../test/helpers';

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

  it('keeps its links when another user deletes one of them by id', async () => {
    const a = await signIn('a@example.test', 'A');
    const b = await signIn('b@example.test', 'B');
    const bLinks = await seedLinks(b, [
      { url: 'https://b-one.example/' },
      { url: 'https://b-two.example/' },
    ]);
    const w = await workspace(b, 'Private');
    await seedMembers(w, bLinks);
    const r = await api('DELETE', `/api/v1/links/${bLinks[0]}`, { as: a.session });
    expect(r.status).toBe(404);
    expect(await members(w)).toEqual([
      [bLinks[0], 1],
      [bLinks[1], 2],
    ]);
  });
});

function addMember(user: TestUser, w: string, body: unknown) {
  return api('POST', `/api/v1/workspaces/${w}/links`, { as: user.session, body });
}

async function listed(user: TestUser, w: string): Promise<string[]> {
  const r = await api('GET', `/api/v1/workspaces/${w}/links`, { as: user.session });
  return r.json.items.map((l: { id: string }) => l.id);
}

describe('adding links to a workspace', () => {
  it('adds a new member at the bottom', async () => {
    const user = await signIn();
    const [a = '', b = ''] = await seedLinks(user, [
      { url: 'https://a.example/' },
      { url: 'https://b.example/' },
    ]);
    const w = await workspace(user, 'W');
    expect((await addMember(user, w, { link_id: a })).status).toBe(201);
    const r = await addMember(user, w, { link_id: b });
    expect(r.status).toBe(201);
    expect(r.json).toEqual({ workspace_id: w, link_id: b, position: 2 });
    expect(await listed(user, w)).toEqual([a, b]);
  });

  it.each([
    { before: 'abc', call: ['c', 1], after: 'cab', status: 200 },
    { before: 'abc', call: ['a', 3], after: 'bca', status: 200 },
    { before: 'ab', call: ['d', 2], after: 'adb', status: 201 },
    { before: 'ab', call: ['d', 9], after: 'abd', status: 201 },
    { before: 'ab', call: ['b', undefined], after: 'ab', status: 200 },
  ] as const)(
    'places $call within $before to give $after',
    async ({ before, call, after, status }) => {
      const user = await signIn();
      const ids = await seedLinks(
        user,
        ['a', 'b', 'c', 'd'].map((n) => ({ url: `https://${n}.example/` })),
      );
      const byName: Record<string, string> = { a: ids[0]!, b: ids[1]!, c: ids[2]!, d: ids[3]! };
      const w = await workspace(user, 'W');
      await seedMembers(
        w,
        [...before].map((n) => byName[n]!),
      );
      const [name, position] = call;
      const r = await addMember(user, w, {
        link_id: byName[name],
        ...(position === undefined ? {} : { position }),
      });
      expect(r.status).toBe(status);
      expect(await members(w)).toEqual([...after].map((n, i) => [byName[n], i + 1]));
    },
  );

  it.each([
    { label: 'no link', body: () => ({}), status: 400, error: 'invalid_link_id' },
    {
      label: 'another user’s link',
      body: (o: string) => ({ link_id: o }),
      status: 404,
      error: 'not_found',
    },
    {
      label: 'an unknown link',
      body: () => ({ link_id: 'nope' }),
      status: 404,
      error: 'not_found',
    },
    {
      label: 'position 0',
      body: (_o: string, a: string) => ({ link_id: a, position: 0 }),
      status: 400,
      error: 'invalid_position',
    },
    {
      label: 'position 1.5',
      body: (_o: string, a: string) => ({ link_id: a, position: 1.5 }),
      status: 400,
      error: 'invalid_position',
    },
    {
      label: "position 'top'",
      body: (_o: string, a: string) => ({ link_id: a, position: 'top' }),
      status: 400,
      error: 'invalid_position',
    },
  ])('refuses $label', async ({ body, status, error }) => {
    const user = await signIn();
    const other = await signIn('other@example.test', 'Other');
    const [a = '', b = ''] = await seedLinks(user, [
      { url: 'https://a.example/' },
      { url: 'https://b.example/' },
    ]);
    const [o = ''] = await seedLinks(other, [{ url: 'https://o.example/' }]);
    const w = await workspace(user, 'W');
    await seedMembers(w, [b]);
    const r = await addMember(user, w, body(o, a));
    expect(r.status).toBe(status);
    expect(r.json.error).toBe(error);
    if (status === 400)
      expect(r.json.field).toBe(error === 'invalid_link_id' ? 'link_id' : 'position');
    expect(await members(w)).toEqual([[b, 1]]);
  });
});

describe('removing links from a workspace', () => {
  it('removes the link from the workspace only and closes the gap', async () => {
    const user = await signIn();
    const [a = '', b = '', c = '', d = ''] = await seedLinks(
      user,
      ['a', 'b', 'c', 'd'].map((n) => ({ url: `https://${n}.example/` })),
    );
    const w = await workspace(user, 'W');
    await seedMembers(w, [a, b, c]);
    expect(
      (await api('DELETE', `/api/v1/workspaces/${w}/links/${b}`, { as: user.session })).status,
    ).toBe(204);
    expect(await members(w)).toEqual([
      [a, 1],
      [c, 2],
    ]);
    expect((await api('GET', `/api/v1/links/${b}`, { as: user.session })).status).toBe(200);
    const notMember = await api('DELETE', `/api/v1/workspaces/${w}/links/${d}`, {
      as: user.session,
    });
    expect(notMember.status).toBe(404);
    expect(notMember.json).toEqual({ error: 'not_found' });
  });

  it('removes a deleted link from every workspace it was in', async () => {
    const user = await signIn();
    const [a = '', b = '', c = '', d = ''] = await seedLinks(
      user,
      ['a', 'b', 'c', 'd'].map((n) => ({ url: `https://${n}.example/` })),
    );
    const w1 = await workspace(user, 'W1');
    const w2 = await workspace(user, 'W2');
    await seedMembers(w1, [a, b, c]);
    await seedMembers(w2, [b, d]);
    expect((await api('DELETE', `/api/v1/links/${b}`, { as: user.session })).status).toBe(204);
    expect(await members(w1)).toEqual([
      [a, 1],
      [c, 2],
    ]);
    expect(await members(w2)).toEqual([[d, 1]]);
  });
});

describe('workspace positions', () => {
  it('stay 1 to n through any sequence of adds, moves, removals and link deletions', async () => {
    const user = await signIn();
    const spaces = [
      await workspace(user, 'W0'),
      await workspace(user, 'W1'),
      await workspace(user, 'W2'),
    ];
    const op = fc.oneof(
      fc.record({ kind: fc.constant('add' as const), w: fc.nat(2), x: fc.nat(19) }),
      fc.record({
        kind: fc.constant('move' as const),
        w: fc.nat(2),
        x: fc.nat(19),
        p: fc.integer({ min: 1, max: 25 }),
      }),
      fc.record({ kind: fc.constant('remove' as const), w: fc.nat(2), x: fc.nat(19) }),
      fc.record({ kind: fc.constant('delete' as const), x: fc.nat(19) }),
    );
    let run = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(op, { maxLength: 40 }), async (ops) => {
        run += 1;
        setNow(Date.parse('2026-09-01T00:00:00.000Z') + run * 61_000);
        // Every run starts from the same 20 links and empty workspaces.
        const fresh = await seedLinks(
          user,
          Array.from({ length: 20 }, (_, i) => ({ url: `https://r${run}-${i}.example/` })),
        );
        await env.DB.prepare('DELETE FROM workspace_links').run();
        const links = fresh;
        const model = new Map<string, Set<number>>(links.map((l) => [l, new Set<number>()]));
        const deleted = new Set<string>();
        for (const o of ops) {
          const link = links[o.x]!;
          if (o.kind === 'delete') {
            await api('DELETE', `/api/v1/links/${link}`, { as: user.session });
            deleted.add(link);
          } else if (o.kind === 'remove') {
            await api('DELETE', `/api/v1/workspaces/${spaces[o.w]}/links/${link}`, {
              as: user.session,
            });
            model.get(link)?.delete(o.w);
          } else {
            const r = await addMember(user, spaces[o.w]!, {
              link_id: link,
              ...(o.kind === 'move' ? { position: o.p } : {}),
            });
            if (!deleted.has(link)) {
              expect([200, 201]).toContain(r.status);
              model.get(link)!.add(o.w);
            }
          }
          for (const w of spaces) {
            const positions = (await members(w)).map(([, p]) => p);
            expect(positions).toEqual(positions.map((_, i) => i + 1));
          }
        }
        for (const link of links) {
          if (deleted.has(link)) continue;
          const actual = new Set<number>();
          for (let w = 0; w < spaces.length; w++) {
            if ((await members(spaces[w]!)).some(([id]) => id === link)) actual.add(w);
          }
          expect(actual).toEqual(model.get(link));
        }
      }),
      { numRuns: 12 },
    );
  }, 120_000);
});

describe('a workspace and its links', () => {
  it('shows the note and every member in order, whatever its state', async () => {
    const user = await signIn();
    const [a = '', b = ''] = await seedLinks(user, [
      { url: 'https://a.example/' },
      { url: 'https://b.example/', state: 'expired' },
    ]);
    const w = await workspace(user, 'W');
    await seedMembers(w, [a, b]);
    await env.DB.prepare("UPDATE workspaces SET note = '# Plan' WHERE id = ?").bind(w).run();
    const r = await api('GET', `/api/v1/workspaces/${w}`, { as: user.session });
    expect(r.json).toMatchObject({ note: '# Plan', link_count: 2 });
    const l = await api('GET', `/api/v1/workspaces/${w}/links`, { as: user.session });
    expect(l.status).toBe(200);
    expect(
      l.json.items.map((i: { id: string; position: number; state: string }) => [
        i.id,
        i.position,
        i.state,
      ]),
    ).toEqual([
      [a, 1, 'pending'],
      [b, 2, 'expired'],
    ]);
    expect(l.json.next_cursor).toBeNull();
  });
});

describe('adding links to a workspace at the same time', () => {
  it('gives every link a position of its own', async () => {
    const user = await signIn();
    const ids = await seedLinks(
      user,
      Array.from({ length: 6 }, (_, i) => ({ url: `https://at-once-${i}.example/` })),
    );
    const w = await workspace(user, 'Together');
    const answers = await Promise.all(
      ids.map((link_id) =>
        api('POST', `/api/v1/workspaces/${w}/links`, { as: user.session, body: { link_id } }),
      ),
    );
    expect(answers.map((r) => r.status)).toEqual(ids.map(() => 201));
    const stored = await members(w);
    expect(stored.map(([, position]) => position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(answers.map((r) => r.json.position).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

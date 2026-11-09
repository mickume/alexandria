import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { advance } from '../clock';
import { api, env, seedLinks, setNow, signIn, type TestUser } from '../test/helpers';

/** The user's pinned links by position, as [id, position] pairs. */
async function pinned(user: TestUser): Promise<[string, number][]> {
  const rows = await env.DB.prepare(
    'SELECT id, pin_position FROM links WHERE user_id = ? AND pin_position IS NOT NULL ORDER BY pin_position',
  )
    .bind(user.id)
    .all<{ id: string; pin_position: number }>();
  return rows.results.map((r) => [r.id, r.pin_position]);
}

async function streamIds(user: TestUser): Promise<string[]> {
  const r = await api('GET', '/api/v1/links?limit=100', { as: user.session });
  return r.json.items.map((l: { id: string }) => l.id);
}

function pin(user: TestUser, id: string, position?: unknown) {
  return api('POST', `/api/v1/links/${id}/pin`, {
    as: user.session,
    ...(position === undefined ? {} : { body: { position } }),
  });
}

async function setup(n: number): Promise<{ user: TestUser; ids: string[] }> {
  const user = await signIn();
  const ids = await seedLinks(
    user,
    Array.from({ length: n }, (_, i) => ({ url: `https://p${i}.example` })),
  );
  return { user, ids };
}

describe('pinning a link', () => {
  it('pins at the bottom of the pinned section and leaves a pinned link where it is', async () => {
    const { user, ids } = await setup(3);
    const [a = '', b = ''] = ids;
    expect((await pin(user, a)).json).toMatchObject({ id: a, pinned: true, pin_position: 1 });
    const r = await pin(user, b);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: b, pinned: true, pin_position: 2 });
    expect((await streamIds(user)).slice(0, 2)).toEqual([a, b]);
    expect((await pin(user, a)).json.pin_position).toBe(1);
    expect(await pinned(user)).toEqual([
      [a, 1],
      [b, 2],
    ]);
  });

  it.each([
    { before: 'abc', call: ['c', 1], after: 'cab' },
    { before: 'abc', call: ['a', 3], after: 'bca' },
    { before: 'ab', call: ['d', 2], after: 'adb' },
    { before: 'ab', call: ['d', 9], after: 'abd' },
  ] as const)('moves $call within $before to give $after', async ({ before, call, after }) => {
    const { user, ids } = await setup(4);
    const byName: Record<string, string> = { a: ids[0]!, b: ids[1]!, c: ids[2]!, d: ids[3]! };
    for (const name of before) await pin(user, byName[name]!);
    const r = await pin(user, byName[call[0]]!, call[1]);
    expect(r.status).toBe(200);
    expect(await pinned(user)).toEqual([...after].map((name, i) => [byName[name], i + 1]));
    expect((await streamIds(user)).slice(0, after.length)).toEqual(
      [...after].map((n) => byName[n]),
    );
  });

  it('refuses to pin an archived link, changing no position', async () => {
    const user = await signIn();
    const [first = '', archived = ''] = await seedLinks(user, [
      { url: 'https://first.example', pinPosition: 1, state: 'active' },
      { url: 'https://kept.example', state: 'archived' },
    ]);
    const r = await api('POST', `/api/v1/links/${archived}/pin`, { as: user.session });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: 'link_archived', message: 'archived links cannot be pinned' });
    const rows = await env.DB.prepare(
      'SELECT id, pin_position FROM links WHERE user_id = ? ORDER BY id',
    )
      .bind(user.id)
      .all<{ id: string; pin_position: number | null }>();
    expect(Object.fromEntries(rows.results.map((r) => [r.id, r.pin_position]))).toEqual({
      [first]: 1,
      [archived]: null,
    });
  });

  it('refuses a 31st pin, but still moves a pinned link', async () => {
    const { user, ids } = await setup(31);
    for (const id of ids.slice(0, 30)) expect((await pin(user, id)).status).toBe(200);
    const before = await pinned(user);
    const r = await pin(user, ids[30]!);
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: 'pin_limit', message: 'unpin something first' });
    expect(await pinned(user)).toEqual(before);
    expect((await pin(user, ids[29]!, 1)).status).toBe(200);
  });

  it.each([0, -1, 1.5, 'top'])('refuses the position %j', async (position) => {
    const { user, ids } = await setup(2);
    await pin(user, ids[0]!);
    const r = await pin(user, ids[1]!, position);
    expect(r.status).toBe(400);
    expect(r.json).toEqual({
      error: 'invalid_position',
      field: 'position',
      message: expect.any(String),
    });
    expect(await pinned(user)).toEqual([[ids[0], 1]]);
  });
});

describe('unpinning a link', () => {
  it('returns it to its place by last use and closes the gap', async () => {
    const { user, ids } = await setup(4);
    const [a = '', b = '', c = '', d = ''] = ids;
    for (const id of [a, b, c]) await pin(user, id);
    const r = await api('DELETE', `/api/v1/links/${b}/pin`, { as: user.session });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: b, pinned: false, pin_position: null });
    expect(await pinned(user)).toEqual([
      [a, 1],
      [c, 2],
    ]);
    // Seeded one second apart, so by last use: d (newest), then b.
    expect(await streamIds(user)).toEqual([a, c, d, b]);
  });
});

describe('pin positions', () => {
  it('stay 1 to n, without gaps or repeats, over any sequence of pins, moves and unpins', async () => {
    const { user, ids } = await setup(40);
    setNow(Date.parse('2026-08-01T00:00:00.000Z'));
    const op = fc.oneof(
      fc.record({ kind: fc.constant('pin' as const), link: fc.nat(39) }),
      fc.record({
        kind: fc.constant('move' as const),
        link: fc.nat(39),
        at: fc.integer({ min: 1, max: 35 }),
      }),
      fc.record({ kind: fc.constant('unpin' as const), link: fc.nat(39) }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(op, { maxLength: 60 }), async (ops) => {
        advance(61_000);
        await env.DB.prepare('UPDATE links SET pin_position = NULL WHERE user_id = ?')
          .bind(user.id)
          .run();
        for (const o of ops) {
          const id = ids[o.link]!;
          if (o.kind === 'unpin')
            await api('DELETE', `/api/v1/links/${id}/pin`, { as: user.session });
          else await pin(user, id, o.kind === 'move' ? o.at : undefined);
          const positions = (await pinned(user)).map(([, p]) => p);
          expect(positions).toEqual(positions.map((_, i) => i + 1));
          expect(positions.length).toBeLessThanOrEqual(30);
        }
      }),
      { numRuns: 15 },
    );
  }, 120_000);
});

import { describe, expect, it } from 'vitest';
import { api, seedLinks, signIn, type TestUser } from '../test/helpers';

async function target(user: TestUser, kind: 'workspace' | 'link'): Promise<string> {
  if (kind === 'link') {
    const [id = ''] = await seedLinks(user, [{ url: 'https://noted.example/' }]);
    return id;
  }
  return (await api('POST', '/api/v1/workspaces', { as: user.session, body: { name: 'Noted' } }))
    .json.id;
}

function path(kind: 'workspace' | 'link', id: string): string {
  return kind === 'link' ? `/api/v1/links/${id}` : `/api/v1/workspaces/${id}`;
}

const kinds = ['workspace', 'link'] as const;

describe('a note', () => {
  it.each(
    kinds.flatMap((kind) =>
      ['# Plan\n\n- book flights', '', 'é'.repeat(20_000), '😀'.repeat(20_000)].map((note) => ({
        kind,
        note,
      })),
    ),
  )('of up to 20,000 characters is stored exactly on a $kind', async ({ kind, note }) => {
    const user = await signIn();
    const id = await target(user, kind);
    const before = (await api('GET', path(kind, id), { as: user.session })).json;
    const r = await api('PATCH', path(kind, id), { as: user.session, body: { note } });
    expect(r.status).toBe(200);
    expect(r.json.note).toBe(note);
    const after = (await api('GET', path(kind, id), { as: user.session })).json;
    expect(after.note).toBe(note);
    for (const field of kind === 'link'
      ? ['title', 'last_used_at', 'use_count']
      : ['name', 'description']) {
      expect(after[field]).toEqual(before[field]);
    }
  });

  it.each(
    kinds.flatMap((kind) => [
      { kind, note: 'x'.repeat(20_001), error: 'note_too_long' },
      { kind, note: '😀'.repeat(20_001), error: 'note_too_long' },
      { kind, note: 42, error: 'invalid_note' },
      { kind, note: null, error: 'invalid_note' },
    ]),
  )('is refused on a $kind when it is $error', async ({ kind, note, error }) => {
    const user = await signIn();
    const id = await target(user, kind);
    await api('PATCH', path(kind, id), { as: user.session, body: { note: 'keep' } });
    const r = await api('PATCH', path(kind, id), { as: user.session, body: { note } });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe(error);
    expect(r.json.field).toBe('note');
    if (error === 'note_too_long') expect(r.json.message).toBe('note too long (20,000 characters)');
    expect((await api('GET', path(kind, id), { as: user.session })).json.note).toBe('keep');
  });
});

describe('a link in a list', () => {
  it.each([
    { note: '', preview: null },
    { note: '\n\n# Hotels\nmore', preview: 'Hotels' },
    { note: '- book flights', preview: 'book flights' },
    { note: 'Check prices <script>alert(1)</script>', preview: 'Check prices' },
    { note: 'y'.repeat(300), preview: 'y'.repeat(200) },
  ])('carries the preview $preview of its note, never the note', async ({ note, preview }) => {
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: 'https://listed.example/' }]);
    await api('PATCH', `/api/v1/links/${id}`, { as: user.session, body: { note } });
    const stream = await api('GET', '/api/v1/links', { as: user.session });
    expect(stream.json.items[0].note_preview).toBe(preview);
    expect('note' in stream.json.items[0]).toBe(false);
    expect((await api('GET', `/api/v1/links/${id}`, { as: user.session })).json.note).toBe(note);
  });

  it('carries the workspaces it is in, by name', async () => {
    const user = await signIn();
    const [id = ''] = await seedLinks(user, [{ url: 'https://member.example/' }]);
    for (const name of ['b', 'A']) {
      const w = (await api('POST', '/api/v1/workspaces', { as: user.session, body: { name } })).json
        .id;
      await api('POST', `/api/v1/workspaces/${w}/links`, {
        as: user.session,
        body: { link_id: id },
      });
    }
    const stream = await api('GET', '/api/v1/links', { as: user.session });
    expect(stream.json.items[0].workspaces.map((w: { name: string }) => w.name)).toEqual([
      'A',
      'b',
    ]);
    expect(stream.json.items[0].workspaces[0]).toEqual({ id: expect.any(String), name: 'A' });
  });
});

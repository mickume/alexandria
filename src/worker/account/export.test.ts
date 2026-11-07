import { describe, expect, it, vi } from 'vitest';
import { api, createToken, env, seedLinks, setNow, signIn, type TestUser } from '../test/helpers';
import { SELF } from 'cloudflare:test';
import { readerKey, snapshotKey } from '../fetcher/snapshots';

const PUBLIC_ORIGIN = 'https://alexandria.test';

/** Gives a link stored copies, as the fetch worker leaves them. */
async function storeCopies(user: TestUser, id: string, kind: 'html' | 'pdf') {
  await env.DB.prepare(
    "UPDATE links SET state = 'active', content_kind = ?, has_snapshot = 1, reader_empty = 0 WHERE id = ?",
  )
    .bind(kind, id)
    .run();
  await env.SNAPSHOTS.put(
    snapshotKey(user.id, id),
    kind === 'pdf' ? '%PDF-1.4 bytes' : '<html><body><p>Kept page</p></body></html>',
  );
  if (kind === 'html') {
    await env.SNAPSHOTS.put(
      readerKey(user.id, id),
      JSON.stringify({ title: 'T', byline: null, html: '<p>Kept page</p>' }),
    );
  }
  await env.DB.prepare(
    'INSERT OR REPLACE INTO link_texts (link_id, user_id, text) VALUES (?, ?, ?)',
  )
    .bind(id, user.id, 'Kept page')
    .run();
}

async function exportOf(user: TestUser) {
  const r = await api('GET', '/api/v1/export', { as: user.session });
  expect(r.status).toBe(200);
  return { r, body: r.json, text: await r.response.text() };
}

async function patch(user: TestUser, id: string, body: Record<string, unknown>) {
  const r = await api('PATCH', `/api/v1/links/${id}`, { as: user.session, body });
  expect(r.status).toBe(200);
}

async function workspace(user: TestUser, name: string, links: string[], note = '') {
  const r = await api('POST', '/api/v1/workspaces', { as: user.session, body: { name } });
  for (const link of links) {
    await api('POST', `/api/v1/workspaces/${r.json.id}/links`, {
      as: user.session,
      body: { link_id: link },
    });
  }
  if (note)
    await api('PATCH', `/api/v1/workspaces/${r.json.id}`, { as: user.session, body: { note } });
  return r.json.id as string;
}

describe('GET /api/v1/export', () => {
  it('returns the whole library as one document, as a download', async () => {
    setNow('2026-11-07T10:00:00.000Z');
    const user = await signIn('owner@example.test', 'Ada Owner');
    const [a, b, c] = await seedLinks(user, [
      { url: 'https://a.example' },
      { url: 'https://b.example' },
      { url: 'https://c.example' },
    ]);
    await patch(user, a!, { topic: 'Databases', tags: ['sql', 'postgres'] });
    await patch(user, b!, { topic: 'Cooking', tags: ['bread', 'sql'] });
    await patch(user, c!, { tags: ['yeast'] });
    await workspace(user, 'Research', [a!]);
    await workspace(user, 'Kitchen', [b!]);
    const { r, body, text } = await exportOf(user);
    expect(r.headers.get('Content-Type')).toMatch(/^application\/json/);
    expect(r.headers.get('Content-Disposition')).toBe(
      'attachment; filename="alexandria-export-2026-11-07.json"',
    );
    expect(body.format).toBe('alexandria-export');
    expect(body.version).toBe(1);
    expect(body.exported_at).toBe('2026-11-07T10:00:00.000Z');
    expect(body.user).toEqual({ email: 'owner@example.test', name: 'Ada Owner' });
    expect([
      body.links.length,
      body.workspaces.length,
      body.topics.length,
      body.tags.length,
    ]).toEqual([3, 2, 2, 4]);
    expect(text.endsWith('"complete":true}')).toBe(true);
  });

  it('gives every link, in every state, its API representation and its content URLs', async () => {
    const user = await signIn();
    const states = [
      'pending',
      'active',
      'active',
      'active',
      'unreachable',
      'dormant',
      'archived',
      'active',
      'active',
      'active',
      'active',
      'active',
      'active',
    ];
    const ids = await seedLinks(
      user,
      states.map((state, i) => ({
        url: `https://l${i}.example`,
        state,
        useCount: i === 12 ? 7 : 0,
      })),
    );
    await storeCopies(user, ids[1]!, 'html');
    await storeCopies(user, ids[2]!, 'pdf');
    await env.DB.prepare(
      `UPDATE links SET content_kind = 'other', notes = '["not a web page (image/png)"]' WHERE id = ?`,
    )
      .bind(ids[3])
      .run();
    await env.DB.prepare("UPDATE links SET archived_at = '2026-01-01T00:00:00.000Z' WHERE id = ?")
      .bind(ids[6])
      .run();
    await env.DB.prepare("UPDATE links SET dead_since = '2026-01-01T00:00:00.000Z' WHERE id = ?")
      .bind(ids[7])
      .run();
    await api('POST', `/api/v1/links/${ids[8]}/pin`, { as: user.session });
    await patch(user, ids[9]!, { title: 'Edited title', tags: ['mine'] });
    await patch(user, ids[10]!, { note: 'A note of mine.' });
    await workspace(user, 'One', [ids[11]!]);
    await workspace(user, 'Two', [ids[11]!]);
    const { body } = await exportOf(user);
    expect(body.links).toHaveLength(states.length);
    for (const [i, id] of ids.entries()) {
      const entries = body.links.filter((l: { id: string }) => l.id === id);
      expect(entries).toHaveLength(1);
      const { snapshot_url, reader_url, ...entry } = entries[0];
      const direct = await api('GET', `/api/v1/links/${id}`, { as: user.session });
      expect(entry).toEqual(direct.json);
      const stored = i === 1 || i === 2;
      expect(snapshot_url).toBe(
        stored ? `${PUBLIC_ORIGIN}/api/v1/export/links/${id}/snapshot` : null,
      );
      expect(reader_url).toBe(stored ? `${PUBLIC_ORIGIN}/api/v1/export/links/${id}/reader` : null);
    }
  });

  it('gives workspaces their links in order, and topics and tags their counts', async () => {
    const user = await signIn();
    const [a, b, c] = await seedLinks(user, [
      { url: 'https://a.example' },
      { url: 'https://b.example' },
      { url: 'https://c.example' },
    ]);
    const research = await workspace(user, 'Research', [b!, a!], 'Read these first.');
    await patch(user, a!, { topic: 'databases', tags: ['sql'] });
    await patch(user, b!, { topic: 'databases', tags: ['sql'] });
    await patch(user, c!, { tags: ['sql'] });
    const { body } = await exportOf(user);
    expect(body.workspaces).toEqual([
      {
        id: research,
        name: 'Research',
        description: '',
        note: 'Read these first.',
        link_ids: [b, a],
      },
    ]);
    expect(body.topics).toEqual([{ id: expect.any(String), name: 'databases', link_count: 2 }]);
    expect(body.tags).toEqual([{ id: expect.any(String), name: 'sql', link_count: 3 }]);
  });

  it('holds no key, token, session or import report, and nothing of another user', async () => {
    const a = await signIn('owner@example.test');
    const b = await signIn('other@example.test');
    const { FakeAi } = await import('../test/ai');
    new FakeAi();
    await api('PUT', '/api/v1/settings/ai', {
      as: a.session,
      body: { provider: 'anthropic', api_key: 'sk-ant-test-abcd1234' },
    });
    const tokens = [await createToken(a), await createToken(a)];
    await seedLinks(a, [{ url: 'https://mine.example' }]);
    await api('POST', '/api/v1/imports', {
      as: a.session,
      body: new TextEncoder().encode('https://imported.example\nnot-a-url'),
      headers: { 'Content-Type': 'text/plain' },
    });
    const [theirs] = await seedLinks(b, [{ url: 'https://theirs-secret.example' }]);
    await patch(b, theirs!, { topic: 'Their topic', tags: ['their-tag'], note: 'their note' });
    await workspace(b, 'Their workspace', [theirs!]);
    const { text } = await exportOf(a);
    const stored = await env.DB.prepare(
      'SELECT ai_key_ciphertext, ai_key_iv FROM users WHERE id = ?',
    )
      .bind(a.id)
      .first<{ ai_key_ciphertext: string; ai_key_iv: string }>();
    const hashes = await env.DB.prepare(
      'SELECT secret_hash AS h FROM tokens UNION SELECT id_hash FROM sessions',
    ).all<{ h: string }>();
    for (const secret of [
      'sk-ant-test-abcd1234',
      '1234',
      stored!.ai_key_ciphertext,
      stored!.ai_key_iv,
      ...tokens.map((t) => t.secret),
      ...hashes.results.map((r) => r.h),
      a.session,
      'not-a-url',
      theirs!,
      'theirs-secret',
      'Their topic',
      'their-tag',
      'their note',
      'Their workspace',
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('aborts the download when reading fails part-way', async () => {
    const user = await signIn();
    await seedLinks(
      user,
      Array.from({ length: 300 }, (_, i) => ({ url: `https://p${i}.example` })),
    );
    const prepare = env.DB.prepare.bind(env.DB);
    let pages = 0;
    const spy = vi.spyOn(env.DB, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('-- export links page') && ++pages === 3) {
        throw new Error('D1_ERROR: the third page failed');
      }
      return prepare(sql);
    });
    const response = await SELF.fetch(new URL('/api/v1/export', PUBLIC_ORIGIN), {
      headers: { Cookie: `alexandria_session=${user.session}` },
    });
    let text = '';
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    await expect(
      (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          text += decoder.decode(value, { stream: true });
        }
      })(),
    ).rejects.toBeTruthy();
    spy.mockRestore();
    expect(text).not.toContain('"complete":true');
    expect(() => JSON.parse(text)).toThrow();
  });
});

describe('the export of 20,000 links', () => {
  it('completes in under 60 seconds, streamed', { timeout: 600_000 }, async () => {
    const user = await signIn();
    const token = await createToken(user);
    const tags = Array.from({ length: 500 }, (_, i) => ({ id: `tag-${i}`, name: `tag${i}` }));
    const topics = Array.from({ length: 100 }, (_, i) => ({
      id: `topic-${i}`,
      name: `Topic ${i}`,
    }));
    const workspaces = Array.from({ length: 50 }, (_, i) => ({
      id: `ws-${i}`,
      name: `Workspace ${i}`,
    }));
    await env.DB.batch([
      ...tags.map((t) =>
        env.DB.prepare('INSERT INTO tags (id, user_id, name) VALUES (?, ?, ?)').bind(
          t.id,
          user.id,
          t.name,
        ),
      ),
      ...topics.map((t) =>
        env.DB.prepare('INSERT INTO topics (id, user_id, name) VALUES (?, ?, ?)').bind(
          t.id,
          user.id,
          t.name,
        ),
      ),
      ...workspaces.map((w) =>
        env.DB.prepare(
          'INSERT INTO workspaces (id, user_id, name, name_key, created_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(w.id, user.id, w.name, w.name.toLowerCase(), '2026-01-01T00:00:00.000Z'),
      ),
    ]);
    for (let start = 0; start < 20_000; start += 500) {
      const statements: D1PreparedStatement[] = [];
      for (let i = start; i < start + 500; i++) {
        const id = `link-${String(i).padStart(5, '0')}`;
        const at = new Date(Date.parse('2026-01-01T00:00:00.000Z') + i * 1000).toISOString();
        statements.push(
          env.DB.prepare(
            `INSERT INTO links (id, user_id, url, original_url, host, title, state, added_at,
               last_used_at, updated_at, topic_id)
             VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
          ).bind(
            id,
            user.id,
            `https://l${i}.example/`,
            `https://l${i}.example/`,
            `l${i}.example`,
            `Link ${i}`,
            at,
            at,
            at,
            topics[i % 100]!.id,
          ),
          env.DB.prepare('INSERT INTO link_tags (link_id, tag_id, position) VALUES (?, ?, 0)').bind(
            id,
            tags[i % 500]!.id,
          ),
          env.DB.prepare(
            'INSERT INTO workspace_links (workspace_id, link_id, position) VALUES (?, ?, ?)',
          ).bind(workspaces[i % 50]!.id, id, Math.floor(i / 50) + 1),
        );
      }
      await env.DB.batch(statements);
    }
    const t0 = performance.now();
    const response = await SELF.fetch(new URL('/api/v1/export', PUBLIC_ORIGIN), {
      headers: { Authorization: `Bearer ${token.secret}` },
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let chunks = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks += 1;
      text += decoder.decode(value, { stream: true });
    }
    const elapsed = performance.now() - t0;
    expect(chunks).toBeGreaterThan(10);
    const body = JSON.parse(text);
    expect(body.links).toHaveLength(20_000);
    expect(body.complete).toBe(true);
    expect(elapsed).toBeLessThan(60_000);
  });
});

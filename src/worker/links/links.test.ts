import { describe, expect, it } from 'vitest';
import { api, count, createToken, env, seedLinks, setNow, signIn } from '../test/helpers';

describe('adding a link', () => {
  it('stores a new pending link with its normalised URL and its host as title', async () => {
    const user = await signIn();
    const t = '2026-06-01T08:00:00.000Z';
    setNow(t);
    const input = 'https://example.com/article?utm_source=x';
    const r = await api('POST', '/api/v1/links', { as: user.session, body: { url: input } });
    expect(r.status).toBe(201);
    expect(r.json).toEqual({
      status: 'added',
      link: {
        id: expect.any(String),
        url: 'https://example.com/article',
        original_url: input,
        host: 'example.com',
        title: 'example.com',
        state: 'pending',
        added_at: t,
        last_used_at: t,
        use_count: 0,
        pinned: false,
        pin_position: null,
        final_url: null,
        http_status: null,
        description: null,
        favicon_url: null,
        language: null,
        fetched_at: null,
        state_reason: null,
        notes: [],
        content_kind: null,
        has_snapshot: false,
        updated_at: t,
        summary: null,
        tags: [],
        topic: null,
        enrichment_status: null,
        enrichment_reason: null,
        edited_fields: [],
        note_preview: null,
        workspaces: [],
        points: 60,
        expired_at: null,
        removal_at: null,
        dead_since: null,
        last_checked_at: null,
        last_check_result: null,
        decay_note: expect.any(String),
      },
    });
  });

  it.each([
    { label: 'the same user added it earlier', owner: 'self' as const },
    { label: 'only another user added it', owner: 'other' as const },
  ])('boosts or adds when $label', async ({ owner }) => {
    const user = await signIn('owner@example.test');
    const other = await signIn('other@example.test', 'Other');
    const [existing] = await seedLinks(owner === 'self' ? user : other, [
      { url: 'https://example.com/a', lastUsedAt: '2026-01-01T00:00:00.000Z', useCount: 4 },
    ]);
    const t = '2026-06-02T08:00:00.000Z';
    setNow(t);
    const r = await api('POST', '/api/v1/links', {
      as: user.session,
      body: { url: 'https://Example.com/a?utm_campaign=z' },
    });
    if (owner === 'self') {
      expect(r.status).toBe(200);
      expect(r.json.status).toBe('boosted');
      expect(r.json.link.id).toBe(existing);
      expect(r.json.link.use_count).toBe(4);
      expect(r.json.link.last_used_at).toBe(t);
      expect(await count('links', 'user_id = ?', user.id)).toBe(1);
    } else {
      expect(r.status).toBe(201);
      expect(r.json.status).toBe('added');
      expect(await count('links', 'user_id = ?', user.id)).toBe(1);
      expect(await count('links', "url = 'https://example.com/a'")).toBe(2);
    }
  });

  it.each([
    { body: { url: 'javascript:alert(1)' }, url: 'javascript:alert(1)' },
    { body: { url: 'http://localhost' }, url: 'http://localhost' },
    { body: {}, url: null },
  ])('refuses $body', async ({ body, url }) => {
    const user = await signIn();
    const r = await api('POST', '/api/v1/links', { as: user.session, body });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({
      error: 'invalid_url',
      field: 'url',
      url,
      message: 'not a valid web address',
    });
    expect(await count('links')).toBe(0);
  });

  it('stores exactly one link for concurrent adds of the same URL', async () => {
    const user = await signIn();
    const rs = await Promise.all(
      Array.from({ length: 10 }, () =>
        api('POST', '/api/v1/links', { as: user.session, body: { url: 'https://race.example' } }),
      ),
    );
    expect(await count('links', "url = 'https://race.example'")).toBe(1);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    const others = rs.filter((r) => r.status !== 201);
    expect(others).toHaveLength(9);
    for (const r of others) {
      expect(r.status).toBe(200);
      expect(r.json.status).toBe('boosted');
    }
  });

  it('works with a bearer token and no Origin, as the token’s user', async () => {
    const user = await signIn();
    const token = await createToken(user);
    const r = await api('POST', '/api/v1/links', {
      bearer: token.secret,
      body: { url: 'https://a.example' },
    });
    expect(r.status).toBe(201);
    const row = await env.DB.prepare('SELECT user_id FROM links WHERE id = ?')
      .bind(r.json.link.id)
      .first<{ user_id: string }>();
    expect(row?.user_id).toBe(user.id);
  });
});

describe('adding a batch of links', () => {
  it('adds and boosts in order, collapses repeats and lists the invalid inputs', async () => {
    const user = await signIn();
    await seedLinks(user, [
      { url: 'https://old.example', lastUsedAt: '2026-01-01T00:00:00.000Z' },
      { url: 'https://c.example', lastUsedAt: '2026-04-24T08:00:00.000Z', useCount: 2 },
    ]);
    setNow('2026-06-03T08:00:00.000Z');
    const r = await api('POST', '/api/v1/links/batch', {
      as: user.session,
      body: {
        urls: [
          'https://a.example',
          'nope',
          'https://b.example',
          'https://c.example',
          'https://a.example/',
        ],
      },
    });
    expect(r.status).toBe(200);
    const hosts = (links: { host: string }[]) => links.map((l) => l.host);
    expect(hosts(r.json.added)).toEqual(['a.example', 'b.example']);
    expect(hosts(r.json.boosted)).toEqual(['c.example']);
    expect(r.json.boosted[0]).toMatchObject({
      use_count: 2,
      points: 62,
      last_used_at: expect.stringMatching(/^2026-06-03T0[78]:/),
    });
    expect(r.json.invalid).toEqual([{ url: 'nope', error: 'invalid_url' }]);
    const order = await env.DB.prepare(
      'SELECT host FROM links WHERE user_id = ? ORDER BY last_used_at DESC, id DESC',
    )
      .bind(user.id)
      .all<{ host: string }>();
    expect(order.results.map((l) => l.host)).toEqual([
      'a.example',
      'b.example',
      'c.example',
      'old.example',
    ]);
    const single = await api('POST', '/api/v1/links', {
      as: user.session,
      body: { url: 'https://c.example' },
    });
    expect(single.json.link).toMatchObject({
      use_count: 2,
      last_used_at: '2026-06-03T08:00:00.000Z',
      points: 62,
    });
  });

  it.each([
    { label: 'no urls', body: {}, error: 'no_urls' },
    { label: 'an empty list', body: { urls: [] }, error: 'no_urls' },
    {
      label: '101 URLs',
      body: { urls: Array.from({ length: 101 }, (_, i) => `https://u${i}.example`) },
      error: 'too_many_urls',
    },
  ])('refuses $label', async ({ body, error }) => {
    const user = await signIn();
    const r = await api('POST', '/api/v1/links/batch', { as: user.session, body });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe(error);
    expect(r.json.field).toBe('urls');
    expect(typeof r.json.message).toBe('string');
    expect(await count('links')).toBe(0);
  });

  it('accepts exactly 100 URLs', async () => {
    const user = await signIn();
    const urls = Array.from({ length: 100 }, (_, i) => `https://u${i}.example`);
    const r = await api('POST', '/api/v1/links/batch', { as: user.session, body: { urls } });
    expect(r.status).toBe(200);
    expect(r.json.added).toHaveLength(100);
  });
});

describe('a full library', () => {
  it('refuses new URLs at 20,000 links but still boosts existing ones', async () => {
    const user = await signIn();
    await seedLinks(
      user,
      Array.from({ length: 20_000 }, (_, i) => ({ url: `https://l${i}.example` })),
    );
    const r = await api('POST', '/api/v1/links', {
      as: user.session,
      body: { url: 'https://new.example' },
    });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: 'library_full', message: 'library full (20,000 links)' });
    const r2 = await api('POST', '/api/v1/links', {
      as: user.session,
      body: { url: 'https://l5.example' },
    });
    expect(r2.status).toBe(200);
    expect(r2.json.status).toBe('boosted');
    const r3 = await api('POST', '/api/v1/links/batch', {
      as: user.session,
      body: { urls: ['https://new.example', 'https://l7.example'] },
    });
    expect(r3.json.invalid).toEqual([{ url: 'https://new.example', error: 'library_full' }]);
    expect(r3.json.boosted.map((l: { url: string }) => l.url)).toEqual(['https://l7.example']);
    expect(await count('links', 'user_id = ?', user.id)).toBe(20_000);
  }, 60_000);
});

describe('reading a link', () => {
  it('returns every stored field, the original URL and the normalised one', async () => {
    const user = await signIn();
    const added = await api('POST', '/api/v1/links', {
      as: user.session,
      body: { url: 'https://example.com/a?utm_source=x' },
    });
    const r = await api('GET', `/api/v1/links/${added.json.link.id}`, { as: user.session });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      id: added.json.link.id,
      url: 'https://example.com/a',
      original_url: 'https://example.com/a?utm_source=x',
      host: 'example.com',
      title: 'example.com',
      state: 'pending',
      added_at: expect.any(String),
      last_used_at: expect.any(String),
      use_count: 0,
      pinned: false,
      pin_position: null,
      final_url: null,
      http_status: null,
      description: null,
      favicon_url: null,
      language: null,
      fetched_at: null,
      state_reason: null,
      notes: [],
      content_kind: null,
      has_snapshot: false,
      updated_at: expect.any(String),
      summary: null,
      tags: [],
      topic: null,
      enrichment_status: null,
      enrichment_reason: null,
      edited_fields: [],
      note_preview: null,
      workspaces: [],
      note: '',
      points: 60,
      expired_at: null,
      removal_at: null,
      dead_since: null,
      last_checked_at: null,
      last_check_result: null,
      decay_note: expect.any(String),
    });
  });
});

describe('deleting a link', () => {
  it('removes it and its uses at once, closes the pin gap, and lets the URL be added again', async () => {
    const user = await signIn();
    const add = (url: string) => api('POST', '/api/v1/links', { as: user.session, body: { url } });
    const first = (await add('https://first.example')).json.link.id;
    const id = (await add('https://gone.example')).json.link.id;
    const last = (await add('https://last.example')).json.link.id;
    for (const l of [first, id, last]) {
      await api('POST', `/api/v1/links/${l}/pin`, { as: user.session });
    }
    await api('GET', `/api/v1/links/${id}/open`, { as: user.session });
    await api('GET', `/api/v1/links/${id}/open`, { as: user.session });

    const r = await api('DELETE', `/api/v1/links/${id}`, { as: user.session });
    expect(r.status).toBe(204);
    expect((await api('GET', `/api/v1/links/${id}`, { as: user.session })).status).toBe(404);
    expect(await count('link_uses', 'link_id = ?', id)).toBe(0);
    const stream = await api('GET', '/api/v1/links', { as: user.session });
    expect(
      stream.json.items.map((l: { id: string; pin_position: number }) => [l.id, l.pin_position]),
    ).toEqual([
      [first, 1],
      [last, 2],
    ]);
    const again = await add('https://gone.example');
    expect(again.status).toBe(201);
    expect(again.json.status).toBe('added');
    expect(again.json.link.id).not.toBe(id);
  });
});

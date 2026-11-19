import { describe, expect, it } from 'vitest';
import { FakeOrigin } from '../test/origin';
import { onOutbound, outboundRequests } from '../test/outbound';
import {
  deliverFetches,
  env,
  recordFetchQueue,
  runEveryMinute,
  seedLinks,
  setNow,
  signIn,
  type TestUser,
} from '../test/helpers';
import { retrieveStoredLinks } from './backfill';

const REPO = {
  name: 'widget',
  full_name: 'acme/widget',
  description: 'Widgets',
  html_url: 'https://github.com/acme/widget',
};

/** Answers GitHub's API for acme/widget, with its README `readme`. */
function fakeGitHub(readme = 'The README.'): void {
  onOutbound('https://api.github.com', (request) => {
    const path = new URL(request.url).pathname;
    if (path === '/repos/acme/widget') return Response.json(REPO);
    if (path === '/repos/acme/widget/readme') return new Response(readme);
    return new Response('not found', { status: 404 });
  });
}

/** Seeds `n` active links to distinct GitHub repositories. */
function repoLinks(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    url: `https://github.com/acme/repo-${String(i).padStart(2, '0')}`,
    state: 'active',
  }));
}

function link(id: string) {
  return env.DB.prepare(
    'SELECT retrieval_seen, enrichment_status, last_used_at, use_count, site FROM links WHERE id = ?',
  )
    .bind(id)
    .first<{
      retrieval_seen: string | null;
      enrichment_status: string | null;
      last_used_at: string;
      use_count: number;
      site: string | null;
    }>();
}

describe('the one-time retrieval of stored links', () => {
  it('sends the claimed links of every user, 20 a minute, each once', async () => {
    const sent = recordFetchQueue();
    const ada = await signIn();
    const bob = await signIn('bob@example.test', 'Bob');
    const adas = await seedLinks(ada, [
      ...repoLinks(15),
      { url: 'https://github.com/acme', state: 'active' },
      { url: 'https://github.com/acme/pending', state: 'pending' },
      { url: 'https://example.com/acme/widget', state: 'active' },
    ]);
    const bobs = await seedLinks(bob, [
      ...repoLinks(7).map((l) => ({ ...l, state: 'archived' })),
      { url: 'https://github.com/acme/expired', state: 'expired' },
    ]);
    await runEveryMinute();
    expect(sent).toHaveLength(20);
    for (const m of sent) {
      expect(m.body).toMatchObject({ refresh: true, backfill: true });
    }
    expect(await retrieveStoredLinks(env)).toBe(3);
    expect(await retrieveStoredLinks(env)).toBe(0);
    const ids = sent.map((m) => m.body.link_id).sort();
    expect(ids).toEqual([...adas.slice(0, 15), ...bobs].sort());
    // The owner page was read, and is not read again.
    expect((await link(adas[15]!))?.retrieval_seen).toBe('github');
    expect((await link(adas[16]!))?.retrieval_seen).toBe(null);
    expect((await link(adas[17]!))?.retrieval_seen).toBe(null);
  });

  it('leaves out links already retrieved, of an account being deleted, or while imports wait', async () => {
    const sent = recordFetchQueue();
    const ada = await signIn();
    const [retrieved, waiting] = await seedLinks(ada, repoLinks(2));
    await env.DB.prepare(`UPDATE links SET site = ? WHERE id = ?`)
      .bind(JSON.stringify({ retriever: 'github', kind: 'repository', facts: [] }), retrieved)
      .run();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO imports (id, user_id, created_at, url_lines, added, duplicates, invalid,
           not_imported, invalid_lines, duplicate_lines)
         VALUES ('i1', ?, '2026-01-01T00:00:00.000Z', 1, 1, 0, 0, 0, '[]', '[]')`,
      ).bind(ada.id),
      env.DB.prepare(
        `INSERT INTO import_links (import_id, link_id, line) VALUES ('i1', ?, 1)`,
      ).bind(waiting),
    ]);
    expect(await retrieveStoredLinks(env)).toBe(0);
    await env.DB.prepare('UPDATE import_links SET dispatched_at = ?').bind('2026-01-01').run();
    await env.DB.prepare('UPDATE users SET deletion_requested_at = ?').bind('2026-01-01').run();
    expect(await retrieveStoredLinks(env)).toBe(0);
    await env.DB.prepare('UPDATE users SET deletion_requested_at = NULL').run();
    expect(await retrieveStoredLinks(env)).toBe(1);
    expect(sent.map((m) => m.body.link_id)).toEqual([waiting]);
  });

  it('retrieves YouTube videos only once a YouTube key is set', async () => {
    const key = env.YOUTUBE_API_KEY;
    try {
      const sent = recordFetchQueue();
      const ada = await signIn();
      await seedLinks(ada, [{ url: 'https://youtu.be/dQw4w9WgXcQ', state: 'active' }]);
      env.YOUTUBE_API_KEY = undefined;
      expect(await retrieveStoredLinks(env)).toBe(0);
      env.YOUTUBE_API_KEY = 'yt-key';
      expect(await retrieveStoredLinks(env)).toBe(1);
      expect(sent).toHaveLength(1);
    } finally {
      env.YOUTUBE_API_KEY = key;
    }
  });
});

describe('a link the one-time retrieval sent', () => {
  async function sendOne(user: TestUser, url = 'https://github.com/acme/widget') {
    const [id] = await seedLinks(user, [{ url, state: 'active' }]);
    const sent = recordFetchQueue();
    await retrieveStoredLinks(env);
    expect(sent).toHaveLength(1);
    return { id: id!, message: sent[0]!.body };
  }

  it('waits an hour, without fetching the page, when GitHub’s limit is spent', async () => {
    setNow('2026-11-17T10:00:00.000Z');
    const ada = await signIn();
    const { id, message } = await sendOne(ada);
    onOutbound('https://api.github.com', () => new Response('slow down', { status: 429 }));
    await deliverFetches([message]);
    expect(outboundRequests.map((r) => new URL(r.url).host)).toEqual(['api.github.com']);
    expect((await link(id))?.retrieval_seen).toBe(null);
    const sent = recordFetchQueue();
    setNow('2026-11-17T10:59:00.000Z');
    expect(await retrieveStoredLinks(env)).toBe(0);
    setNow('2026-11-17T11:01:00.000Z');
    expect(await retrieveStoredLinks(env)).toBe(1);
    expect(sent.map((m) => m.body.link_id)).toEqual([id]);
  });

  it('falls back to the page on any other failure, and is done', async () => {
    const ada = await signIn();
    const { id, message } = await sendOne(ada);
    onOutbound('https://api.github.com', () => new Response('down', { status: 503 }));
    new FakeOrigin().page(
      'https://github.com/acme/widget',
      '<html><head><title>GitHub - acme/widget: Widgets · GitHub</title></head></html>',
    );
    await deliverFetches([message]);
    expect((await link(id))?.retrieval_seen).toBe('github');
    expect(await retrieveStoredLinks(env)).toBe(0);
  }, 15_000);

  it('records no use, and is enriched again only when its text changed', async () => {
    const ada = await signIn();
    const { id, message } = await sendOne(ada);
    const before = await link(id);
    fakeGitHub();
    await deliverFetches([message]);
    const first = await link(id);
    expect(first?.site).not.toBe(null);
    expect(first?.enrichment_status).toBe('no_key');
    expect(first?.last_used_at).toBe(before?.last_used_at);
    expect(first?.use_count).toBe(0);
    await env.DB.prepare(`UPDATE links SET enrichment_status = 'enriched' WHERE id = ?`)
      .bind(id)
      .run();
    await deliverFetches([message]);
    expect((await link(id))?.enrichment_status).toBe('enriched');
  }, 15_000);
});

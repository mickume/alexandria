import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeOrigin } from '../test/origin';
import { onOutbound, outboundRequests } from '../test/outbound';
import {
  addAndFetch,
  api,
  deliverFetches,
  env,
  recordEnrichQueue,
  signIn,
  type TestUser,
} from '../test/helpers';
import { setApiTimeout } from './api';
import { clockDuration, compactCount, describe as describeText } from './facts';
import { findRetriever } from './registry';

const GITHUB_API = 'https://api.github.com';
const YOUTUBE_API = 'https://www.googleapis.com';
const VIDEO = 'dQw4w9WgXcQ';

const REPO = {
  name: 'widget',
  full_name: 'acme/widget',
  owner: { login: 'acme' },
  description: 'Widgets for everyone',
  stargazers_count: 12_345,
  language: 'TypeScript',
  topics: ['widgets', 'ui'],
  license: { spdx_id: 'MIT' },
  archived: false,
  pushed_at: '2026-10-01T12:00:00Z',
  html_url: 'https://github.com/acme/widget',
};
const README = '# Widget\n\nWidgets are assembled from frobnicators.';

type Answer = Response | (() => Response | Promise<Response>);

/**
 * Answers GitHub's API: `routes` maps a path (such as /repos/acme/widget) to
 * an answer; any other path is 404.
 */
function fakeGitHub(routes: Record<string, Answer>): void {
  onOutbound(GITHUB_API, (request) => {
    const answer = routes[new URL(request.url).pathname];
    if (!answer) return Response.json({ message: 'Not Found' }, { status: 404 });
    return typeof answer === 'function' ? answer() : answer.clone();
  });
}

function repoRoutes(repo: object = REPO, readme: Answer = new Response(README)) {
  return { '/repos/acme/widget': Response.json(repo), '/repos/acme/widget/readme': readme };
}

/** Answers YouTube's videos endpoint with `answer`, whatever is asked. */
function fakeYouTube(answer: Answer): void {
  onOutbound(YOUTUBE_API, () => (typeof answer === 'function' ? answer() : answer.clone()));
}

const VIDEO_ITEM = {
  snippet: {
    title: 'Never Gonna Give You Up',
    description: 'The official video.\nRemastered in 4K.',
    channelTitle: 'Rick Astley',
    publishedAt: '2009-10-25T06:57:33Z',
    defaultAudioLanguage: 'en',
    thumbnails: {
      default: { url: 'https://i.ytimg.com/vi/x/default.jpg' },
      maxres: { url: 'https://i.ytimg.com/vi/x/maxresdefault.jpg' },
    },
  },
  contentDetails: { duration: 'PT3M33S' },
};

/** The link as the API shows it, and its stored text and last history event. */
async function stored(user: TestUser, id: string) {
  const link = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
  const text = await env.DB.prepare('SELECT text FROM link_texts WHERE link_id = ?')
    .bind(id)
    .first<{ text: string }>();
  const event = await env.DB.prepare(
    'SELECT outcome, http_status, reason FROM link_events WHERE link_id = ? ORDER BY at DESC, rowid DESC',
  )
    .bind(id)
    .first<{ outcome: string; http_status: number | null; reason: string | null }>();
  return { link, text: text?.text ?? null, event };
}

/** A GitHub page as the site serves it, for the fallback to fetch. */
function githubPage(url: string, title: string): FakeOrigin {
  return new FakeOrigin().page(
    url,
    `<!doctype html><html><head><title>${title}</title></head><body><article><p>${'The page itself. '.repeat(30)}</p></article></body></html>`,
  );
}

describe('which retriever claims an address', () => {
  it.each([
    ['https://github.com/acme/widget', 'github', 'repository'],
    ['https://www.github.com/acme/widget/', 'github', 'repository'],
    ['https://github.com/acme/widget/issues/12', 'github', 'issue'],
    ['https://github.com/acme/widget/pull/7/files', 'github', 'issue'],
    ['https://github.com/acme', null, null],
    ['https://github.com/acme/widget/blob/main/README.md', null, null],
    ['https://github.com/settings/profile', null, null],
    ['https://github.com/orgs/acme', null, null],
    ['https://gist.github.com/acme/abc', null, null],
    [`https://www.youtube.com/watch?v=${VIDEO}`, 'youtube', undefined],
    [`https://m.youtube.com/watch?v=${VIDEO}&t=42`, 'youtube', undefined],
    [`https://music.youtube.com/watch?v=${VIDEO}`, 'youtube', undefined],
    [`https://youtu.be/${VIDEO}`, 'youtube', undefined],
    [`https://youtube.com/shorts/${VIDEO}`, 'youtube', undefined],
    [`https://www.youtube.com/live/${VIDEO}`, 'youtube', undefined],
    [`https://www.youtube.com/embed/${VIDEO}`, 'youtube', undefined],
    ['https://www.youtube.com/@channel', null, null],
    ['https://www.youtube.com/watch?v=short', null, null],
    ['https://www.youtube.com/playlist?list=PL123', null, null],
    ['https://example.com/acme/widget', null, null],
  ])('%s is claimed by %s', (url, retriever, kind) => {
    const found = findRetriever({ ...env, YOUTUBE_API_KEY: 'key' }, url);
    expect(found?.retriever.name ?? null).toBe(retriever);
    if (kind !== undefined) {
      expect((found?.claim as { kind?: string } | undefined)?.kind ?? null).toBe(kind);
    }
  });

  it('claims no YouTube address without a YouTube key', () => {
    expect(findRetriever({ ...env, YOUTUBE_API_KEY: undefined }, `https://youtu.be/${VIDEO}`)).toBe(
      null,
    );
  });
});

describe('the facts as they are shown', () => {
  it.each([
    [999, '999'],
    [1_000, '1k'],
    [1_234, '1.2k'],
    [12_345, '12.3k'],
    [999_999, '999.9k'],
    [1_234_567, '1.2M'],
  ])('counts %i as %s', (n, shown) => {
    expect(compactCount(n)).toBe(shown);
  });

  it.each([
    ['PT3M33S', '3:33'],
    ['PT45S', '0:45'],
    ['PT1H2M3S', '1:02:03'],
    ['P1DT2H', '26:00:00'],
    ['P0D', null],
    ['nonsense', null],
  ])('reads the duration %s as %s', (iso, shown) => {
    expect(clockDuration(iso)).toBe(shown);
  });

  it('cuts a description longer than 300 characters at a word, with an ellipsis', () => {
    const long = `${'word '.repeat(100)}`;
    const cut = describeText(long)!;
    expect(cut.length).toBeLessThanOrEqual(300);
    expect(cut.endsWith('word…')).toBe(true);
    expect(describeText('  a\n short   one ')).toBe('a short one');
    expect(describeText('   ')).toBe(null);
  });
});

describe('retrieving a GitHub link', () => {
  it('stores a repository as GitHub’s API describes it, with its README as text', async () => {
    fakeGitHub(repoRoutes());
    const user = await signIn();
    const { id } = await addAndFetch(user, 'https://github.com/acme/widget', {
      GITHUB_TOKEN: 'ghp_test',
    });
    const { link, text, event } = await stored(user, id);
    expect(link).toMatchObject({
      state: 'active',
      title: 'widget: Widgets for everyone',
      description: 'Widgets for everyone',
      final_url: 'https://github.com/acme/widget',
      favicon_url: 'https://github.com/favicon.ico',
      http_status: 200,
      content_kind: 'html',
      notes: ['retrieved through the GitHub API'],
    });
    expect(link.site).toMatchObject({ retriever: 'github', kind: 'repository' });
    expect(link.site.retrieved_at).toBe(link.fetched_at);
    expect(link.site.facts).toEqual([
      { key: 'stars', label: 'Stars', value: '12.3k', card: true },
      { key: 'language', label: 'Language', value: 'TypeScript', card: true },
      { key: 'owner', label: 'Owner', value: 'acme', card: false },
      { key: 'topics', label: 'Topics', value: 'widgets, ui', card: false },
      { key: 'license', label: 'License', value: 'MIT', card: false },
      { key: 'pushed', label: 'Last push', value: '2026-10-01', card: false },
    ]);
    expect(text).toBe(README);
    expect(event).toEqual({ outcome: 'ok', http_status: 200, reason: null });
    // Nothing went to the page itself; the API was asked with the token and the fetcher's name.
    expect(outboundRequests.map((r) => new URL(r.url).host)).toEqual([
      'api.github.com',
      'api.github.com',
    ]);
    for (const r of outboundRequests) {
      expect(r.headers.get('Authorization')).toBe('Bearer ghp_test');
      expect(r.headers.get('User-Agent')).toBe(
        `Alexandria/1.0 (+${env.PUBLIC_ORIGIN}/about/fetcher)`,
      );
    }
  }, 15_000);

  it('marks an archived repository, and calls GitHub without a token when none is set', async () => {
    fakeGitHub(repoRoutes({ ...REPO, description: null, archived: true, language: null }));
    const user = await signIn();
    const { id } = await addAndFetch(user, 'https://github.com/acme/widget');
    const { link } = await stored(user, id);
    expect(link.title).toBe('widget');
    expect(link.description).toBe(null);
    expect(link.site.facts.filter((f: { card: boolean }) => f.card)).toEqual([
      { key: 'stars', label: 'Stars', value: '12.3k', card: true },
      { key: 'archived', label: 'Archived', value: 'yes', card: true },
    ]);
    expect(outboundRequests[0]!.headers.get('Authorization')).toBe(null);
  }, 15_000);

  it.each([
    { readme: new Response('missing', { status: 404 }), text: null, reason: null },
    {
      readme: new Response('down', { status: 502 }),
      text: null,
      reason: 'GitHub API: README could not be read',
    },
  ])(
    'retrieves a repository whose README answers $readme.status',
    async ({ readme, text, reason }) => {
      fakeGitHub(repoRoutes(REPO, readme));
      const user = await signIn();
      const { id } = await addAndFetch(user, 'https://github.com/acme/widget');
      const after = await stored(user, id);
      expect(after.link.title).toBe('widget: Widgets for everyone');
      expect(after.text).toBe(text);
      expect(after.event).toEqual({ outcome: 'ok', http_status: 200, reason });
    },
    15_000,
  );

  it.each([
    {
      url: 'https://github.com/acme/widget/issues/12',
      issue: { state: 'open', comments: 1 },
      title: 'It breaks · acme/widget#12',
      kind: 'issue',
      state: 'open issue',
      comments: '1 comment',
    },
    {
      url: 'https://github.com/acme/widget/pull/12/files',
      issue: { state: 'closed', comments: 3, pull_request: { merged_at: '2026-10-02T00:00:00Z' } },
      title: 'It breaks · acme/widget#12',
      kind: 'pull_request',
      state: 'merged pull request',
      comments: '3 comments',
    },
    {
      url: 'https://github.com/acme/widget/pull/12',
      issue: { state: 'closed', comments: 0, pull_request: { merged_at: null } },
      title: 'It breaks · acme/widget#12',
      kind: 'pull_request',
      state: 'closed pull request',
      comments: '0 comments',
    },
  ])('stores $state from its body', async ({ url, issue, title, kind, state, comments }) => {
    fakeGitHub({
      '/repos/acme/widget/issues/12': Response.json({
        number: 12,
        title: 'It breaks',
        body: 'Steps to reproduce: press the frobnicator.',
        user: { login: 'ada' },
        created_at: '2026-09-30T08:00:00Z',
        html_url: `https://github.com/acme/widget/${kind === 'issue' ? 'issues' : 'pull'}/12`,
        ...issue,
      }),
    });
    const user = await signIn();
    const { id } = await addAndFetch(user, url);
    const after = await stored(user, id);
    expect(after.link.title).toBe(title);
    expect(after.link.description).toBe('Steps to reproduce: press the frobnicator.');
    expect(after.text).toBe('Steps to reproduce: press the frobnicator.');
    expect(after.link.site.kind).toBe(kind);
    expect(after.link.site.facts).toEqual([
      { key: 'state', label: 'State', value: state, card: true },
      { key: 'comments', label: 'Comments', value: comments, card: true },
      { key: 'author', label: 'Author', value: 'ada', card: false },
      { key: 'opened', label: 'Opened', value: '2026-09-30', card: false },
    ]);
  });

  it('keeps a title the owner edited', async () => {
    fakeGitHub(repoRoutes());
    const user = await signIn();
    const { id } = await addAndFetch(user, 'https://github.com/acme/widget');
    await api('PATCH', `/api/v1/links/${id}`, { as: user.session, body: { title: 'Mine' } });
    await deliverFetches([{ user_id: user.id, link_id: id, refresh: true }]);
    expect((await stored(user, id)).link.title).toBe('Mine');
  }, 15_000);
});

describe('when a retriever cannot answer', () => {
  afterEach(() => setApiTimeout(null));

  it.each([
    { label: '503', answer: () => new Response('down', { status: 503 }), failure: 'unreachable' },
    {
      label: 'a connection that fails',
      answer: () => {
        throw new Error('Network connection lost.');
      },
      failure: 'unreachable',
    },
    { label: '429', answer: () => new Response('slow', { status: 429 }), failure: 'rate limited' },
    {
      label: '403 with the limit spent',
      answer: () =>
        Response.json(
          { message: 'API rate limit exceeded' },
          { status: 403, headers: { 'x-ratelimit-remaining': '0' } },
        ),
      failure: 'rate limited',
    },
    {
      label: '401',
      answer: () => Response.json({ message: 'Bad credentials' }, { status: 401 }),
      failure: 'key refused',
    },
    {
      label: '403',
      answer: () => Response.json({ message: 'Forbidden' }, { status: 403 }),
      failure: 'key refused',
    },
    {
      label: '404',
      answer: () => Response.json({ message: 'Not Found' }, { status: 404 }),
      failure: 'not found',
    },
    {
      label: 'a body that is not JSON',
      answer: () => new Response('<html>'),
      failure: 'unusable answer',
    },
    {
      label: 'a redirect',
      answer: () => new Response(null, { status: 301, headers: { Location: '/repositories/1' } }),
      failure: 'unusable answer',
    },
    {
      label: 'no answer in time',
      answer: () => new Promise<Response>(() => {}),
      failure: 'timed out',
    },
  ])(
    'fetches the page instead after $label, and says why',
    async ({ answer, failure }) => {
      setApiTimeout(200);
      fakeGitHub({ '/repos/acme/widget': answer as Answer });
      githubPage('https://github.com/acme/widget', 'GitHub - acme/widget: From the page · GitHub');
      const user = await signIn();
      const { id } = await addAndFetch(user, 'https://github.com/acme/widget');
      const { link, event } = await stored(user, id);
      expect(link.state).toBe('active');
      expect(link.title).toBe('widget: From the page');
      expect(link.site).toBe(null);
      expect(link.notes).toEqual([]);
      expect(event).toEqual({
        outcome: 'ok',
        http_status: 200,
        reason: `GitHub API: ${failure}; fetched as the page`,
      });
    },
    15_000,
  );

  it('fails as a page fetch fails when the page cannot be fetched either', async () => {
    fakeGitHub({ '/repos/acme/widget': new Response('down', { status: 503 }) });
    new FakeOrigin().status('https://github.com/acme/widget', 500);
    const user = await signIn();
    const { id } = await addAndFetch(user, 'https://github.com/acme/widget');
    const { link, event } = await stored(user, id);
    expect(link.state).toBe('pending');
    expect(link.state_reason).toBe('HTTP 500');
    expect(event).toMatchObject({ outcome: 'failed', reason: 'HTTP 500' });
  }, 15_000);

  it('keeps the facts of an earlier retrieval when a refresh falls back', async () => {
    fakeGitHub(repoRoutes());
    const user = await signIn();
    const { id } = await addAndFetch(user, 'https://github.com/acme/widget');
    const before = (await stored(user, id)).link.site;
    fakeGitHub({ '/repos/acme/widget': new Response('down', { status: 503 }) });
    githubPage('https://github.com/acme/widget', 'GitHub - acme/widget: From the page · GitHub');
    await deliverFetches([{ user_id: user.id, link_id: id, refresh: true }]);
    const after = await stored(user, id);
    expect(after.link.title).toBe('widget: From the page');
    expect(after.link.site).toEqual(before);
  }, 15_000);
});

describe('retrieving a YouTube video', () => {
  const key = env.YOUTUBE_API_KEY;
  beforeEach(() => {
    env.YOUTUBE_API_KEY = 'yt-key';
  });
  afterEach(() => {
    env.YOUTUBE_API_KEY = key;
  });

  it('stores a video as YouTube’s API describes it, with its description as text', async () => {
    fakeYouTube(Response.json({ items: [VIDEO_ITEM] }));
    const user = await signIn();
    const { id } = await addAndFetch(user, `https://youtu.be/${VIDEO}`);
    const { link, text } = await stored(user, id);
    expect(link).toMatchObject({
      title: 'Never Gonna Give You Up',
      description: 'The official video. Remastered in 4K.',
      final_url: `https://www.youtube.com/watch?v=${VIDEO}`,
      language: 'en',
      notes: ['retrieved through the YouTube API'],
    });
    expect(link.site).toMatchObject({ retriever: 'youtube', kind: 'video' });
    expect(link.site.facts).toEqual([
      { key: 'channel', label: 'Channel', value: 'Rick Astley', card: true },
      { key: 'duration', label: 'Duration', value: '3:33', card: true },
      { key: 'published', label: 'Published', value: '2009-10-25', card: false },
      {
        key: 'thumbnail',
        label: 'Thumbnail',
        value: 'https://i.ytimg.com/vi/x/maxresdefault.jpg',
        card: false,
      },
    ]);
    expect(text).toBe('The official video.\nRemastered in 4K.');
    const asked = new URL(outboundRequests[0]!.url);
    expect(asked.pathname).toBe('/youtube/v3/videos');
    expect(Object.fromEntries(asked.searchParams)).toEqual({
      part: 'snippet,contentDetails',
      id: VIDEO,
      key: 'yt-key',
    });
  });

  it.each([
    {
      label: 'an empty list',
      answer: Response.json({ items: [] }),
      failure: 'not found',
    },
    {
      label: 'a spent quota',
      answer: Response.json(
        { error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } },
        { status: 403 },
      ),
      failure: 'rate limited',
    },
    {
      label: 'an invalid key',
      answer: Response.json(
        { error: { code: 400, message: 'API key not valid.', errors: [{ reason: 'keyInvalid' }] } },
        { status: 400 },
      ),
      failure: 'key refused',
    },
    {
      label: 'another 400',
      answer: Response.json(
        { error: { code: 400, errors: [{ reason: 'badRequest' }] } },
        { status: 400 },
      ),
      failure: 'unusable answer',
    },
  ])('fetches the page instead after $label', async ({ answer, failure }) => {
    fakeYouTube(answer);
    new FakeOrigin().page(
      `https://www.youtube.com/watch?v=${VIDEO}`,
      '<!doctype html><html><head><title>A video - YouTube</title></head><body></body></html>',
    );
    const user = await signIn();
    const { id } = await addAndFetch(user, `https://www.youtube.com/watch?v=${VIDEO}`);
    const { link, event } = await stored(user, id);
    expect(link.title).toBe('A video');
    expect(event?.reason).toBe(`YouTube API: ${failure}; fetched as the page`);
  });
});

describe('a snapshot of a claimed address', () => {
  it('stores the API’s metadata and the page’s article as the snapshot', async () => {
    fakeGitHub(repoRoutes());
    const user = await signIn();
    const { id } = await addAndFetch(user, 'https://github.com/acme/widget');
    githubPage('https://github.com/acme/widget', 'GitHub - acme/widget: From the page · GitHub');
    recordEnrichQueue();
    await deliverFetches([{ user_id: user.id, link_id: id, refresh: true, snapshot: true }]);
    const { link, text } = await stored(user, id);
    expect(link.title).toBe('widget: Widgets for everyone');
    expect(text).toBe(README);
    expect(link.has_snapshot).toBe(true);
    const snapshot = await api('GET', `/api/v1/links/${id}/snapshot`, { as: user.session });
    expect(snapshot.json.html).toContain('The page itself.');
  }, 15_000);
});

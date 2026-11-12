import { describe, expect, it } from 'vitest';
import { FakeOrigin } from '../test/origin';
import { addAndFetch, api, env, runEveryMinute, seedLinks, setNow, signIn } from '../test/helpers';
import { blogArticle } from './fixtures/pages';
import { applyTitleRules, cleanTitle, compileTitleRules } from './titles';

const REPO_TITLE = 'GitHub - owner/repo: A tool for keeping links · GitHub';

describe('cleaning a title', () => {
  it.each([
    ['https://github.com/owner/repo', REPO_TITLE, 'repo: A tool for keeping links'],
    ['https://github.com/owner/repo/', 'GitHub - owner/repo', 'owner/repo'],
    [
      'https://github.com/owner/repo/issues/1',
      'Links vanish · Issue #1 · owner/repo · GitHub',
      'Links vanish · owner/repo#1',
    ],
    [
      'https://github.com/owner/repo/issues/2',
      'api/v1: Sort by date · Issue #2 · owner/repo · GitHub',
      'api/v1: Sort by date · owner/repo#2',
    ],
    [
      'https://github.com/owner/repo/pull/3/files',
      'Sort by date by ada-writer · Pull Request #3 · owner/repo · GitHub',
      'Sort by date · owner/repo#3',
    ],
    [
      'https://github.com/owner/repo/pull/4',
      'Bump hono by dependabot[bot] · Pull Request #4 · owner/repo · GitHub',
      'Bump hono · owner/repo#4',
    ],
    [
      'https://github.com/owner/repo/blob/main/README.md',
      'repo/README.md at main · owner/repo · GitHub',
      'repo/README.md at main · owner/repo',
    ],
    ['https://gist.github.com/owner/abc', 'notes.md · GitHub', 'notes.md'],
    [
      'https://www.youtube.com/watch?v=abc',
      'How queues work - Cloudflare - YouTube',
      'How queues work - Cloudflare',
    ],
    ['https://m.youtube.com/@channel', 'A channel - YouTube', 'A channel'],
    ['https://music.youtube.com/watch?v=abc', 'A song - YouTube Music', 'A song - YouTube Music'],
    ['https://www.youtube.com/', 'YouTube', 'YouTube'],
    ['https://GitHub.com:443/owner/repo', REPO_TITLE, 'repo: A tool for keeping links'],
    ['https://github.com/', 'GitHub', 'GitHub'],
    ['https://notgithub.com/x', REPO_TITLE, REPO_TITLE],
    ['https://example.com/x', REPO_TITLE, REPO_TITLE],
    ['not a url', REPO_TITLE, REPO_TITLE],
  ])('cleans the title of %s', (url, title, cleaned) => {
    expect(cleanTitle(title, url)).toBe(cleaned);
  });

  it('applies every matching rule, removes and then replaces every match and keeps a title it would empty', () => {
    const rules = compileTitleRules({
      rules: [
        { hosts: ['example.com'], remove: ['\\[ad\\]'] },
        {
          hosts: ['example.com', 'example.org'],
          remove: ['^Example:\\s*'],
          replace: [{ pattern: '(\\w+) page', with: '$1 article' }],
        },
        { hosts: ['example.com'], paths: ['^/docs/'], remove: ['^a '] },
      ],
    });
    expect(cleanTitle('Example: [ad] a page [ad]', 'https://www.example.com/', rules)).toBe(
      'a article',
    );
    expect(cleanTitle('Example: a page', 'https://example.com/docs/x', rules)).toBe('article');
    expect(cleanTitle('Example: ', 'https://example.org/', rules)).toBe('Example: ');
  });

  it.each([
    ['a missing hosts list', { rules: [{ remove: ['x'] }] }],
    ['neither removals nor replacements', { rules: [{ hosts: ['a.example'], remove: [] }] }],
    ['an invalid pattern', { rules: [{ hosts: ['a.example'], remove: ['('] }] }],
    ['an invalid path', { rules: [{ hosts: ['a.example'], paths: ['('], remove: ['x'] }] }],
    [
      'a replacement without its text',
      { rules: [{ hosts: ['a.example'], replace: [{ pattern: 'x' }] }] },
    ],
  ])('refuses a rules file with %s', (_, file) => {
    expect(() => compileTitleRules(file)).toThrow();
  });
});

describe('a fetched page', () => {
  it('stores its title and serves its reader title cleaned by the rules', async () => {
    const page = blogArticle
      .replace(/<title>[^<]*<\/title>/, `<title>${REPO_TITLE}</title>`)
      .replace('content="Why We Keep Links"', `content="${REPO_TITLE}"`);
    new FakeOrigin().page('https://github.com/owner/repo', page);
    const user = await signIn();
    const { id } = await addAndFetch(user, 'https://github.com/owner/repo');
    const link = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
    expect(link.title).toBe('repo: A tool for keeping links');
    const reader = (await api('GET', `/api/v1/links/${id}/reader`, { as: user.session })).json;
    expect(reader.title).toBe('repo: A tool for keeping links');
  });
});

describe('cleaning the stored titles', () => {
  async function seedTitled(titles: [string, string][]) {
    const user = await signIn();
    const ids = await seedLinks(
      user,
      titles.map(([url]) => ({ url, state: 'active' })),
    );
    await env.DB.batch(
      ids.map((id, i) =>
        env.DB.prepare('UPDATE links SET title = ? WHERE id = ?').bind(titles[i]![1], id),
      ),
    );
    return { user, ids };
  }

  async function stored(id: string) {
    return env.DB.prepare('SELECT title, updated_at FROM links WHERE id = ?')
      .bind(id)
      .first<{ title: string; updated_at: string }>();
  }

  it('cleans every title once in the every-minute run, except those the owner edited', async () => {
    const { user, ids } = await seedTitled([
      ['https://github.com/owner/repo', REPO_TITLE],
      ['https://github.com/owner/mine', 'GitHub - owner/mine · GitHub'],
      ['https://example.com/a', REPO_TITLE],
    ]);
    const [repo, mine, other] = ids as [string, string, string];
    await api('PATCH', `/api/v1/links/${mine}`, {
      as: user.session,
      body: { title: 'GitHub - owner/mine · GitHub' },
    });
    setNow('2026-11-10T12:00:00.000Z');
    await runEveryMinute();
    expect(await stored(repo)).toEqual({
      title: 'repo: A tool for keeping links',
      updated_at: '2026-11-10T12:00:00.000Z',
    });
    expect((await stored(mine))?.title).toBe('GitHub - owner/mine · GitHub');
    expect((await stored(other))?.title).toBe(REPO_TITLE);

    // With the same rules, a title stored meanwhile is left for the fetch to clean.
    await env.DB.prepare('UPDATE links SET title = ? WHERE id = ?').bind(REPO_TITLE, repo).run();
    expect(await applyTitleRules(env)).toBe(0);
    expect((await stored(repo))?.title).toBe(REPO_TITLE);
  });

  it('cleans every title again once the rules change', async () => {
    const { ids } = await seedTitled([['https://example.com/a', 'Example | A page']]);
    const rules = { rules: [{ hosts: ['example.com'], remove: ['^Example \\| '] }] };
    expect(await applyTitleRules(env)).toBe(0);
    expect(await applyTitleRules(env, rules)).toBe(1);
    expect((await stored(ids[0]!))?.title).toBe('A page');
    expect(await applyTitleRules(env, rules)).toBe(0);
  });
});

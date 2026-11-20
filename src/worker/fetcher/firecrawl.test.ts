import { describe, expect, it } from 'vitest';
import { outboundRequests, onOutbound } from '../test/outbound';
import { FakeOrigin } from '../test/origin';
import { api, deliverFetches, env, recordFetchQueue, signIn, useFirecrawl } from '../test/helpers';
import { keyRejection } from '../enrich/keys';
import { blogArticle } from './fixtures/pages';

const KEY = 'fc-secret-abcd1234';
const FIRECRAWL = new URL(env.FIRECRAWL_API_URL).origin;

type Answer = { status: number; body: unknown };

/** A fake of Firecrawl's API: it answers a scrape with `scrape`, unless a test scripts otherwise. */
function fakeFirecrawl({
  scrape = (url: string): Answer => ({
    status: 200,
    body: {
      success: true,
      data: { rawHtml: blogArticle, metadata: { url, sourceURL: url, statusCode: 200 } },
    },
  }),
}: { scrape?: (url: string) => Answer } = {}) {
  onOutbound(FIRECRAWL, async (request) => {
    const answer = scrape(((await request.json()) as { url: string }).url);
    return Response.json(answer.body, { status: answer.status });
  });
}

/** The requests sent to Firecrawl, by path. */
function firecrawlCalls(path: string): Request[] {
  return outboundRequests.filter((r) => r.url.startsWith(FIRECRAWL) && r.url.endsWith(path));
}

/** Cloudflare's "Just a moment…" page. */
function botCheck(): Response {
  return new Response('<title>Just a moment...</title>', {
    status: 403,
    headers: { 'Content-Type': 'text/html', Server: 'cloudflare', 'cf-mitigated': 'challenge' },
  });
}

describe('fetching through Firecrawl', () => {
  const URL_ = 'https://guarded.example/why-git-was-replaced-4f31eae67e00';

  /** A signed-in owner whose link to URL_ is fetched once, with the queue recorded. */
  async function fetchGuarded({
    withKey = true,
    origin = () => botCheck(),
    email = 'owner@example.test',
  } = {}) {
    new FakeOrigin().serve(URL_, origin);
    const user = await signIn(email);
    if (withKey) useFirecrawl(KEY);
    const sent = recordFetchQueue();
    const added = await api('POST', '/api/v1/links', { as: user.session, body: { url: URL_ } });
    const id = added.json.link.id as string;
    await deliverFetches([sent[0]!.body]);
    const link = (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
    return { user, sent, id, link };
  }

  it('stores the page Firecrawl fetched when the site answers with a bot check', async () => {
    fakeFirecrawl();
    const { user, id, link } = await fetchGuarded();
    expect(link).toMatchObject({
      state: 'active',
      title: 'Why We Keep Links Forever',
      final_url: URL_,
      notes: ['fetched through Firecrawl'],
    });
    const [call] = firecrawlCalls('/v2/scrape');
    expect(call?.headers.get('Authorization')).toBe(`Bearer ${KEY}`);
    expect(await call?.json()).toMatchObject({ url: URL_, formats: ['rawHtml'], proxy: 'auto' });
    const read = await api('GET', `/api/v1/links/${id}/text`, { as: user.session });
    expect(read.json.text).toContain('The first reason');
  });

  it.each([
    { label: 'without a key', withKey: false, origin: () => botCheck() },
    {
      label: 'for a page that is not behind a bot check',
      withKey: true,
      origin: () => new Response('forbidden', { status: 403 }),
    },
  ])('is not asked $label', async ({ withKey, origin }) => {
    fakeFirecrawl();
    const { link } = await fetchGuarded({ withKey, origin });
    expect(link.state).not.toBe('active');
    expect(firecrawlCalls('/v2/scrape')).toHaveLength(0);
  });

  it.each([
    {
      label: 'a key Firecrawl refuses',
      scrape: { status: 402, body: { success: false, error: 'Insufficient credits' } },
      state: 'unreachable',
      reason: 'blocked by a bot check (Firecrawl: Insufficient credits)',
      rejection: 'Insufficient credits',
      retried: false,
    },
    {
      label: 'a page Firecrawl gets an error for',
      scrape: {
        status: 200,
        body: { success: true, data: { rawHtml: '<p>gone</p>', metadata: { statusCode: 404 } } },
      },
      state: 'unreachable',
      reason: 'blocked by a bot check (Firecrawl: the page answered HTTP 404)',
      rejection: null,
      retried: false,
    },
    {
      label: 'Firecrawl down',
      scrape: { status: 503, body: { success: false, error: 'Service unavailable' } },
      state: 'pending',
      reason: 'blocked by a bot check (Firecrawl: Service unavailable)',
      rejection: null,
      retried: true,
    },
  ])('states $label', async ({ scrape, state, reason, rejection, retried }) => {
    fakeFirecrawl({ scrape: () => scrape });
    const { sent, link } = await fetchGuarded();
    expect(link).toMatchObject({ state, state_reason: reason });
    expect(await keyRejection(env.DB, 'firecrawl', KEY)).toBe(rejection);
    expect(sent.slice(1).map((m) => m.delaySeconds)).toEqual(retried ? [600] : []);
  });

  it('is not asked again with a key it refused', async () => {
    fakeFirecrawl({
      scrape: () => ({ status: 401, body: { success: false, error: 'Unauthorized' } }),
    });
    await fetchGuarded();
    expect(firecrawlCalls('/v2/scrape')).toHaveLength(1);
    const { link } = await fetchGuarded({ email: 'other@example.test' });
    expect(link.state_reason).toBe('blocked by a bot check');
    expect(firecrawlCalls('/v2/scrape')).toHaveLength(1);
  });
});

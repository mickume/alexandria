import { describe, expect, it } from 'vitest';
import { outboundRequests, onOutbound } from '../test/outbound';
import { FakeOrigin } from '../test/origin';
import { api, deliverFetches, env, recordFetchQueue, signIn, type TestUser } from '../test/helpers';
import { blogArticle } from './fixtures/pages';

const KEY = 'fc-secret-abcd1234';
const FIRECRAWL = new URL(env.FIRECRAWL_API_URL).origin;

type Answer = { status: number; body: unknown };

/**
 * A fake of Firecrawl's API: it accepts every key for the credit-usage test
 * and answers a scrape with `scrape`, both unless a test scripts otherwise.
 */
function fakeFirecrawl({
  keyTest = { status: 200, body: { success: true, data: { remainingCredits: 500 } } },
  scrape = (url: string): Answer => ({
    status: 200,
    body: {
      success: true,
      data: { rawHtml: blogArticle, metadata: { url, sourceURL: url, statusCode: 200 } },
    },
  }),
}: { keyTest?: Answer; scrape?: (url: string) => Answer } = {}) {
  onOutbound(FIRECRAWL, async (request) => {
    const path = new URL(request.url).pathname;
    const answer =
      path === '/v2/team/credit-usage'
        ? keyTest
        : scrape(((await request.json()) as { url: string }).url);
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

async function saveKey(user: TestUser, key = KEY) {
  return api('PUT', '/api/v1/settings/firecrawl', { as: user.session, body: { api_key: key } });
}

describe('the Firecrawl key', () => {
  it('is tested with Firecrawl, kept encrypted, shown by its last 4 characters, and removed', async () => {
    fakeFirecrawl();
    const user = await signIn();
    expect((await api('GET', '/api/v1/settings/firecrawl', { as: user.session })).json).toEqual({
      configured: false,
    });

    const saved = await saveKey(user, ` ${KEY} `);
    const view = {
      configured: true,
      key_last4: '1234',
      status: 'verified',
      rejected_message: null,
    };
    expect(saved).toMatchObject({ status: 200, json: view });
    expect(firecrawlCalls('/v2/team/credit-usage')[0]?.headers.get('Authorization')).toBe(
      `Bearer ${KEY}`,
    );
    const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
      .bind(user.id)
      .first<Record<string, unknown>>();
    expect(Object.values(row!).some((v) => String(v).includes('fc-secret'))).toBe(false);
    expect((await api('GET', '/api/v1/settings/firecrawl', { as: user.session })).json).toEqual(
      view,
    );

    const removed = await api('DELETE', '/api/v1/settings/firecrawl', { as: user.session });
    expect(removed.status).toBe(204);
    expect((await api('GET', '/api/v1/settings/firecrawl', { as: user.session })).json).toEqual({
      configured: false,
    });
  });

  it.each([
    {
      label: 'a key Firecrawl refuses',
      keyTest: { status: 401, body: { success: false, error: 'Unauthorized: Invalid token' } },
      status: 400,
      error: 'key_rejected',
      message: 'Unauthorized: Invalid token',
    },
    {
      label: 'Firecrawl down',
      keyTest: { status: 503, body: { success: false, error: 'Service unavailable' } },
      status: 502,
      error: 'provider_unavailable',
      message: 'Firecrawl could not be reached: Service unavailable',
    },
  ])('is not stored on $label', async ({ keyTest, status, error, message }) => {
    fakeFirecrawl({ keyTest });
    const user = await signIn();
    expect(await saveKey(user)).toMatchObject({ status, json: { error, message } });
    expect((await api('GET', '/api/v1/settings/firecrawl', { as: user.session })).json).toEqual({
      configured: false,
    });
  });

  it('refuses a missing key', async () => {
    const user = await signIn();
    const r = await api('PUT', '/api/v1/settings/firecrawl', { as: user.session, body: {} });
    expect(r).toMatchObject({ status: 400, json: { error: 'invalid_key', field: 'api_key' } });
  });
});

describe('fetching through Firecrawl', () => {
  const URL_ = 'https://guarded.example/why-git-was-replaced-4f31eae67e00';

  /** A signed-in owner whose link to URL_ is fetched once, with the queue recorded. */
  async function fetchGuarded({ withKey = true, origin = () => botCheck() } = {}) {
    new FakeOrigin().serve(URL_, origin);
    const user = await signIn();
    if (withKey) await saveKey(user);
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
      has_snapshot: true,
      notes: ['fetched through Firecrawl'],
    });
    const [call] = firecrawlCalls('/v2/scrape');
    expect(call?.headers.get('Authorization')).toBe(`Bearer ${KEY}`);
    expect(await call?.json()).toMatchObject({ url: URL_, formats: ['rawHtml'], proxy: 'auto' });
    const read = await api('GET', `/api/v1/links/${id}/reader`, { as: user.session });
    expect(read.status).toBe(200);
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
      keyStatus: 'rejected',
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
      keyStatus: 'verified',
      retried: false,
    },
    {
      label: 'Firecrawl down',
      scrape: { status: 503, body: { success: false, error: 'Service unavailable' } },
      state: 'pending',
      reason: 'blocked by a bot check (Firecrawl: Service unavailable)',
      keyStatus: 'verified',
      retried: true,
    },
  ])('states $label', async ({ scrape, state, reason, keyStatus, retried }) => {
    fakeFirecrawl({ scrape: () => scrape });
    const { user, sent, link } = await fetchGuarded();
    expect(link).toMatchObject({ state, state_reason: reason });
    const settings = await api('GET', '/api/v1/settings/firecrawl', { as: user.session });
    expect(settings.json.status).toBe(keyStatus);
    expect(sent.slice(1).map((m) => m.delaySeconds)).toEqual(retried ? [600] : []);
  });
});

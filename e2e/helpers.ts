import { execFileSync } from 'node:child_process';
import { expect, type Page } from '@playwright/test';

/** Signs in through the fake Google provider and lands on the stream. */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/signin');
  await page.getByRole('link', { name: 'Sign in with Google' }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Adds `urls` as the signed-in owner, through the API with the page's session. */
export async function addLinks(page: Page, urls: string[]): Promise<void> {
  const origin = new URL(page.url()).origin;
  for (let i = 0; i < urls.length; i += 100) {
    const r = await page.request.post('/api/v1/links/batch', {
      data: { urls: urls.slice(i, i + 100) },
      headers: { Origin: origin },
    });
    expect(r.status()).toBe(200);
  }
}

/** A host name of about 200 characters, unique for `i`, so that cards carry long titles. */
export function longHost(i: number): string {
  const label = (c: string) => c.repeat(60);
  return `${label('a')}.${label('b')}.${label('c')}.site${i}.example`;
}

/** Runs SQL against the local D1 database that `make e2e`'s wrangler dev serves, and returns its rows. */
export function d1<T = Record<string, unknown>>(sql: string): T[] {
  const out = execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'alexandria',
      '--local',
      '--persist-to',
      '.wrangler/e2e',
      '-c',
      'dist/alexandria/wrangler.json',
      '--json',
      '--command',
      sql,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const parsed = JSON.parse(out) as { results: T[] }[];
  return parsed.flatMap((r) => r.results);
}

/** The body of an object in the local R2 bucket that `make e2e`'s wrangler dev serves, or null. */
export function r2Object(key: string): Buffer | null {
  try {
    return execFileSync(
      'npx',
      [
        'wrangler',
        'r2',
        'object',
        'get',
        `alexandria-snapshots/${key}`,
        '--local',
        '--persist-to',
        '.wrangler/e2e',
        '-c',
        'dist/alexandria/wrangler.json',
        '--pipe',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch {
    return null;
  }
}

/** The fake origin of e2e/fake-origin.ts. */
export const fakeOrigin = {
  url: 'http://localhost:8791',
  async goOffline(): Promise<void> {
    await fetch(`${this.url}/__offline`, { method: 'POST' });
  },
  async goOnline(): Promise<void> {
    await fetch(`${this.url}/__online`, { method: 'POST' });
  },
  async requestsSince(t: number): Promise<number> {
    const log = (await (await fetch(`${this.url}/__log`)).json()) as { at: number }[];
    return log.filter((r) => r.at >= t).length;
  },
};

/** One request the fake AI provider of e2e/fake-ai.ts received. */
export interface FakeAiRequest {
  /** Whether it was a question (a streamed request) rather than an enrichment or a key test. */
  ask: boolean;
  at: number;
  provider: string;
  auth: string;
  body: string;
  enrichment: boolean;
}

/** The fake AI provider of e2e/fake-ai.ts. */
export const fakeAi = {
  url: 'http://localhost:8792',
  async requests(): Promise<FakeAiRequest[]> {
    return (await (await fetch(`${this.url}/__log`)).json()) as FakeAiRequest[];
  },
  async answer(result: { summary: string; tags: string[]; topic: string }): Promise<void> {
    await fetch(`${this.url}/__answer`, { method: 'POST', body: JSON.stringify(result) });
  },
  /** Answers questions with `text`, streamed a word at a time. */
  async answerText(text: string): Promise<void> {
    await fetch(`${this.url}/__answer_text`, { method: 'POST', body: JSON.stringify({ text }) });
  },
  /** Makes the provider reject every question with `status` and `message`; no status lifts it. */
  async rejectAnswers(status?: number, message?: string): Promise<void> {
    await fetch(`${this.url}/__reject_answers`, {
      method: 'POST',
      body: JSON.stringify({ status, message }),
    });
  },
  /** Answers every enrichment whose request holds `contains` with `result`. */
  async answerWhen(
    contains: string,
    result: { summary: string; tags: string[]; topic: string },
  ): Promise<void> {
    await fetch(`${this.url}/__answer_when`, {
      method: 'POST',
      body: JSON.stringify({ contains, result }),
    });
  },
};

/** The fake of Workers AI and Vectorize in e2e/fake-meaning.ts. */
export const fakeMeaning = {
  url: 'http://localhost:8793',
  /** The vectors the fake index holds, optionally of one namespace (a user's id). */
  async vectors(namespace?: string): Promise<{ id: string; namespace: string }[]> {
    const query = namespace === undefined ? '' : `?namespace=${encodeURIComponent(namespace)}`;
    return (await (await fetch(`${this.url}/__vectors${query}`)).json()) as {
      id: string;
      namespace: string;
    }[];
  },
  /** Makes embedding and querying fail, as when Workers AI is unreachable. */
  async fail(): Promise<void> {
    await fetch(`${this.url}/__fail`, { method: 'POST' });
  },
  /** Undoes fail. */
  async recover(): Promise<void> {
    await fetch(`${this.url}/__recover`, { method: 'POST' });
  },
};

/** Runs the Worker's every-minute scheduled handler through wrangler dev's test endpoint. */
export async function runMinute(page: Page): Promise<void> {
  const r = await page.request.get('/cdn-cgi/local/scheduled?cron=*+*+*+*+*');
  expect(r.status()).toBeLessThan(400);
}

/** Runs the Worker's hourly scheduled handler through wrangler dev's test endpoint. */
export async function runScheduled(page: Page): Promise<void> {
  const r = await page.request.get('/cdn-cgi/local/scheduled?cron=0+*+*+*+*');
  expect(r.status()).toBeLessThan(400);
}

/** The time `days` before now, as stored. */
export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** Saves the Anthropic key the fake AI provider accepts, through the API. */
export async function saveAiKey(page: Page): Promise<void> {
  const r = await page.request.put('/api/v1/settings/ai', {
    data: { provider: 'anthropic', api_key: 'sk-ant-test-1234' },
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(r.status()).toBe(200);
}

/** The stream card of the link `id`. */
export function cardOf(page: Page, id: string) {
  return page
    .locator('article', { has: page.locator(`a[href="/api/v1/links/${id}/open"]`) })
    .first();
}

/** Adds `urls` through the API and returns the new links' ids, in order. */
export async function addLinkIds(page: Page, urls: string[]): Promise<string[]> {
  const r = await page.request.post('/api/v1/links/batch', {
    data: { urls },
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(r.status()).toBe(200);
  const body = (await r.json()) as { added: { id: string; url: string }[] };
  return urls.map((u) => body.added.find((l) => l.url === u)!.id);
}

import { expect, test, type Page } from '@playwright/test';
import { paperPdf, PAPER_FIRST_SENTENCE } from '../src/worker/fetcher/fixtures/pdfs.ts';
import { d1, fakeOrigin, r2Object, signIn } from './helpers';

/** Pastes `url` into the add input and returns the new link's id. */
async function paste(page: Page, url: string): Promise<string> {
  const input = page.getByLabel('Add links');
  await input.fill(url);
  const added = page.waitForResponse((r) => r.url().endsWith('/api/v1/links/batch'));
  await input.press('Enter');
  const body = (await (await added).json()) as {
    added: { id: string }[];
    boosted: { id: string }[];
  };
  return (body.added[0] ?? body.boosted[0])!.id;
}

async function link(page: Page, id: string) {
  return (await (await page.request.get(`/api/v1/links/${id}`)).json()) as Record<string, unknown>;
}

test.describe('fetching links', () => {
  test.afterEach(async () => {
    await fakeOrigin.goOnline();
  });

  test('a pasted article is fetched, shown in place and read', async ({ page }) => {
    await signIn(page);
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    const id = await paste(page, 'https://news.example/article');
    const card = page.getByRole('article').first();
    await expect(card.getByRole('link', { name: 'An Article' })).toBeVisible({ timeout: 60_000 });
    expect(navigations).toBe(0);

    const [user] = d1<{ id: string }>("SELECT id FROM users WHERE email = 'owner@example.test'");
    expect(r2Object(`u/${user!.id}/l/${id}/snapshot`)?.toString()).toContain('<h1>An Article</h1>');
    const [text] = d1<{ text: string }>(`SELECT text FROM link_texts WHERE link_id = '${id}'`);
    expect(text?.text).toContain('This is the first paragraph of the article');

    await card.getByRole('link', { name: 'Read' }).click();
    await expect(page.getByRole('heading', { name: 'An Article' })).toBeVisible();
    await expect(page.getByText('This is the first paragraph of the article')).toBeVisible();

    expect((await link(page, id)).use_count).toBe(1);
    const history = await (await page.request.get(`/api/v1/links/${id}/history`)).json();
    expect(history.items.map((e: { kind: string }) => e.kind)).toEqual(['use', 'fetch']);
  });

  test('a stored page is read after its site goes offline', async ({ page }) => {
    await signIn(page);
    const id = await paste(page, 'https://news.example/offline-article');
    await expect.poll(async () => (await link(page, id)).state, { timeout: 60_000 }).toBe('active');
    await page.reload();

    await fakeOrigin.goOffline();
    const offlineSince = Date.now();
    const card = page.getByRole('article', { name: 'An Article' }).first();
    await card.getByRole('link', { name: 'Snapshot' }).click();
    const frame = page.frameLocator('iframe[sandbox]');
    await expect(frame.getByRole('heading', { name: 'An Article' })).toBeVisible();

    await page.goBack();
    await page
      .getByRole('article', { name: 'An Article' })
      .first()
      .getByRole('link', { name: 'Read' })
      .click();
    await expect(page.getByText('This is the first paragraph of the article')).toBeVisible();

    expect(await fakeOrigin.requestsSince(offlineSince)).toBe(0);
    expect((await link(page, id)).use_count).toBe(2);
  });

  test('a pasted PDF is stored whole and read', async ({ page }) => {
    await signIn(page);
    await paste(page, 'https://papers.example/on-links.pdf');
    const card = page.getByRole('article', { name: 'On Links' });
    await expect(card).toBeVisible({ timeout: 60_000 });

    await card.getByRole('link', { name: 'Snapshot' }).click();
    const viewer = page.locator('object[type="application/pdf"]');
    const src = (await viewer.getAttribute('data'))!;
    const inline = await page.request.get(src);
    expect(inline.headers()['content-type']).toBe('application/pdf');
    expect(inline.headers()['content-disposition']).toMatch(/^inline/);
    expect(new Uint8Array(await inline.body())).toEqual(paperPdf('On Links'));
    const download = await page.request.get(
      (await page.getByRole('link', { name: 'Download' }).getAttribute('href'))!,
    );
    expect(download.headers()['content-disposition']).toMatch(/^attachment/);

    await page.goBack();
    await page
      .getByRole('article', { name: 'On Links' })
      .getByRole('link', { name: 'Read' })
      .click();
    await expect(page.getByText(PAPER_FIRST_SENTENCE)).toBeVisible();
  });
});

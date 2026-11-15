import { expect, test, type Page } from '@playwright/test';
import { paperPdf } from '../src/worker/fetcher/fixtures/pdfs.ts';
import { cardOf, d1, fakeOrigin, signIn } from './helpers';

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

/** Every request the page made to an address outside Alexandria, from now on. */
function outsideRequests(page: Page): string[] {
  const origin = new URL(page.url()).origin;
  const outside: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.origin !== origin && url.protocol.startsWith('http')) outside.push(r.url());
  });
  return outside;
}

test.describe('fetching links', () => {
  test.afterEach(async () => {
    await fakeOrigin.goOnline();
  });

  test('a pasted article is fetched and shown in place, with nothing to read until a snapshot', async ({
    page,
  }) => {
    await signIn(page);
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    const id = await paste(page, 'https://news.example/article');
    const card = page.getByRole('article').first();
    await expect(card.getByRole('link', { name: 'An Article' })).toBeVisible({ timeout: 60_000 });
    expect(navigations).toBe(0);
    const [text] = d1<{ text: string }>(`SELECT text FROM link_texts WHERE link_id = '${id}'`);
    expect(text?.text).toContain('This is the first paragraph of the article');
    await expect(card.getByRole('link', { name: 'Read', exact: true })).toHaveCount(0);
    expect((await link(page, id)).has_snapshot).toBe(false);
  });

  test('a snapshot keeps the article with its images, read after the site goes offline', async ({
    page,
  }) => {
    await signIn(page);
    const id = await paste(page, 'https://illustrated.example/article');
    await expect.poll(async () => (await link(page, id)).state, { timeout: 60_000 }).toBe('active');
    await page.reload();

    const card = cardOf(page, id);
    await card.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Take snapshot' }).click();
    await expect(cardOf(page, id).getByText('Taking a snapshot…')).toBeVisible();
    await expect(cardOf(page, id).getByRole('link', { name: 'Read', exact: true })).toBeVisible({
      timeout: 60_000,
    });

    await fakeOrigin.goOffline();
    const offlineSince = Date.now();
    const outside = outsideRequests(page);
    await cardOf(page, id).getByRole('link', { name: 'Read', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'An Illustrated Article' })).toBeVisible();
    await expect(page.getByText('The first paragraph of the illustrated article')).toBeVisible();
    await expect(page.getByText('Sidebar')).toHaveCount(0);
    const images = page.locator('.reader-body img');
    await expect(images).toHaveCount(2);
    for (const image of await images.all()) {
      await expect
        .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
        .toBe(1);
    }
    // The image the site answered 404 for is a placeholder that names it and links to it.
    await expect(page.getByText('1 images could not be saved')).toBeVisible();
    await expect(page.locator('.missing-image')).toContainText('Figure three');
    await expect(page.getByRole('link', { name: 'original image' })).toHaveAttribute(
      'href',
      'https://img.example/missing.png',
    );

    expect(outside).toEqual([]);
    expect(await fakeOrigin.requestsSince(offlineSince)).toBe(0);
    expect((await link(page, id)).use_count).toBe(1);
    const history = await (await page.request.get(`/api/v1/links/${id}/history`)).json();
    expect(history.items.map((e: { kind: string }) => e.kind)).toEqual([
      'use',
      'snapshot',
      'fetch',
      'fetch',
    ]);
  });

  test('a pasted PDF is stored whole as its snapshot and read', async ({ page }) => {
    await signIn(page);
    await paste(page, 'https://papers.example/on-links.pdf');
    const card = page.getByRole('article', { name: 'On Links' });
    await expect(card).toBeVisible({ timeout: 60_000 });

    await card.getByRole('link', { name: 'Read', exact: true }).click();
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
  });
});

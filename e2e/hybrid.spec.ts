import { expect, test, type Page } from '@playwright/test';
import { addLinkIds, fakeMeaning, signIn } from './helpers';

const TIMERS = 'https://example.com/alarm-timers';
const QUEUES = 'https://docs.example/queues';
const QUESTION = 'run a task later on cloudflare';

/** Types the query into the search box and presses Enter. */
async function searchByMeaning(page: Page, query: string): Promise<void> {
  const box = page.getByRole('searchbox', { name: 'Search' });
  await box.fill(query);
  await box.press('Enter');
}

const results = (page: Page) => page.getByRole('list', { name: 'Results' });

/** Waits until the API finds the link with the query, by words or by meaning. */
async function waitUntilFound(page: Page, id: string, path: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const r = await page.request.get(path);
        const body = (await r.json()) as { items: { link_id?: string; link?: { id: string } }[] };
        return body.items.some((i) => (i.link_id ?? i.link?.id) === id);
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

test.describe.serial('the owner searches by meaning', () => {
  const added: string[] = [];

  test('finds an article that shares no word with the question, marked “by meaning”', async ({
    page,
  }) => {
    await signIn(page);
    const [id = ''] = await addLinkIds(page, [TIMERS]);
    added.push(id);
    await waitUntilFound(page, id, `/api/v1/passages?q=${encodeURIComponent(QUESTION)}&limit=20`);

    await page.goto('/');
    await searchByMeaning(page, QUESTION);

    await expect(page).toHaveURL(
      /\/search\?q=run%20a%20task%20later%20on%20cloudflare&mode=hybrid$/,
    );
    const row = results(page).locator('li', {
      has: page.getByRole('article', { name: 'Alarm timers' }),
    });
    await expect(row).toContainText('by meaning');
    await expect(row).toContainText('schedule background work');
    await expect(page.getByText('Showing keyword matches only.')).toHaveCount(0);

    // A reload repeats the search by meaning.
    await page.reload();
    await expect(row).toContainText('by meaning');
  });

  test('puts a title match first, as keyword search does', async ({ page }) => {
    await signIn(page);
    const [id = ''] = await addLinkIds(page, [QUEUES]);
    added.push(id);
    await waitUntilFound(page, id, '/api/v1/search?q=cloudflare+queues');

    await page.goto('/');
    await searchByMeaning(page, 'cloudflare queues');

    await expect(page).toHaveURL(/mode=hybrid$/);
    await expect(results(page).getByRole('article').first()).toHaveAttribute(
      'aria-label',
      'Cloudflare Queues explained',
    );
  });

  test('falls back to the keyword results when Workers AI is unreachable', async ({ page }) => {
    await signIn(page);
    await fakeMeaning.fail();
    try {
      await page.goto('/');
      await searchByMeaning(page, 'cloudflare queues');

      await expect(page.getByText('Showing keyword matches only.')).toBeVisible();
      await expect(results(page).getByRole('article').first()).toHaveAttribute(
        'aria-label',
        'Cloudflare Queues explained',
      );
      await expect(page.getByText('by meaning')).toHaveCount(0);
    } finally {
      await fakeMeaning.recover();
      // The specs share one library: take out what this one added.
      const origin = new URL(page.url()).origin;
      for (const id of added) {
        await page.request.delete(`/api/v1/links/${id}`, { headers: { Origin: origin } });
      }
    }
  });
});

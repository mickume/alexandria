import { expect, test, type Page } from '@playwright/test';
import { addLinkIds, cardOf, fakeOrigin, signIn } from './helpers';

const URL_KEPT = 'https://kept.example/page';

/** The link as the API has it. */
async function linkOf(page: Page, id: string) {
  return (await (await page.request.get(`/api/v1/links/${id}`)).json()) as {
    state: string;
    archived_at: string | null;
  };
}

test('the owner archives a link, its page is refreshed, and they unarchive it', async ({
  page,
}) => {
  await signIn(page);
  const origin = new URL(page.url()).origin;
  await fakeOrigin.servePage(URL_KEPT, 'Kept page', 'The first version of the page.');
  const [id = ''] = await addLinkIds(page, [URL_KEPT]);
  await expect.poll(async () => (await linkOf(page, id)).state, { timeout: 30_000 }).toBe('active');

  await fakeOrigin.servePage(URL_KEPT, 'Kept page', 'A newer version, marker-archived, kept.');
  await page.goto('/');
  const card = cardOf(page, id);
  await card.getByRole('button', { name: 'More actions' }).click();
  await card.getByRole('button', { name: 'Archive' }).click();
  await expect(cardOf(page, id)).toHaveCount(0);
  expect((await linkOf(page, id)).state).toBe('archived');

  await expect
    .poll(
      async () =>
        ((await (await page.request.get(`/api/v1/links/${id}/reader`)).json()) as { text: string })
          .text,
      { timeout: 30_000 },
    )
    .toContain('marker-archived');
  expect((await linkOf(page, id)).state).toBe('archived');

  await page.goto('/archive');
  const row = page.getByRole('article', { name: 'Kept page' });
  await expect(row).toHaveClass(/archived/);
  await page.goto('/search?q=marker-archived');
  await expect(cardOf(page, id)).toHaveClass(/archived/);

  await page.goto('/archive');
  await page
    .getByRole('article', { name: 'Kept page' })
    .getByRole('button', { name: 'Unarchive' })
    .click();
  await expect(page.getByRole('article', { name: 'Kept page' })).toHaveCount(0);
  const unarchived = await linkOf(page, id);
  expect([unarchived.state, unarchived.archived_at]).toEqual(['active', null]);
  await page.goto('/');
  await expect(cardOf(page, id)).toBeVisible();

  // The specs share one library: leave it without this link.
  await page.request.delete(`/api/v1/links/${id}`, { headers: { Origin: origin } });
});

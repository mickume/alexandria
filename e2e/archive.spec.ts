import { expect, test, type Page } from '@playwright/test';
import { addLinkIds, cardOf, fakeOrigin, signIn } from './helpers';

const URL_KEPT = 'https://kept.example/page';
const URL_AS_IT_WAS = 'https://kept.example/as-it-was';

/** The link as the API has it. */
async function linkOf(page: Page, id: string) {
  return (await (await page.request.get(`/api/v1/links/${id}`)).json()) as {
    state: string;
    title: string;
    archived_at: string | null;
    has_snapshot: boolean;
    fetched_at: string | null;
  };
}

/** The article HTML of the link's snapshot. */
async function snapshotHtml(page: Page, id: string): Promise<string> {
  const r = await page.request.get(`/api/v1/links/${id}/snapshot`);
  return r.ok() ? ((await r.json()) as { html: string }).html : '';
}

test('the owner archives a link without a snapshot, a snapshot is taken, and they unarchive it', async ({
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
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(cardOf(page, id)).toHaveCount(0);
  expect((await linkOf(page, id)).state).toBe('archived');

  await page.goto('/archive');
  const row = page.getByRole('article', { name: 'Kept page' });
  await expect(row).toHaveClass(/archived/);
  await expect(row.getByRole('link', { name: 'Read', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  expect(await snapshotHtml(page, id)).toContain('marker-archived');
  expect((await linkOf(page, id)).state).toBe('archived');
  await row.getByRole('link', { name: 'Read', exact: true }).click();
  await expect(page.getByText('A newer version, marker-archived, kept.')).toBeVisible();

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

test('archiving a link keeps the snapshot it has, whatever its page becomes', async ({ page }) => {
  await signIn(page);
  const origin = new URL(page.url()).origin;
  await fakeOrigin.servePage(URL_AS_IT_WAS, 'As it was', 'The words the owner kept, marker-kept.');
  const [id = ''] = await addLinkIds(page, [URL_AS_IT_WAS]);
  await expect.poll(async () => (await linkOf(page, id)).state, { timeout: 30_000 }).toBe('active');
  await page.goto(`/links/${id}`);
  await page.getByRole('button', { name: 'Take snapshot' }).click();
  await expect(page.getByRole('link', { name: 'Read', exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await fakeOrigin.servePage(URL_AS_IT_WAS, 'As it is now', 'Different words, marker-changed.');
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('button', { name: 'Unarchive' })).toBeVisible();
  const fetchedBefore = (await linkOf(page, id)).fetched_at;
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect
    .poll(async () => (await linkOf(page, id)).fetched_at, { timeout: 30_000 })
    .not.toBe(fetchedBefore);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'As it is now' })).toBeVisible();

  await page.getByRole('link', { name: 'Read', exact: true }).click();
  await expect(page.getByText('The words the owner kept, marker-kept.')).toBeVisible();
  expect(await snapshotHtml(page, id)).not.toContain('marker-changed');

  await page.request.delete(`/api/v1/links/${id}`, { headers: { Origin: origin } });
});

import { expect, test, type Page } from '@playwright/test';
import { addLinkIds, cardOf, signIn } from './helpers';

/** Files the link `id` under `topic`, a name or a path, through the API. */
async function fileUnder(page: Page, id: string, topic: string): Promise<void> {
  const r = await page.request.patch(`/api/v1/links/${id}`, {
    data: { topic },
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(r.status()).toBe(200);
}

/** The Topics page's row of `name`. */
function row(page: Page, name: string) {
  return page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) });
}

/** The names of the Topics page's rows, in order. */
async function names(page: Page): Promise<string[]> {
  return page.getByRole('row').locator('td:first-child').allTextContents();
}

test('the owner moves a topic under another on the Topics page', async ({ page }) => {
  await signIn(page);
  const [oxidation, futures, workshop] = await addLinkIds(page, [
    'https://tree.example/oxidation',
    'https://tree.example/futures',
    'https://tree.example/workshop',
  ]);
  await fileUnder(page, oxidation!, 'Oxidation');
  await fileUnder(page, futures!, 'Oxidation > Oxidation futures');
  await fileUnder(page, workshop!, 'Workshop');

  await page.goto('/topics');
  await expect(row(page, 'Oxidation')).toHaveAttribute('data-level', '1');
  await row(page, 'Oxidation').getByRole('button', { name: 'Move under…' }).click();
  await row(page, 'Oxidation')
    .getByRole('combobox', { name: 'Move under' })
    .selectOption({ label: 'Workshop' });
  await row(page, 'Oxidation').getByRole('button', { name: 'Move' }).click();

  await expect(row(page, 'Oxidation')).toHaveAttribute('data-level', '2');
  await expect(row(page, 'Oxidation futures')).toHaveAttribute('data-level', '3');
  await expect(row(page, 'Workshop')).toHaveAttribute('data-level', '1');
  await expect(row(page, 'Workshop').getByRole('cell').nth(1)).toHaveText('3');
  await expect(row(page, 'Oxidation').getByRole('cell').nth(1)).toHaveText('2');
  await expect(row(page, 'Oxidation futures').getByRole('cell').nth(1)).toHaveText('1');
  const order = await names(page);
  const at = (name: string) => order.indexOf(name);
  expect(at('Workshop')).toBeLessThan(at('Oxidation'));
  expect(at('Oxidation') + 1).toBe(at('Oxidation futures'));

  await page.goto('/search?q=topic%3Aworkshop');
  const results = page.getByRole('list', { name: 'Results' });
  await expect(results.getByRole('article')).toHaveCount(3);
});

test('the owner files a link under a new sub-topic by typing its path', async ({ page }) => {
  await signIn(page);
  const [filed, typed] = await addLinkIds(page, [
    'https://tree.example/craft',
    'https://tree.example/craft-testing',
  ]);
  await fileUnder(page, filed!, 'Craft of software');

  await page.goto(`/links/${typed}`);
  await page.getByRole('button', { name: 'Edit topic' }).click();
  await page.getByLabel('Topic').fill('Craft of software > Craft testing');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('navigation', { name: 'Topic path' })).toHaveText(
    'Craft of software›Craft testing',
  );

  await page.goto('/');
  await expect(cardOf(page, typed!).getByRole('link', { name: 'Craft testing' })).toHaveAttribute(
    'title',
    'Craft of software › Craft testing',
  );

  await page.goto('/topics');
  await expect(row(page, 'Craft testing')).toHaveAttribute('data-level', '2');
  await expect(row(page, 'Craft testing').getByRole('cell').nth(1)).toHaveText('1');
  await expect(row(page, 'Craft of software').getByRole('cell').nth(1)).toHaveText('2');
  const order = await names(page);
  expect(order.indexOf('Craft of software') + 1).toBe(order.indexOf('Craft testing'));

  await page.goto(`/search?q=${encodeURIComponent('topic:"craft of software"')}`);
  const results = page.getByRole('list', { name: 'Results' });
  await expect(results.getByRole('article')).toHaveCount(2);
});

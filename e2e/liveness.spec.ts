import { expect, test } from '@playwright/test';
import { d1, daysAgo, fakeOrigin, runScheduled, signIn } from './helpers';

test.afterEach(async () => {
  await fakeOrigin.goOnline();
});

test('a site goes offline, is marked dead after three weekly checks, and its copy is still readable', async ({
  page,
}) => {
  await signIn(page);
  const origin = new URL(page.url()).origin;
  const added = await page.request.post('/api/v1/links', {
    data: { url: 'https://news.example/liveness' },
    headers: { Origin: origin },
  });
  const id: string = (await added.json()).link.id;
  const link = async () =>
    (await (await page.request.get(`/api/v1/links/${id}`)).json()) as Record<string, unknown>;
  await expect.poll(async () => (await link()).state, { timeout: 60_000 }).toBe('active');

  await fakeOrigin.goOffline();
  for (let week = 1; week <= 3; week++) {
    d1(
      `UPDATE links SET last_checked_at = '${daysAgo(8)}', check_enqueued_at = NULL WHERE id = '${id}'`,
    );
    const before = (await link()).last_checked_at;
    await runScheduled(page);
    await expect
      .poll(async () => (await link()).last_checked_at, { timeout: 60_000 })
      .not.toBe(before);
  }
  const [row] = d1<{ liveness_failures: number; dead_since: string | null }>(
    `SELECT liveness_failures, dead_since FROM links WHERE id = '${id}'`,
  );
  expect(row?.liveness_failures).toBe(3);
  expect(row?.dead_since).not.toBeNull();

  await page.goto('/');
  const card = page.locator('article', { has: page.locator(`a[href="/api/v1/links/${id}/open"]`) });
  const title = card.locator('.card-title');
  await expect(title).toHaveCSS('text-decoration-line', 'line-through');
  await expect(card.getByText(/dead since \d{4}-\d{2}-\d{2}/)).toBeVisible();

  await card.getByRole('link', { name: 'Read', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'An Article' })).toBeVisible();
  await expect(page.getByText('This is the first paragraph of the article')).toBeVisible();
});

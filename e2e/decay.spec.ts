import { expect, test } from '@playwright/test';
import { d1, daysAgo, runScheduled, signIn } from './helpers';

const DAY = 86_400_000;

test('a link unused for 120 days is archived and the owner restores it', async ({ page }) => {
  await signIn(page);
  const origin = new URL(page.url()).origin;
  const added = await page.request.post('/api/v1/links', {
    data: { url: 'https://example.org/old' },
    headers: { Origin: origin },
  });
  const id: string = (await added.json()).link.id;
  d1(`UPDATE links SET last_used_at = '${daysAgo(121)}' WHERE id = '${id}'`);

  await runScheduled(page);
  await expect
    .poll(async () => (await (await page.request.get(`/api/v1/links/${id}`)).json()).state, {
      timeout: 30_000,
    })
    .toBe('archived');
  const archived = await (await page.request.get(`/api/v1/links/${id}`)).json();
  expect(Date.parse(archived.removal_at) - Date.parse(archived.archived_at)).toBe(180 * DAY);

  await page.goto('/');
  await expect(page.locator(`a[href="/api/v1/links/${id}/open"]`)).toHaveCount(0);

  await page.goto('/archive');
  const row = page.getByRole('article', { name: 'example.org' });
  await expect(row.getByText(`removed on ${archived.removal_at.slice(0, 10)}`)).toBeVisible();
  await row.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('article')).toHaveCount(0);

  const restored = await (await page.request.get(`/api/v1/links/${id}`)).json();
  expect(restored.state).toBe('active');
  expect(restored.archived_at).toBeNull();
  expect(Date.now() - Date.parse(restored.last_used_at)).toBeLessThan(60_000);

  await page.goto('/');
  await expect(page.getByRole('article').first()).toHaveAttribute('aria-label', 'example.org');
  await page.goto('/archive');
  await expect(page.getByText('Nothing is archived.')).toBeVisible();
});

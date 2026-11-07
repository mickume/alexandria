import { expect, test } from '@playwright/test';
import { d1 } from './helpers';

test('the owner signs in, adds a link and opens it', async ({ page }) => {
  d1("DELETE FROM sessions; DELETE FROM links WHERE url LIKE 'https://example.com/%'");
  await page.route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Article</title>' }),
  );

  await page.goto('/');
  await expect(page).toHaveURL(/\/signin$/);
  await page.getByRole('link', { name: 'Sign in with Google' }).click();
  await expect(page).toHaveURL(/\/$/);

  const input = page.getByLabel('Add links');
  await input.fill('https://example.com/article?utm_source=x');
  const entered = Date.now();
  await input.press('Enter');
  const first = page.getByRole('article').first();
  await expect(first).toHaveAttribute('aria-label', 'example.com', { timeout: 1000 });
  await expect(first.getByText('pending')).toBeVisible({ timeout: 1000 });
  expect(Date.now() - entered).toBeLessThanOrEqual(1000);

  await first.getByRole('link', { name: 'example.com' }).click();
  await expect(page).toHaveURL('https://example.com/article');

  await page.goto('/');
  const card = page.getByRole('article').first();
  await expect(card).toHaveAttribute('aria-label', 'example.com');
  await expect(card.getByText('Used just now')).toBeVisible();

  const users = d1<{ name: string }>("SELECT name FROM users WHERE email = 'owner@example.test'");
  expect(users).toEqual([{ name: 'Ada Owner' }]);
  expect(d1<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')).toEqual([{ n: 1 }]);
  expect(
    d1(
      "SELECT url, original_url, state, use_count FROM links WHERE url = 'https://example.com/article'",
    ),
  ).toEqual([
    {
      url: 'https://example.com/article',
      original_url: 'https://example.com/article?utm_source=x',
      state: 'pending',
      use_count: 1,
    },
  ]);
});

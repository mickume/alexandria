import { expect, test } from '@playwright/test';
import { d1, signIn } from './helpers';

test('a script uses a personal access token until the owner revokes it', async ({
  page,
  playwright,
  baseURL,
}) => {
  await signIn(page);
  await page.goto('/settings');
  await page.getByLabel('Token name').fill('laptop script');
  await page.getByRole('button', { name: 'Create token' }).click();
  const secret = (await page.locator('.secret').textContent()) ?? '';
  expect(secret).toMatch(/^alx_/);
  await page.getByRole('button', { name: 'Done' }).click();

  // The script: no cookies, only the token.
  const script = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${secret}` },
  });
  const scriptStart = new Date().toISOString();
  const added = await script.post('/api/v1/links', { data: { url: 'https://example.org/docs' } });
  expect(added.status()).toBe(201);
  const listed = await script.get('/api/v1/links');
  expect(listed.status()).toBe(200);
  // A new link starts at the start points: below links used more, above the rest.
  expect((await listed.json()).items.map((l: { url: string }) => l.url)).toContain(
    'https://example.org/docs',
  );
  const scriptEnd = new Date().toISOString();

  const row = page.getByRole('listitem', { name: 'laptop script' });
  await row.getByRole('button', { name: 'Revoke' }).click();
  await expect(row).toHaveCount(0);

  const refused = await script.get('/api/v1/links');
  expect(refused.status()).toBe(401);
  expect(await refused.json()).toEqual({ error: 'unauthorized' });
  await script.dispose();

  await page.goto('/');
  await expect(page.getByRole('article', { name: 'example.org' })).toBeVisible();
  const [token] = d1<{ revoked_at: string | null; last_used_at: string | null }>(
    "SELECT revoked_at, last_used_at FROM tokens WHERE name = 'laptop script'",
  );
  expect(token?.revoked_at).not.toBeNull();
  // The token records every use: its last one is the script's last accepted request.
  expect(token?.last_used_at && token.last_used_at >= scriptStart).toBe(true);
  expect(token?.last_used_at && token.last_used_at <= scriptEnd).toBe(true);

  await page.goto('/settings');
  await expect(page.getByRole('listitem', { name: 'laptop script' })).toHaveCount(0);
  expect(await page.content()).not.toContain(secret);
});

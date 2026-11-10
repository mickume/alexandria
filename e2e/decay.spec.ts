import { expect, test } from '@playwright/test';
import { cardOf, d1, daysAgo, runScheduled, signIn } from './helpers';

const DAY = 86_400_000;

test('a link unused for longer than its start points expires and the owner restores it', async ({
  page,
}) => {
  await signIn(page);
  const origin = new URL(page.url()).origin;
  const added = await page.request.post('/api/v1/links', {
    data: { url: 'https://example.org/old' },
    headers: { Origin: origin },
  });
  const id: string = (await added.json()).link.id;
  d1(`UPDATE links SET last_used_at = '${daysAgo(61)}' WHERE id = '${id}'`);

  await runScheduled(page);
  await expect
    .poll(async () => (await (await page.request.get(`/api/v1/links/${id}`)).json()).state, {
      timeout: 30_000,
    })
    .toBe('expired');
  const expired = await (await page.request.get(`/api/v1/links/${id}`)).json();
  expect(Date.parse(expired.removal_at) - Date.parse(expired.expired_at)).toBe(180 * DAY);

  await page.goto('/');
  await expect(cardOf(page, id)).toHaveCount(0);

  await page.goto('/expired');
  const row = page.getByRole('article', { name: 'example.org' });
  await expect(row.getByText(`removed on ${expired.removal_at.slice(0, 10)}`)).toBeVisible();
  await row.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('article')).toHaveCount(0);

  const restored = await (await page.request.get(`/api/v1/links/${id}`)).json();
  expect(restored.state).toBe('active');
  expect(restored.expired_at).toBeNull();
  expect(Date.now() - Date.parse(restored.last_used_at)).toBeLessThan(60_000);

  await page.goto('/');
  await expect(cardOf(page, id)).toBeVisible();
  await page.goto('/expired');
  await expect(page.getByText('Nothing has expired.')).toBeVisible();
});

test('the stream lists a much-used link above a recently used one, each with its points', async ({
  page,
}) => {
  await signIn(page);
  const origin = new URL(page.url()).origin;
  const add = async (url: string) =>
    (
      await (
        await page.request.post('/api/v1/links', { data: { url }, headers: { Origin: origin } })
      ).json()
    ).link.id as string;
  const used = await add('https://example.org/much-used');
  const recent = await add('https://example.org/recent');
  for (let i = 0; i < 10; i++) {
    await page.request.get(`/api/v1/links/${used}/open`, { maxRedirects: 0 });
  }
  await page.request.get(`/api/v1/links/${recent}/open`, { maxRedirects: 0 });
  d1(`UPDATE links SET last_used_at = '${daysAgo(5)}' WHERE id = '${used}'`);

  await page.goto('/');
  await expect(cardOf(page, used).getByText('expires in 65 days')).toBeVisible();
  await expect(cardOf(page, recent).getByText('expires in 61 days')).toBeVisible();
  // Each card's links to its address, in the order the stream lists the cards.
  const ids = await page
    .locator('article a[href$="/open"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
  const at = (id: string) => ids.findIndex((h) => h === `/api/v1/links/${id}/open`);
  expect(at(used)).toBeGreaterThanOrEqual(0);
  expect(at(used)).toBeLessThan(at(recent));

  // The other specs share this library and expect a link they add to lead the stream.
  for (const id of [used, recent]) {
    await page.request.delete(`/api/v1/links/${id}`, { headers: { Origin: origin } });
  }
});

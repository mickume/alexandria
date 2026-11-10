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
  const past = daysAgo(61);
  d1(`UPDATE links SET last_used_at = '${past}', decay_from = '${past}' WHERE id = '${id}'`);

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
  const past = daysAgo(5);
  d1(`UPDATE links SET last_used_at = '${past}', decay_from = '${past}' WHERE id = '${used}'`);

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

test('a use of a link close to expiry wins back half its decay and lands it mid-stream', async ({
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
  const open = (id: string) => page.request.get(`/api/v1/links/${id}/open`, { maxRedirects: 0 });
  const a = await add('https://example.org/steady');
  const b = await add('https://example.org/fading');
  for (let i = 0; i < 5; i++) {
    await open(a);
    await open(b);
  }
  for (const [id, days] of [
    [a, 6],
    [b, 62],
  ] as const) {
    const past = daysAgo(days);
    d1(`UPDATE links SET last_used_at = '${past}', decay_from = '${past}' WHERE id = '${id}'`);
  }

  // The order of the cards, by their links to their addresses.
  const order = async () => {
    const hrefs = await page
      .locator('article a[href$="/open"]')
      .evaluateAll((links) => links.map((l) => l.getAttribute('href')));
    return (id: string) => hrefs.indexOf(`/api/v1/links/${id}/open`);
  };

  await open(b);
  await page.goto('/');
  await expect(cardOf(page, b).getByText('expires in 35 days')).toBeVisible();
  await expect(cardOf(page, a).getByText('expires in 59 days')).toBeVisible();
  const at = await order();
  expect(at(a)).toBeGreaterThanOrEqual(0);
  expect(at(a)).toBeLessThan(at(b));

  await open(b);
  await page.reload();
  await expect(cardOf(page, b).getByText('expires in 36 days')).toBeVisible();
  const link = await (await page.request.get(`/api/v1/links/${b}`)).json();
  expect(link.use_count).toBe(7);
  expect(Math.abs(Date.now() - 31 * DAY - Date.parse(link.decay_from))).toBeLessThan(60_000);

  // The other specs share this library and expect a link they add to lead the stream.
  for (const id of [a, b]) {
    await page.request.delete(`/api/v1/links/${id}`, { headers: { Origin: origin } });
  }
});

test('the owner sets the use boost on the Settings page, and at 100 a use gives back every point', async ({
  page,
}) => {
  await signIn(page);
  const origin = new URL(page.url()).origin;
  await page.goto('/settings');
  const section = page.locator('section.decay-settings');
  const boost = section.getByLabel('Use boost (%)');
  await boost.fill('5');
  await section.getByRole('button', { name: 'Save' }).click();
  await expect(
    section
      .locator('[data-field="use_boost"]')
      .getByText('use_boost must be a whole number from 10 to 100'),
  ).toBeVisible();
  await boost.fill('100');
  await section.getByRole('button', { name: 'Save' }).click();
  await expect(section.getByRole('status')).toHaveText('Saved');
  await expect(boost).toHaveValue('100');
  const settings = await (await page.request.get('/api/v1/settings/decay')).json();
  expect(settings.use_boost).toBe(100);

  const added = await page.request.post('/api/v1/links', {
    data: { url: 'https://example.org/twenty-days' },
    headers: { Origin: origin },
  });
  const id: string = (await added.json()).link.id;
  const past = daysAgo(20);
  d1(`UPDATE links SET last_used_at = '${past}', decay_from = '${past}' WHERE id = '${id}'`);
  await page.request.get(`/api/v1/links/${id}/open`, { maxRedirects: 0 });
  const link = await (await page.request.get(`/api/v1/links/${id}`)).json();
  expect(link.decay_from).toBe(link.last_used_at);

  const stream = await (await page.request.get('/api/v1/links')).json();
  const pinned = new Set<string>(
    stream.items.filter((l: { pinned: boolean }) => l.pinned).map((l: { id: string }) => l.id),
  );
  await page.goto('/');
  await expect(cardOf(page, id)).toBeVisible();
  const hrefs = await page
    .locator('article a[href$="/open"]')
    .evaluateAll((links) => links.map((l) => l.getAttribute('href')));
  const unpinned = hrefs.filter((h) => !pinned.has(h?.split('/')[4] ?? ''));
  expect(unpinned[0]).toBe(`/api/v1/links/${id}/open`);

  // The other specs share this library and its settings.
  await page.request.put('/api/v1/settings/decay', {
    data: { ...settings, use_boost: 50 },
    headers: { Origin: origin },
  });
  await page.request.delete(`/api/v1/links/${id}`, { headers: { Origin: origin } });
});

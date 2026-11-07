import { expect, test } from '@playwright/test';
import { addLinkIds, cardOf, d1, fakeAi, saveAiKey, signIn } from './helpers';

const QUEUES = 'https://docs.example/queues';
const KAFKA = 'https://blog.example/kafka';

test('the owner searches with a filter and clears the search', async ({ page }) => {
  await fakeAi.answerWhen('Cloudflare Queues deliver', {
    summary: 'How Cloudflare Queues deliver messages.',
    tags: ['cloudflare', 'queues', 'messaging'],
    topic: 'Infrastructure',
  });
  await fakeAi.answerWhen('Apache Kafka keeps', {
    summary: 'How Kafka keeps a log.',
    tags: ['kafka', 'streaming', 'logs'],
    topic: 'Data',
  });
  await signIn(page);
  await saveAiKey(page);
  const [queues, kafka] = await addLinkIds(page, [QUEUES, KAFKA]);
  await page.goto('/');
  await expect(cardOf(page, queues!).getByRole('list', { name: 'Tags' })).toContainText(
    'cloudflare',
    { timeout: 60_000 },
  );
  await expect(cardOf(page, kafka!).getByRole('list', { name: 'Tags' })).toContainText('kafka', {
    timeout: 60_000,
  });

  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('/');
  const box = page.getByRole('searchbox', { name: 'Search' });
  await expect(box).toBeFocused();
  const searched = page.waitForResponse((r) => r.url().includes('/api/v1/search?q='));
  await page.keyboard.type('queues tag:cloudflare');
  expect(new URL((await searched).url()).searchParams.get('q')).toBe('queues tag:cloudflare');
  await expect(page).toHaveURL('/search?q=queues%20tag%3Acloudflare');

  const results = page.getByRole('list', { name: 'Results' });
  await expect(results.getByRole('article')).toHaveCount(1);
  await expect(cardOf(page, queues!)).toBeVisible();
  await expect(cardOf(page, kafka!)).toHaveCount(0);
  await expect(results.locator('.snippet mark', { hasText: 'Queues' })).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL('/');
  await expect(box).toHaveValue('');
  await expect(box).not.toBeFocused();

  const [owner] = d1<{ id: string }>("SELECT id FROM users WHERE email = 'owner@example.test'");
  const rows = d1<{ owner: string; link_id: string }>(
    `SELECT owner, link_id FROM link_search WHERE link_id IN ('${queues}', '${kafka}')`,
  );
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(row.owner).toBe(`u${owner!.id.replace(/-/g, '')}`);
});

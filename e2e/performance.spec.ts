import { expect, test } from '@playwright/test';
import { addLinks, signIn } from './helpers';

test('the first page of 50 links is interactive within 1.5 s on throttled 4G', async ({ page }) => {
  await signIn(page);
  await addLinks(
    page,
    Array.from({ length: 50 }, (_, i) => `https://perf${i}.example/article`),
  );

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 170,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (1.5 * 1024 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const durations: number[] = [];
  for (let run = 0; run < 3; run++) {
    await page.goto('about:blank');
    const t0 = Date.now();
    await page.goto('/');
    const last = page.getByRole('article').nth(49);
    await expect(last).toBeVisible();
    await expect(last.getByRole('button', { name: 'Pin' })).toBeEnabled();
    durations.push(Date.now() - t0);
  }
  durations.sort((a, b) => a - b);
  expect(durations[1]).toBeLessThanOrEqual(1500);
});

import { expect, test, type Page } from '@playwright/test';
import { addLinkIds, d1, daysAgo, runMinute, runScheduled, signIn } from './helpers';

/** The statistics as the API answers them now. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function statsNow(page: Page): Promise<any> {
  const r = await page.request.get('/api/v1/stats');
  expect(r.status()).toBe(200);
  return r.json();
}

/** A count as the page writes it. */
function num(n: number): string {
  return n.toLocaleString('en-US');
}

/** The table row headed `label` within `scope`. */
function countOf(page: Page, label: string, scope = page.locator('main')) {
  return scope.getByRole('rowheader', { name: label, exact: true }).locator('xpath=..');
}

/** Waits until every link of `ids` is no longer pending. */
async function waitFetched(page: Page, ids: string[]): Promise<void> {
  for (const id of ids) {
    await expect
      .poll(async () => (await (await page.request.get(`/api/v1/links/${id}`)).json()).state, {
        timeout: 30_000,
      })
      .not.toBe('pending');
  }
}

test('the owner adds links and sees them counted on the Stats page', async ({ page }) => {
  await signIn(page);
  const before = await statsNow(page);
  const today = before.activity.added_per_day.at(-1);
  const ids = await addLinkIds(page, [
    'https://code.example/stats-one',
    'https://code.example/stats-two',
    'https://code.example/stats-three',
  ]);
  await waitFetched(page, ids);

  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'Stats' })
    .click();
  await expect(page).toHaveURL(/\/stats$/);
  const library = page.getByRole('region', { name: 'Library' });
  await expect(countOf(page, 'All links', library)).toContainText(num(before.library.total + 3));
  // Other specs' links may still be fetched meanwhile: the three new ones are among the active.
  const active = await countOf(page, 'Active', library).locator('td').textContent();
  expect(Number((active ?? '').replace(/,/g, ''))).toBeGreaterThanOrEqual(
    before.library.by_state.active + 3,
  );
  const bars = page.getByRole('img', { name: 'Added per day' }).locator('rect');
  await expect(bars).toHaveCount(30);
  await expect(bars.last().locator('title')).toHaveText(`${today.day}: ${today.count + 3}`);
});

test('a link reaches 0 points, decay expires it, and the owner follows the count', async ({
  page,
}) => {
  await signIn(page);
  const [id = ''] = await addLinkIds(page, ['https://code.example/stats-expiring']);
  await waitFetched(page, [id]);
  d1(`UPDATE links SET last_used_at = '${daysAgo(61)}' WHERE id = '${id}'`);
  d1('UPDATE users SET last_decay_at = NULL');
  const before = await statsNow(page);
  expect(before.expiry.expiring.today).toBeGreaterThanOrEqual(1);

  await page.goto('/stats');
  const expiry = page.getByRole('region', { name: 'Expiry' });
  await expect(countOf(page, 'Expires today', expiry)).toContainText(
    num(before.expiry.expiring.today),
  );

  await runScheduled(page);
  await expect
    .poll(async () => (await (await page.request.get(`/api/v1/links/${id}`)).json()).state, {
      timeout: 30_000,
    })
    .toBe('expired');
  const after = await statsNow(page);
  expect(after.library.by_state.expired).toBeGreaterThanOrEqual(
    before.library.by_state.expired + 1,
  );
  await page.getByRole('button', { name: 'Refresh' }).click();
  const expired = countOf(page, 'Expired', page.getByRole('region', { name: 'Library' }));
  await expect(expired).toContainText(num(after.library.by_state.expired));
  await expired.getByRole('link').click();
  await expect(page).toHaveURL(/\/expired$/);
  await expect(page.getByRole('article', { name: 'Code stats-expiring' })).toBeVisible();
});

test('an import shows under Background work until it is done', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  // Earlier imports' waiting links would be sent first: set them aside, so this
  // path sends only its own links.
  d1(
    `UPDATE import_links SET skipped = 1, dispatched_at = '${new Date().toISOString()}' WHERE dispatched_at IS NULL`,
  );
  const urls = Array.from({ length: 50 }, (_, i) => `https://code.example/stats-import-${i}`);
  const uploaded = await page.request.post('/api/v1/imports', {
    data: `${urls.join('\n')}\n`,
    headers: { 'Content-Type': 'text/plain', Origin: new URL(page.url()).origin },
  });
  expect(uploaded.status()).toBe(201);
  const report = await uploaded.json();
  expect(report.counts.added).toBe(50);
  const label = `Import of ${report.created_at.slice(0, 10)}`;

  await page.goto('/stats');
  const background = page.getByRole('region', { name: 'Background work' });
  const listed = (await statsNow(page)).backlog.imports.find(
    (i: { id: string }) => i.id === report.id,
  );
  expect(listed.waiting + listed.in_progress + listed.done).toBe(50);
  expect(listed.waiting + listed.in_progress).toBeGreaterThan(0);
  await expect(background.getByRole('rowheader', { name: label }).first()).toBeVisible();

  // Each run sends at most 20 links; moving this import's sent links back a
  // minute (and freeing the throttle) frees the budget, as a minute passing would.
  await expect
    .poll(
      async () => {
        d1(
          `UPDATE import_links SET dispatched_at = '${new Date(Date.now() - 120_000).toISOString()}' WHERE import_id = '${report.id}' AND dispatched_at IS NOT NULL; UPDATE users SET throttle_next_at = NULL, import_window_end = NULL`,
        );
        await runMinute(page);
        const progress = (await (await page.request.get(`/api/v1/imports/${report.id}`)).json())
          .progress;
        return progress.waiting + progress.in_progress;
      },
      { timeout: 150_000, intervals: [2_000] },
    )
    .toBe(0);
  // The enrichments this import queued keep their slots; later work need not wait behind them.
  d1('UPDATE users SET throttle_next_at = NULL');

  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('region', { name: 'Activity' })).toBeVisible();
  const now = await statsNow(page);
  expect(now.backlog.imports.map((i: { id: string }) => i.id)).not.toContain(report.id);
  expect(now.activity.imports[0]).toMatchObject({ id: report.id, added: 50 });
  const activity = page.getByRole('region', { name: 'Activity' });
  await expect(activity.getByRole('rowheader', { name: label }).first()).toBeVisible();
  await expect(activity.getByText('50 added of 50').first()).toBeVisible();
});

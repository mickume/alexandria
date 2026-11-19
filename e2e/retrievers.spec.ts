import { expect, test, type Page } from '@playwright/test';
import { cardOf, fakeOrigin, signIn } from './helpers';

/** Pastes `url` into the add input, and returns its card once its title reads `title`. */
async function addAndWait(page: Page, url: string, title: string) {
  const input = page.getByLabel('Add links');
  await input.fill(url);
  const added = page.waitForResponse((r) => r.url().endsWith('/api/v1/links/batch'));
  await input.press('Enter');
  const body = (await (await added).json()) as { added: { id: string }[] };
  const id = body.added[0]!.id;
  const card = cardOf(page, id);
  await expect(card.getByRole('link', { name: title })).toBeVisible({ timeout: 60_000 });
  return { id, card };
}

test.describe('retrieving links through their sites’ APIs', () => {
  test.afterEach(async () => {
    await fakeOrigin.githubDown(false);
  });

  test('a GitHub repository is stored as GitHub’s API describes it, its README searchable', async ({
    page,
  }) => {
    await signIn(page);
    const { id, card } = await addAndWait(
      page,
      'https://github.com/acme/widget',
      'widget: Widgets for everyone',
    );
    await expect(card.getByText('★ 12.3k')).toBeVisible();
    await expect(card.getByText('TypeScript')).toBeVisible();

    await page.goto(`/links/${id}`);
    const section = page.getByRole('region', { name: 'From GitHub' });
    await expect(section.getByText('acme', { exact: true })).toBeVisible();
    await expect(section.getByText('MIT')).toBeVisible();

    await page.goto('/search?q=frobnicator');
    await expect(page.getByRole('link', { name: 'widget: Widgets for everyone' })).toBeVisible();
  });

  test('a YouTube video is stored as YouTube’s API describes it', async ({ page }) => {
    await signIn(page);
    const { id, card } = await addAndWait(page, 'https://youtu.be/dQw4w9WgXcQ', 'A Fixture Video');
    await expect(card.getByText('Fixture Channel')).toBeVisible();
    await expect(card.getByText('12:34')).toBeVisible();

    await page.goto(`/links/${id}`);
    await expect(
      page.getByText('A video about fixtures, described at length by its channel.'),
    ).toBeVisible();
    const section = page.getByRole('region', { name: 'From YouTube' });
    await expect(section.locator('img')).toBeVisible();
  });

  test('a repository is fetched as a page when GitHub’s API is down, and says why', async ({
    page,
  }) => {
    await fakeOrigin.githubDown(true);
    await signIn(page);
    const { id, card } = await addAndWait(
      page,
      'https://github.com/acme/fallback',
      'fallback: From the page',
    );
    await expect(card.getByText('★', { exact: false })).toHaveCount(0);
    await page.goto(`/links/${id}`);
    await expect(
      page
        .getByRole('list', { name: 'History' })
        .getByText('Fetched (GitHub API: unreachable; fetched as the page)', { exact: false }),
    ).toBeVisible();
  });
});

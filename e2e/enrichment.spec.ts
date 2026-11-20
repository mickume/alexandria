import { expect, test, type Page } from '@playwright/test';
import { d1, fakeAi, runMinute, signIn } from './helpers';

const FIRST = {
  summary: 'The fake summary of the article.',
  tags: ['links', 'library', 'reading'],
  topic: 'Reading',
};
const SECOND = {
  summary: 'A second, newer summary.',
  tags: ['changed', 'tags', 'here'],
  topic: 'Changed',
};

/** Pastes `text` and returns the ids of the links it added or boosted. */
async function paste(page: Page, text: string): Promise<string[]> {
  const input = page.getByLabel('Add links');
  await input.fill(text);
  const answered = page.waitForResponse((r) => r.url().endsWith('/api/v1/links/batch'));
  await input.press('Enter');
  const body = (await (await answered).json()) as {
    added: { id: string }[];
    boosted: { id: string }[];
  };
  return [...body.added, ...body.boosted].map((l) => l.id);
}

/** The stream card of the link `id`. */
function cardOf(page: Page, id: string) {
  return page
    .locator('article', { has: page.locator(`a[href="/api/v1/links/${id}/open"]`) })
    .first();
}

test.describe.serial('enriching links', () => {
  test('a pasted link is enriched with the deployment’s key within a minute', async ({ page }) => {
    await fakeAi.answer(FIRST);
    await signIn(page);
    await page.goto('/');
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    const [id] = await paste(page, 'https://news.example/enriched?utm_source=x');
    const card = cardOf(page, id!);
    await expect(card.getByText(FIRST.summary)).toBeVisible({ timeout: 60_000 });
    for (const tag of FIRST.tags) await expect(card.getByText(tag, { exact: true })).toBeVisible();
    await expect(card.getByText(FIRST.topic, { exact: true })).toBeVisible();
    expect(navigations).toBe(0);

    const anthropic = (await fakeAi.requests()).filter((r) => r.provider === 'anthropic');
    for (const r of anthropic) {
      expect(r.auth).toBe('sk-ant-test-1234');
      expect(r.body).not.toContain('sk-ant-test-1234');
    }
    const enrichment = anthropic.filter((r) => r.enrichment).at(-1)!;
    expect(enrichment.body).toContain('This is the first paragraph of the article');
    expect(enrichment.body).not.toContain('owner@example.test');
  });

  test('links waiting for a key are enriched by the every-minute run, 3 seconds apart', async ({
    page,
  }) => {
    await fakeAi.answer(FIRST);
    await signIn(page);
    await page.goto('/');
    const ids = await paste(page, 'https://news.example/two-a\nhttps://news.example/two-b');
    for (const id of ids) {
      await expect(cardOf(page, id).getByText(FIRST.summary)).toBeVisible({ timeout: 60_000 });
    }
    // As links fetched while the deployment had no key are left.
    d1(
      `UPDATE links SET enrichment_status = 'no_key', summary = NULL
       WHERE id IN (${ids.map((id) => `'${id}'`).join(', ')})`,
    );
    await fakeAi.answer(SECOND);
    const before = (await fakeAi.requests()).length;
    await runMinute(page);
    await page.reload();
    for (const id of ids) {
      await expect(cardOf(page, id).getByText(SECOND.summary)).toBeVisible({ timeout: 60_000 });
    }
    const enrichments = (await fakeAi.requests()).slice(before).filter((r) => r.enrichment);
    expect(enrichments).toHaveLength(2);
    // Their slots are 3 seconds apart; the queue delivers each within a little of its slot,
    // and nothing else spaces the starts (docs/errata/03_ai_enrichment.md, item 4).
    expect(enrichments[1]!.at - enrichments[0]!.at).toBeGreaterThanOrEqual(2_500);
    await fakeAi.answer(FIRST);
  });

  test('the owner’s edits survive a refresh', async ({ page }) => {
    await signIn(page);
    const card = page
      .getByRole('article', { name: 'An Article' })
      .filter({ hasText: FIRST.summary })
      .first();
    await card.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Details' }).click();
    await page.getByRole('button', { name: 'Edit tags' }).click();
    await page.getByLabel('Tags').fill('mine');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Edit topic' }).click();
    await page.getByLabel('Topic').fill('Mine');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('field-topic')).toContainText('Mine');
    const id = page.url().split('/links/')[1]!;

    await fakeAi.answer(SECOND);
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect
      .poll(async () => (await (await page.request.get(`/api/v1/links/${id}`)).json()).summary, {
        timeout: 60_000,
      })
      .toBe(SECOND.summary);
    const link = await (await page.request.get(`/api/v1/links/${id}`)).json();
    expect(link.tags).toEqual(['mine']);
    expect(link.topic).toBe('Mine');
    expect(link.edited_fields).toEqual(expect.arrayContaining(['tags', 'topic']));

    await page.goto('/');
    const updated = page.getByRole('article').filter({ hasText: SECOND.summary });
    await expect(updated.getByText('mine', { exact: true })).toBeVisible();
    await expect(updated.getByText('Mine', { exact: true })).toBeVisible();
  });
});

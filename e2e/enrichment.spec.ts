import { expect, test, type Page } from '@playwright/test';
import { d1, fakeAi, signIn } from './helpers';

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

async function saveKey(
  page: Page,
  provider: 'Anthropic' | 'OpenRouter',
  key: string,
  model?: string,
) {
  await page.goto('/settings');
  await page.getByLabel('Provider').selectOption({ label: provider });
  await page.getByLabel('API key').fill(key);
  if (model) await page.getByLabel('Model').fill(model);
  await page.getByRole('button', { name: 'Save key' }).click();
  await expect(page.getByText('key verified')).toBeVisible();
}

test.describe.serial('enriching links', () => {
  test('links added without a key are enriched after the owner adds one', async ({ page }) => {
    await fakeAi.answer(FIRST);
    await signIn(page);
    await page.request.delete('/api/v1/settings/ai', {
      headers: { Origin: new URL(page.url()).origin },
    });
    await page.goto('/');
    const ids = await paste(page, 'https://news.example/two-a\nhttps://news.example/two-b');
    for (const id of ids) {
      await expect(cardOf(page, id)).toHaveAttribute('aria-label', 'An Article', {
        timeout: 60_000,
      });
    }
    await page.reload();
    await expect(page.getByText('not enriched: add an AI key in settings')).toHaveCount(1);
    await expect(page.getByText(FIRST.summary)).toHaveCount(0);

    await saveKey(page, 'OpenRouter', 'sk-or-e2e-5678', 'test/model');
    await page.getByRole('button', { name: 'Enrich all unenriched links (2)' }).click();
    await expect(page.getByText('queued 2 links')).toBeVisible();

    await page.goto('/');
    for (const id of ids) {
      await expect(cardOf(page, id).getByText(FIRST.summary)).toBeVisible({ timeout: 60_000 });
    }
    await expect(page.getByText('not enriched: add an AI key in settings')).toHaveCount(0);
    const enrichments = (await fakeAi.requests()).filter(
      (r) => r.enrichment && r.provider === 'openrouter',
    );
    expect(enrichments).toHaveLength(2);
    expect(enrichments[1]!.at - enrichments[0]!.at).toBeGreaterThanOrEqual(3_000);
  });

  test('the owner adds a key and a pasted link is enriched within a minute', async ({ page }) => {
    await fakeAi.answer(FIRST);
    await signIn(page);
    await saveKey(page, 'Anthropic', 'sk-ant-test-1234');
    await expect(page.getByText('…1234')).toBeVisible();

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

    const stored = d1<{ n: number }>(
      "SELECT COUNT(*) AS n FROM users WHERE ai_key_ciphertext LIKE '%sk-ant-test%' OR ai_key_last4 = 'sk-ant-test-1234'",
    );
    expect(stored).toEqual([{ n: 0 }]);
    const anthropic = (await fakeAi.requests()).filter((r) => r.provider === 'anthropic');
    for (const r of anthropic) {
      expect(r.auth).toBe('sk-ant-test-1234');
      expect(r.body).not.toContain('sk-ant-test-1234');
    }
    const enrichment = anthropic.filter((r) => r.enrichment).at(-1)!;
    expect(enrichment.body).toContain('This is the first paragraph of the article');
    expect(enrichment.body).not.toContain('owner@example.test');
  });

  test('the owner’s edits survive a refresh', async ({ page }) => {
    await signIn(page);
    const card = page
      .getByRole('article', { name: 'An Article' })
      .filter({ hasText: FIRST.summary })
      .first();
    await card.getByRole('button', { name: 'More actions' }).click();
    await card.getByRole('link', { name: 'Details' }).click();
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

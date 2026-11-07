import { expect, test, type Page } from '@playwright/test';
import { addLinkIds, cardOf, d1, fakeAi, saveAiKey, signIn } from './helpers';

const answer = (tags: string[]) => ({ summary: 'About code.', tags, topic: 'Programming' });

/** The Tags page's row of `name`. */
function row(page: Page, name: string) {
  return page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) });
}

async function tagsOf(page: Page, id: string) {
  return cardOf(page, id)
    .getByRole('list', { name: 'Tags' })
    .getByRole('listitem')
    .allTextContents();
}

test('the owner merges two tags and later enrichment uses the survivor', async ({ page }) => {
  await fakeAi.answerWhen('marker-js-one', answer(['js', 'scripting', 'web']));
  await fakeAi.answerWhen('marker-js-two', answer(['js', 'scripting', 'web']));
  await fakeAi.answerWhen('marker-javascript-one', answer(['javascript', 'scripting', 'web']));
  await fakeAi.answerWhen('marker-new-page', answer(['js', 'frontend', 'react']));
  await signIn(page);
  await saveAiKey(page);
  const seeded = await addLinkIds(page, [
    'https://code.example/js-one',
    'https://code.example/js-two',
    'https://code.example/javascript-one',
  ]);
  await page.goto('/');
  for (const id of seeded) {
    await expect(cardOf(page, id).getByRole('list', { name: 'Tags' })).toContainText('scripting', {
      timeout: 60_000,
    });
  }

  await page.goto('/tags');
  await expect(row(page, 'js').getByRole('cell').nth(1)).toHaveText('2');
  await expect(row(page, 'javascript').getByRole('cell').nth(1)).toHaveText('1');
  await row(page, 'js').getByRole('button', { name: 'Merge' }).click();
  await row(page, 'js').getByRole('combobox', { name: 'Merge into' }).selectOption({
    label: 'javascript',
  });
  await row(page, 'js').getByRole('button', { name: 'Merge into it' }).click();
  await expect(row(page, 'javascript').getByRole('cell').nth(1)).toHaveText('3');
  await expect(row(page, 'js')).toHaveCount(0);

  const [fresh] = await addLinkIds(page, ['https://code.example/new-page']);
  await page.goto('/');
  await expect(cardOf(page, fresh!).getByRole('list', { name: 'Tags' })).toContainText('frontend', {
    timeout: 60_000,
  });
  expect(await tagsOf(page, fresh!)).toEqual(['javascript', 'frontend', 'react']);

  await page.goto('/tags');
  await expect(row(page, 'javascript').getByRole('cell').nth(1)).toHaveText('4');
  await expect(row(page, 'js')).toHaveCount(0);

  const names = d1<{ name: string }>(
    "SELECT t.name FROM tags t JOIN users u ON u.id = t.user_id WHERE u.email = 'owner@example.test' AND t.name IN ('js', 'javascript', 'frontend') ORDER BY t.name",
  ).map((r) => r.name);
  expect(names).toEqual(['frontend', 'javascript']);
  const found = await page.request.get(`/api/v1/search?q=${encodeURIComponent('tag:javascript')}`);
  expect(((await found.json()) as { items: unknown[] }).items).toHaveLength(4);
});

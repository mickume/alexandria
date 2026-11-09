import { expect, test, type Page } from '@playwright/test';
import { addLinkIds, fakeAi, saveAiKey, signIn } from './helpers';

const ALARMS = 'https://example.com/alarms-for-agents';
const QUESTION = 'how do I schedule background work on Cloudflare?';

/** Opens the Ask page, types the question and presses Ask. */
async function ask(page: Page, question: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'Ask' })
    .click();
  await expect(page).toHaveURL('/ask');
  await page.getByRole('textbox', { name: 'Question' }).fill(question);
  await page.getByRole('button', { name: 'Ask' }).click();
}

/** How many questions the fake provider has received. */
async function questionsAsked(): Promise<number> {
  return (await fakeAi.requests()).filter((r) => r.ask).length;
}

test.describe.serial('the owner asks the library', () => {
  let article = '';

  test('gets an answer that cites an article, and opens it from the citation', async ({ page }) => {
    await signIn(page);
    await saveAiKey(page);
    [article = ''] = await addLinkIds(page, [ALARMS]);
    await expect
      .poll(
        async () => {
          const r = await page.request.get(`/api/v1/passages?q=${encodeURIComponent(QUESTION)}`);
          return ((await r.json()) as { items: { link_id: string }[] }).items.some(
            (i) => i.link_id === article,
          );
        },
        { timeout: 60_000 },
      )
      .toBe(true);

    await page.goto('/');
    await ask(page, QUESTION);

    const answer = page.getByRole('region', { name: 'Answer' });
    await expect(answer).toContainText('Durable Object alarm');
    const sources = page.getByRole('list', { name: 'Sources' });
    await expect(sources).toContainText('Alarms for agents');
    await expect(sources).toContainText('example.com');

    await answer.getByRole('link', { name: '[1]' }).click();
    await expect(page).toHaveURL(`/links/${article}`);
  });

  test('is told to add a key when there is none, without the provider being asked', async ({
    page,
  }) => {
    await signIn(page);
    await page.request.delete('/api/v1/settings/ai', {
      headers: { Origin: new URL(page.url()).origin },
    });
    const before = await questionsAsked();

    await page.goto('/');
    await ask(page, QUESTION);

    await expect(page.getByRole('alert')).toHaveText('add an AI key in settings');
    expect(await questionsAsked()).toBe(before);
  });

  test('is shown the provider’s message when it rejects the key, and the settings show the key rejected', async ({
    page,
  }) => {
    await signIn(page);
    await saveAiKey(page);
    await fakeAi.rejectAnswers(401, 'invalid x-api-key');
    try {
      await page.goto('/');
      await ask(page, QUESTION);

      await expect(page.getByRole('alert')).toHaveText('invalid x-api-key');

      await page.goto('/settings');
      await expect(page.getByText('your AI key was rejected: invalid x-api-key')).toBeVisible();
    } finally {
      await fakeAi.rejectAnswers();
      // The specs share one library: leave it without a key and without the article.
      const origin = new URL(page.url()).origin;
      await page.request.delete('/api/v1/settings/ai', { headers: { Origin: origin } });
      await page.request.delete(`/api/v1/links/${article}`, { headers: { Origin: origin } });
    }
  });
});

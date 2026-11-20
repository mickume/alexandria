import { expect, test, type Page } from '@playwright/test';
import { addLinkIds, d1, fakeAi, signIn } from './helpers';

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

test.describe.serial('the owner asks the library', () => {
  let article = '';

  test('gets an answer that cites an article, and opens it from the citation', async ({ page }) => {
    await signIn(page);
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

    await fakeAi.phrasings(['schedule a task for later']);
    await page.goto('/');
    await ask(page, QUESTION);

    const answer = page.getByRole('region', { name: 'Answer' });
    await expect(answer).toContainText('Durable Object alarm');
    await expect(page.getByText('Also searched for: schedule a task for later')).toBeVisible();
    await fakeAi.phrasings();
    const sources = page.getByRole('list', { name: 'Sources' });
    await expect(sources).toContainText('Alarms for agents');
    await expect(sources).toContainText('example.com');

    await answer.getByRole('link', { name: '[1]' }).click();
    await expect(page).toHaveURL(`/links/${article}`);
  });

  test('is shown the provider’s message when it rejects the key', async ({ page }) => {
    await signIn(page);
    await fakeAi.rejectAnswers(401, 'invalid x-api-key');
    try {
      await page.goto('/');
      await ask(page, QUESTION);

      await expect(page.getByRole('alert')).toHaveText('invalid x-api-key');
      expect(d1("SELECT message FROM key_rejections WHERE service = 'ai'")).toEqual([
        { message: 'invalid x-api-key' },
      ]);
    } finally {
      await fakeAi.rejectAnswers();
      // The specs share one deployment and library: lift the refusal and remove the article.
      d1('DELETE FROM key_rejections');
      const origin = new URL(page.url()).origin;
      await page.request.delete(`/api/v1/links/${article}`, { headers: { Origin: origin } });
    }
  });
});

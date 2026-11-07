import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

/** Pastes `urls` and returns the ids of the links they became. */
async function paste(page: Page, urls: string[]): Promise<string[]> {
  const input = page.getByLabel('Add links');
  await input.fill(urls.join('\n'));
  const answered = page.waitForResponse((r) => r.url().endsWith('/api/v1/links/batch'));
  await input.press('Enter');
  const body = (await (await answered).json()) as {
    added: { id: string }[];
    boosted: { id: string }[];
  };
  return [...body.added, ...body.boosted].map((l) => l.id);
}

function cardOf(page: Page, id: string) {
  return page
    .locator('article', { has: page.locator(`a[href="/api/v1/links/${id}/open"]`) })
    .first();
}

test.describe.serial('workspaces', () => {
  test('the owner gathers two links into a workspace, orders them and writes its note', async ({
    page,
  }) => {
    await signIn(page);
    const [first, second] = await paste(page, [
      'https://lisbon-hotels.example/',
      'https://lisbon-trams.example/',
    ]);

    await page.goto('/workspaces');
    await page.getByLabel('Workspace name').fill('Trip to Lisbon');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('link', { name: 'Trip to Lisbon (0)' })).toBeVisible();

    await page.goto('/');
    for (const id of [first!, second!]) {
      const card = cardOf(page, id);
      await card.getByRole('button', { name: 'Add to workspace' }).click();
      await card.getByRole('menuitemcheckbox', { name: 'Trip to Lisbon' }).click();
      await expect(card.getByRole('link', { name: 'Trip to Lisbon' })).toBeVisible();
    }

    await page.goto('/workspaces');
    await page.getByRole('link', { name: 'Trip to Lisbon (2)' }).click();
    await expect(page.getByRole('article')).toHaveCount(2);
    await page.locator('.member').nth(1).dragTo(page.locator('.member').nth(0));
    await expect(page.getByRole('article').first()).toHaveAttribute(
      'aria-label',
      'lisbon-trams.example',
    );

    await page.getByRole('button', { name: 'Edit note' }).click();
    await page.getByLabel('Note').fill('# Plan\n\n- book flights\n- book the hotel');
    await page.getByRole('button', { name: 'Save note' }).click();
    await expect(page.locator('.markdown h1', { hasText: 'Plan' })).toBeVisible();

    await page.reload();
    const heading = page.locator('.markdown h1', { hasText: 'Plan' });
    await expect(heading).toBeVisible();
    const order = await page
      .getByRole('article')
      .evaluateAll((cards) => cards.map((c) => c.getAttribute('aria-label')));
    expect(order).toEqual(['lisbon-trams.example', 'lisbon-hotels.example']);
    const headingFirst = await heading.evaluate(
      (h) =>
        (h.compareDocumentPosition(document.querySelector('article')!) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
    );
    expect(headingFirst).toBe(true);
    const workspaceId = page.url().split('/workspaces/')[1]!;
    const members = await (
      await page.request.get(`/api/v1/workspaces/${workspaceId}/links`)
    ).json();
    expect(members.items.map((m: { id: string; position: number }) => [m.id, m.position])).toEqual([
      [second, 1],
      [first, 2],
    ]);

    await page.goto('/');
    for (const id of [first!, second!]) {
      await expect(cardOf(page, id).getByRole('link', { name: 'Trip to Lisbon' })).toBeVisible();
    }
  });

  test('a script files a link with a note; the owner reads it safely and deletes the workspace', async ({
    page,
    playwright,
    baseURL,
  }) => {
    await signIn(page);
    await page.goto('/settings');
    await page.getByLabel('Token name').fill('filing script');
    await page.getByRole('button', { name: 'Create token' }).click();
    const secret = (await page.locator('.secret').textContent()) ?? '';
    const script = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${secret}` },
    });
    const link = (
      await (
        await script.post('/api/v1/links', { data: { url: 'https://porto-guide.example/' } })
      ).json()
    ).link;
    const workspace = await (
      await script.post('/api/v1/workspaces', { data: { name: 'Porto' } })
    ).json();
    expect(
      (
        await script.post(`/api/v1/workspaces/${workspace.id}/links`, {
          data: { link_id: link.id, position: 1 },
        })
      ).status(),
    ).toBe(201);
    const noted = await script.patch(`/api/v1/links/${link.id}`, {
      data: { note: 'Check prices <script>alert(1)</script>\n\n- the tram\n- the river' },
    });
    expect(noted.status()).toBe(200);
    await script.dispose();

    await page.goto('/');
    const card = cardOf(page, link.id);
    await expect(card.locator('.note-preview')).toHaveText('Check prices');
    await expect(card.getByRole('link', { name: 'Porto', exact: true })).toBeVisible();

    let dialogs = 0;
    const onDialog = () => {
      dialogs += 1;
    };
    page.on('dialog', onDialog);
    await page.goto(`/links/${link.id}`);
    await expect(page.locator('.note .markdown li').first()).toHaveText('the tram');
    expect(await page.locator('.note script').count()).toBe(0);
    expect(dialogs).toBe(0);
    page.off('dialog', onDialog);

    await page.goto('/workspaces');
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Delete Porto' }).click();
    await expect(page.getByRole('link', { name: /^Porto/ })).toHaveCount(0);
    expect((await page.request.get(`/api/v1/workspaces/${workspace.id}`)).status()).toBe(404);

    await page.goto('/');
    await expect(cardOf(page, link.id)).toBeVisible();
    await expect(
      cardOf(page, link.id).getByRole('link', { name: 'Porto', exact: true }),
    ).toHaveCount(0);
  });
});

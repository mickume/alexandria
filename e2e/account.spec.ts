import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { addLinkIds, cardOf, d1, fakeAi, fakeOrigin, r2Object, saveAiKey, signIn } from './helpers';

/** Creates a personal access token on the settings page and returns its secret. */
async function createToken(page: Page, name: string): Promise<string> {
  await page.goto('/settings');
  await page.getByLabel('Token name').fill(name);
  await page.getByRole('button', { name: 'Create token' }).click();
  const secret = (await page.locator('.secret').textContent()) ?? '';
  expect(secret).toMatch(/^alx_/);
  return secret;
}

/** Adds the pages and waits until the fetch worker has stored them. */
async function addFetched(page: Page, urls: string[]): Promise<string[]> {
  const ids = await addLinkIds(page, urls);
  await page.goto('/');
  for (const id of ids) {
    await expect(cardOf(page, id).getByRole('link', { name: 'Snapshot' })).toBeVisible({
      timeout: 30_000,
    });
  }
  return ids;
}

async function createWorkspace(page: Page, name: string, linkId: string) {
  const origin = new URL(page.url()).origin;
  const ws = await page.request.post('/api/v1/workspaces', {
    data: { name },
    headers: { Origin: origin },
  });
  expect(ws.status()).toBe(201);
  const id = ((await ws.json()) as { id: string }).id;
  const added = await page.request.post(`/api/v1/workspaces/${id}/links`, {
    data: { link_id: linkId },
    headers: { Origin: origin },
  });
  expect(added.status()).toBe(201);
}

/** How many rows of the main tables still reference the user or its links. */
function rowsLeft(userId: string, linkIds: string[]): number {
  const links = linkIds.map((id) => `'${id}'`).join(', ');
  const [row] = d1<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM users WHERE id = '${userId}')
       + (SELECT COUNT(*) FROM links WHERE user_id = '${userId}')
       + (SELECT COUNT(*) FROM sessions WHERE user_id = '${userId}')
       + (SELECT COUNT(*) FROM tokens WHERE user_id = '${userId}')
       + (SELECT COUNT(*) FROM workspaces WHERE user_id = '${userId}')
       + (SELECT COUNT(*) FROM link_texts WHERE user_id = '${userId}')
       + (SELECT COUNT(*) FROM link_events WHERE user_id = '${userId}')
       + (SELECT COUNT(*) FROM link_uses WHERE user_id = '${userId}')
       + (SELECT COUNT(*) FROM tags WHERE user_id = '${userId}')
       + (SELECT COUNT(*) FROM topics WHERE user_id = '${userId}')
       + (SELECT COUNT(*) FROM link_search WHERE link_id IN (${links}))
       + (SELECT COUNT(*) FROM workspace_links WHERE link_id IN (${links})) AS n`,
  );
  return row!.n;
}

test.describe.serial('the owner’s account', () => {
  test('is deleted from the settings page and nothing of it remains', async ({ page }) => {
    test.setTimeout(11 * 60_000);
    await signIn(page);
    await saveAiKey(page);
    const ids = await addFetched(page, [
      'https://leaving.example/one',
      'https://leaving.example/two',
    ]);
    await createWorkspace(page, 'Leaving', ids[0]!);
    const secret = await createToken(page, 'leaving script');
    const [user] = d1<{ id: string }>("SELECT id FROM users WHERE email = 'owner@example.test'");
    const userId = user!.id;
    const objects = ids.flatMap((id) => [
      `u/${userId}/l/${id}/snapshot`,
      `u/${userId}/l/${id}/reader.json`,
    ]);
    expect(objects.some((key) => r2Object(key) !== null)).toBe(true);

    await page.goto('/settings');
    await page.getByLabel('Type your email address to confirm').fill('owner@example.test');
    await page.getByRole('button', { name: 'Delete account' }).click();
    await expect(page).toHaveURL('/signin?deleted=1');
    await expect(page.getByText('Your account and all its data are being deleted.')).toBeVisible();

    const script = await page.request.get('/api/v1/links', {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(script.status()).toBe(401);
    expect(await script.json()).toEqual({ error: 'unauthorized' });

    const deadline = Date.now() + 10 * 60_000;
    while (rowsLeft(userId, ids) > 0 || objects.some((key) => r2Object(key) !== null)) {
      expect(Date.now(), 'the deletion did not finish within 10 minutes').toBeLessThan(deadline);
      await page.waitForTimeout(2_000);
    }

    await signIn(page);
    const [fresh] = d1<{ id: string }>("SELECT id FROM users WHERE email = 'owner@example.test'");
    expect(fresh!.id).not.toBe(userId);
    await expect(page.getByRole('article')).toHaveCount(0);
  });

  test('is exported, and a script fetches a stored snapshot from the export', async ({ page }) => {
    await signIn(page);
    // Enriched with an answer of their own, so that the specs after this one
    // find no link waiting for a key and no summary of theirs.
    await fakeAi.answerWhen('that the owner backs up', {
      summary: 'A page kept for the backup.',
      tags: ['backup', 'library', 'export'],
      topic: 'Backups',
    });
    await saveAiKey(page);
    const ids = await addFetched(page, [
      'https://backup.example/one',
      'https://backup.example/two',
    ]);
    await createWorkspace(page, 'Backup', ids[0]!);
    const secret = await createToken(page, 'backup script');

    await page.goto('/settings');
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Export library' }).click();
    const file = await (await download).path();
    const doc = JSON.parse(readFileSync(file, 'utf8')) as {
      links: { id: string; url: string; use_count: number; snapshot_url: string | null }[];
      workspaces: unknown[];
      complete: boolean;
    };
    expect(doc.links).toHaveLength(2);
    expect(doc.workspaces).toHaveLength(1);
    expect(doc.complete).toBe(true);

    const first = doc.links.find((l) => l.url === 'https://backup.example/one')!;
    const before = first.use_count;
    const snapshot = await page.request.get(first.snapshot_url!, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(snapshot.status()).toBe(200);
    const served = await fetch(fakeOrigin.url, {
      headers: { 'X-Alexandria-Target': 'https://backup.example/one' },
    });
    expect(await snapshot.text()).toBe(await served.text());
    const link = await (await page.request.get(`/api/v1/links/${first.id}`)).json();
    expect(link.use_count).toBe(before);
  });
});

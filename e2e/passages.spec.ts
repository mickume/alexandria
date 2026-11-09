import { expect, test, type Page } from '@playwright/test';
import { addLinkIds, d1, fakeMeaning, runMinute, signIn } from './helpers';

const ALARMS = 'https://example.com/durable-object-alarms';
const QUESTION = 'run a task later on cloudflare';

interface Passage {
  link_id: string;
  title: string;
  url: string;
  passage: string;
  score: number;
}

/** The passages GET /api/v1/passages returns for the question. */
async function passagesFor(page: Page, question: string): Promise<Passage[]> {
  const r = await page.request.get(`/api/v1/passages?q=${encodeURIComponent(question)}&limit=20`);
  expect(r.status()).toBe(200);
  return ((await r.json()) as { items: Passage[] }).items;
}

function ownerId(): string {
  return d1<{ id: string }>("SELECT id FROM users WHERE email = 'owner@example.test'")[0]!.id;
}

test.describe.serial('the owner finds links by meaning', () => {
  let article = '';

  test('finds a new article by meaning within a minute of adding it', async ({ page }) => {
    await signIn(page);
    [article = ''] = await addLinkIds(page, [ALARMS]);

    await expect
      .poll(async () => (await passagesFor(page, QUESTION))[0]?.link_id, { timeout: 60_000 })
      .toBe(article);

    const found = await passagesFor(page, QUESTION);
    expect(found[0]).toMatchObject({
      link_id: article,
      title: 'Durable Object alarms',
      url: ALARMS,
    });
    // The article’s own words, not only its title, are among what the index returns.
    expect(found.some((p) => p.passage.includes('schedule a task to run later'))).toBe(true);
  });

  test('stops returning a deleted article at once and drops its vectors at the next run', async ({
    page,
  }) => {
    await signIn(page);
    const userId = ownerId();
    expect((await fakeMeaning.vectors(userId)).some((v) => v.id.startsWith(`${article}:`))).toBe(
      true,
    );

    const removed = await page.request.delete(`/api/v1/links/${article}`, {
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(removed.status()).toBe(204);

    expect((await passagesFor(page, QUESTION)).map((p) => p.link_id)).not.toContain(article);
    await runMinute(page);
    await expect
      .poll(
        async () => (await fakeMeaning.vectors(userId)).some((v) => v.id.startsWith(`${article}:`)),
        { timeout: 30_000 },
      )
      .toBe(false);
  });

  test('indexes links stored before the index existed, without anyone asking', async ({ page }) => {
    await signIn(page);
    const userId = ownerId();
    const at = new Date().toISOString();
    const ids = ['backfilled-one', 'backfilled-two'];
    for (const [i, id] of ids.entries()) {
      d1(
        `INSERT INTO links (id, user_id, url, original_url, host, title, state, added_at, last_used_at, use_count, updated_at)
         VALUES ('${id}', '${userId}', 'https://old.example/${id}', 'https://old.example/${id}', 'old.example',
           'Old note ${i}', 'active', '${at}', '${at}', 0, '${at}')`,
      );
      d1(
        `INSERT INTO link_texts (link_id, user_id, text)
         VALUES ('${id}', '${userId}', 'Remember to schedule a task for later, in the background.')`,
      );
    }
    const before = await passagesFor(page, 'schedule a task later');
    expect(before.map((p) => p.link_id)).not.toEqual(expect.arrayContaining(ids));

    await runMinute(page);

    await expect
      .poll(
        async () =>
          new Set((await passagesFor(page, 'schedule a task later')).map((p) => p.link_id)),
        { timeout: 60_000 },
      )
      .toEqual(new Set(ids));
  });
});

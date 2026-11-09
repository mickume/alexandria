import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test, type Page } from '@playwright/test';
import { addLinkIds, cardOf, d1, signIn } from './helpers';

const QUEUES = ['https://guides.example/queues-intro', 'https://guides.example/queues-batching'];
const GARDENING = 'https://guides.example/gardening';

/** Creates a personal access token on the settings page and returns its secret. */
async function createToken(page: Page, name: string): Promise<string> {
  await page.goto('/settings');
  await page.getByLabel('Token name').fill(name);
  await page.getByRole('button', { name: 'Create token' }).click();
  const secret = (await page.locator('.secret').textContent()) ?? '';
  expect(secret).toMatch(/^alx_/);
  return secret;
}

/** An MCP client of the SDK, connected to /mcp with the token. */
async function agent(page: Page, secret: string): Promise<Client> {
  const client = new Client({ name: 'e2e', version: '1.0.0' });
  const url = new URL('/mcp', new URL(page.url()).origin);
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${secret}` } },
    }),
  );
  return client;
}

/** Calls a tool and returns its result with the structured content. */
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return result as { isError?: boolean; structuredContent: any };
}

test.describe.serial('an agent with the MCP server', () => {
  test('searches the library and reads a link’s stored text', async ({ page }) => {
    await signIn(page);
    const ids = await addLinkIds(page, [...QUEUES, GARDENING]);
    await page.goto('/');
    for (const id of ids) {
      await expect(cardOf(page, id).locator('.state')).not.toHaveText('pending', {
        timeout: 30_000,
      });
    }
    const secret = await createToken(page, 'mcp agent');
    const client = await agent(page, secret);

    const found = await call(client, 'search_links', { query: 'cloudflare queues' });
    expect(found.isError).toBeFalsy();
    const hits: { link: { id: string; url: string } }[] = found.structuredContent.items;
    expect(hits.map((h) => h.link.url).sort()).toEqual([...QUEUES].sort());

    const first = hits[0]!.link;
    const before = Date.now();
    const content = await call(client, 'get_link_content', { id: first.id, format: 'text' });
    expect(content.isError).toBeFalsy();
    expect(content.structuredContent.content).toContain('Cloudflare Queues');
    await client.close();

    const [row] = d1<{ use_count: number; last_used_at: string }>(
      `SELECT use_count, last_used_at FROM links WHERE id = '${first.id}'`,
    );
    expect(row!.use_count).toBe(1);
    const history = await (await page.request.get(`/api/v1/links/${first.id}/history`)).json();
    expect(history.items[0].kind).toBe('use');
    expect(Date.parse(history.items[0].at)).toBeGreaterThanOrEqual(before - 1_000);

    await page.goto('/');
    await expect(cardOf(page, first.id).getByText('Used just now')).toBeVisible();
  });

  test('answers a question from passages of the owner’s links, recording no use', async ({
    page,
  }) => {
    await signIn(page);
    const url = 'https://example.com/alarms-for-agents';
    const [id = ''] = await addLinkIds(page, [url]);
    const secret = await createToken(page, 'passages agent');
    const client = await agent(page, secret);
    const question = 'how do I schedule background work on Cloudflare?';

    await expect
      .poll(
        async () =>
          (await call(client, 'search_passages', { query: question })).structuredContent.items?.[0]
            ?.link_id,
        { timeout: 60_000 },
      )
      .toBe(id);

    const found = await call(client, 'search_passages', { query: question });
    expect(found.isError).toBeFalsy();
    expect(found.structuredContent.items[0]).toMatchObject({
      link_id: id,
      title: 'Alarms for agents',
      url,
    });
    await client.close();
    const [row] = d1<{ use_count: number }>(`SELECT use_count FROM links WHERE id = '${id}'`);
    expect(row!.use_count).toBe(0);

    // The specs share one library, and later ones look for the best passage of their own article.
    const removed = await page.request.delete(`/api/v1/links/${id}`, {
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(removed.status()).toBe(204);
  });

  test('finds a link by meaning with search_links', async ({ page }) => {
    await signIn(page);
    const url = 'https://example.com/alarms-for-agents';
    const [id = ''] = await addLinkIds(page, [url]);
    const secret = await createToken(page, 'meaning agent');
    const client = await agent(page, secret);
    // The article shares no word with this query ('later' is not in it): only meaning finds it.
    const query = 'run a task later';
    const hit = async () => {
      const found = await call(client, 'search_links', { query });
      return (found.structuredContent.items as { link: { id: string }; match: string }[]).find(
        (i) => i.link.id === id,
      );
    };

    await expect.poll(async () => (await hit())?.match, { timeout: 60_000 }).toBe('meaning');

    const found = await call(client, 'search_links', { query });
    expect(found.isError).toBeFalsy();
    expect(found.structuredContent.meaning).toBe('used');
    await client.close();
    // The specs share one library, and later ones look for the best passage of their own article.
    const removed = await page.request.delete(`/api/v1/links/${id}`, {
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(removed.status()).toBe(204);
  });

  test('archives a link with archive_link, and the owner finds it in the Archive', async ({
    page,
  }) => {
    await signIn(page);
    const origin = new URL(page.url()).origin;
    const [id = ''] = await addLinkIds(page, ['https://code.example/archived-by-agent']);
    const secret = await createToken(page, 'archiving agent');
    const client = await agent(page, secret);
    const archived = await call(client, 'archive_link', { link_id: id });
    await client.close();
    expect(archived.isError).toBeFalsy();
    expect(archived.structuredContent.state).toBe('archived');

    await page.goto('/archive');
    const today = new Date().toISOString().slice(0, 10);
    const row = page.locator('article.archived', { hasText: 'code.example' });
    await expect(row).toBeVisible();
    await expect(row.getByText(`archived on ${today}`)).toBeVisible();

    // The specs share one library: leave it without this link.
    await page.request.delete(`/api/v1/links/${id}`, { headers: { Origin: origin } });
  });

  test('files a new link into the owner’s workspace and pins it', async ({ page }) => {
    await signIn(page);
    await page.goto('/workspaces');
    await page.getByLabel('Workspace name').fill('Research');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('link', { name: 'Research (0)' })).toBeVisible();
    const secret = await createToken(page, 'filing agent');
    const client = await agent(page, secret);

    const before = await call(client, 'search_links', { query: 'host:example.net' });
    expect(before.structuredContent.items).toEqual([]);
    const args = {
      url: 'https://example.net/paper?utm_source=x',
      tags: ['reading'],
      workspace: 'research',
    };
    const added = await call(client, 'add_link', args);
    expect(added.isError).toBeFalsy();
    expect(added.structuredContent.status).toBe('added');
    const again = await call(client, 'add_link', args);
    expect(again.structuredContent.status).toBe('boosted');
    const id: string = added.structuredContent.link.id;
    const pinned = await call(client, 'pin_link', { link_id: id });
    expect(pinned.structuredContent.pinned).toBe(true);
    await client.close();

    const rows = d1<{ id: string; edited_fields: string }>(
      "SELECT l.id, l.edited_fields FROM links l JOIN users u ON u.id = l.user_id WHERE u.email = 'owner@example.test' AND l.url = 'https://example.net/paper'",
    );
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.edited_fields)).toContain('tags');
    const stream = (await (await page.request.get('/api/v1/links')).json()) as {
      items: { id: string; pinned: boolean; pin_position: number | null }[];
    };
    const pinnedIds = stream.items.filter((l) => l.pinned).map((l) => l.id);
    expect(pinnedIds.at(-1)).toBe(id);

    await page.goto('/workspaces');
    await page.getByRole('link', { name: 'Research (1)' }).click();
    const last = page.getByRole('article').last();
    await expect(last).toHaveAttribute('aria-label', /example\.net|A paper/);
    await expect(last.getByRole('list', { name: 'Tags' })).toHaveText('reading');

    // The specs share one library: leave the stream's top to those that follow.
    const unpinned = await page.request.delete(`/api/v1/links/${id}/pin`, {
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(unpinned.status()).toBe(200);
  });
});

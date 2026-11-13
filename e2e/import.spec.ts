import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { d1, saveAiKey, signIn } from './helpers';

const MALFORMED: Record<number, string> = {
  57: 'https://localhost/a',
  211: 'http://192.168.0.1/x',
  399: 'http://localhost/x',
};

/** The 400-line file: 397 pages of the fake origin, and 3 malformed lines. */
function importFile(): { text: string; urls: string[] } {
  const urls: string[] = [];
  const lines = Array.from({ length: 400 }, (_, i) => {
    const line = i + 1;
    if (MALFORMED[line]) return MALFORMED[line]!;
    const url = `https://code.example/import-${line}`;
    urls.push(url);
    return url;
  });
  return { text: `${lines.join('\n')}\n`, urls };
}

test('the owner imports a 400-line file and the stream fills in', async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);
  await saveAiKey(page);
  const { text, urls } = importFile();

  await page.goto('/settings');
  await page.getByLabel('File of URLs').setInputFiles({
    name: 'links.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(text),
  });
  const uploaded = page.waitForResponse((r) => r.url().endsWith('/api/v1/imports'));
  await page.getByRole('button', { name: 'Import' }).click();
  const report = (await (await uploaded).json()) as {
    id: string;
    counts: Record<string, number>;
    invalid: { line: number; text: string }[];
  };
  const startedAt = Date.now();
  expect(report.counts).toEqual({
    url_lines: 400,
    added: 397,
    duplicates: 0,
    invalid: 3,
    not_imported: 0,
  });
  expect(report.invalid.map((l) => l.line)).toEqual([57, 211, 399]);
  const view = page.getByRole('region', { name: 'Import', exact: true });
  await expect(view.getByText('added 397')).toBeVisible();
  await expect(view.getByText('invalid 3')).toBeVisible();
  for (const [line, value] of Object.entries(MALFORMED)) {
    await expect(view.getByText(`line ${line}: ${value}`)).toBeVisible();
  }
  const download = page.waitForEvent('download');
  await view.getByRole('link', { name: 'Download report' }).click();

  // The stream: the imported links in file order, each at the start points, so
  // below any link used more and above every older one.
  const imported = new Set(urls);
  const stream: { url: string; pinned: boolean }[] = [];
  let cursor: string | null = null;
  while (stream.filter((l) => imported.has(l.url)).length < 397) {
    const r = await page.request.get(
      `/api/v1/links?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    const body = (await r.json()) as {
      items: { url: string; pinned: boolean }[];
      next_cursor: string | null;
    };
    stream.push(...body.items);
    cursor = body.next_cursor;
    if (!cursor) break;
  }
  const listed = stream.filter((l) => !l.pinned).map((l) => l.url);
  const start = listed.indexOf(urls[0]!);
  expect(listed.slice(start, start + 397)).toEqual(urls);

  // After 70 seconds the first minute's links, and no more, have been fetched.
  await page.waitForTimeout(Math.max(0, 70_000 - (Date.now() - startedAt)));
  const progress = (await (await page.request.get(`/api/v1/imports/${report.id}`)).json()) as {
    progress: { done: number };
  };
  expect(progress.progress.done).toBeGreaterThanOrEqual(1);
  expect(progress.progress.done).toBeLessThanOrEqual(20);
  const times = d1<{ at: string }>(
    `SELECT dispatched_at AS at FROM import_links WHERE import_id = '${report.id}' AND skipped = 0 AND dispatched_at IS NOT NULL ORDER BY dispatched_at`,
  ).map((r) => Date.parse(r.at));
  for (const [i, t] of times.entries()) {
    expect(
      times.filter((u) => u >= t && u < t + 60_000).length,
      `window from ${i}`,
    ).toBeLessThanOrEqual(20);
  }
  await page.goto('/');
  await expect(page.getByRole('article', { name: 'Code import-1', exact: true })).toBeVisible({
    timeout: 30_000,
  });

  const file = await (await download).path();
  const reportText = readFileSync(file, 'utf8');
  for (const line of ['line 57', 'line 211', 'line 399']) expect(reportText).toContain(line);
});

test('the owner imports a file into a new workspace', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings');
  await page.getByLabel('Add the links to a workspace').selectOption({ label: 'New workspace…' });
  await page.getByLabel('Name of the new workspace').fill('Reading list');
  await page.getByLabel('File of URLs').setInputFiles({
    name: 'links.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('https://code.example/ws-1\nhttps://code.example/ws-2\n'),
  });
  await page.getByRole('button', { name: 'Import' }).click();
  const view = page.getByRole('region', { name: 'Import', exact: true });
  await expect(view.getByText('added 2')).toBeVisible();
  await view.getByRole('link', { name: 'Reading list' }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  const workspaceId = new URL(page.url()).pathname.split('/').at(-1);
  const members = (await (
    await page.request.get(`/api/v1/workspaces/${workspaceId}/links`)
  ).json()) as { items: { url: string }[] };
  expect(members.items.map((m) => m.url)).toEqual([
    'https://code.example/ws-1',
    'https://code.example/ws-2',
  ]);
});

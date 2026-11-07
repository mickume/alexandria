import { expect, type Page } from '@playwright/test';

/** Signs in through the fake Google provider and lands on the stream. */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/signin');
  await page.getByRole('link', { name: 'Sign in with Google' }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Adds `urls` as the signed-in owner, through the API with the page's session. */
export async function addLinks(page: Page, urls: string[]): Promise<void> {
  const origin = new URL(page.url()).origin;
  for (let i = 0; i < urls.length; i += 100) {
    const r = await page.request.post('/api/v1/links/batch', {
      data: { urls: urls.slice(i, i + 100) },
      headers: { Origin: origin },
    });
    expect(r.status()).toBe(200);
  }
}

/** A host name of about 200 characters, unique for `i`, so that cards carry long titles. */
export function longHost(i: number): string {
  const label = (c: string) => c.repeat(60);
  return `${label('a')}.${label('b')}.${label('c')}.site${i}.example`;
}

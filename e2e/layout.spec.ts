import { expect, test } from '@playwright/test';
import { addLinks, longHost, signIn } from './helpers';

const widths = [375, 1280];
const schemes = ['light', 'dark'] as const;

test.describe('the layout of every page', () => {
  let linkPath = '/';

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await addLinks(
      page,
      Array.from({ length: 50 }, (_, i) => `https://${longHost(i)}/article`),
    );
    const r = await page.request.get('/api/v1/links?limit=1');
    const { items } = (await r.json()) as { items: { id: string }[] };
    linkPath = `/links/${items[0]?.id}`;
  });

  for (const width of widths) {
    test(`uses one typeface and fits ${width} px in light and dark`, async ({ page, browser }) => {
      const backgrounds: Record<string, string[]> = { light: [], dark: [] };
      const paths = ['/', '/settings', '/import', linkPath];
      const signedOut = await browser.newContext({ viewport: { width, height: 800 } });
      for (const scheme of schemes) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height: 800 });
        const anonymous = await signedOut.newPage();
        await anonymous.emulateMedia({ colorScheme: scheme });
        const pages = [
          { p: anonymous, path: '/signin' },
          ...paths.map((path) => ({ p: page, path })),
        ];
        for (const { p, path } of pages) {
          await p.goto(path);
          await p.waitForLoadState('networkidle');
          const layout = await p.evaluate(() => {
            const families = new Set(
              [...document.querySelectorAll('body, h1, h2, h3, input, textarea, button, a')].map(
                (el) => getComputedStyle(el).fontFamily,
              ),
            );
            return {
              scrollWidth: document.documentElement.scrollWidth,
              families: [...families],
              background: getComputedStyle(document.body).backgroundColor,
            };
          });
          expect(layout.scrollWidth, `${path} at ${width} px`).toBeLessThanOrEqual(width);
          expect(layout.families, `${path} typefaces`).toHaveLength(1);
          backgrounds[scheme]!.push(layout.background);
        }
        await anonymous.close();
      }
      await signedOut.close();
      backgrounds.light!.forEach((light, i) => {
        expect(light).not.toBe(backgrounds.dark![i]);
      });
    });
  }
});

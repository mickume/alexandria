import { describe, expect, it } from 'vitest';
import { FakeOrigin } from '../test/origin';
import { env } from '../test/helpers';
import { chooseImage, saveImages } from './images';
import { extractReader } from './reader';
import { illustratedArticle } from './fixtures/pages';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const TARGET = { folder: 'u/x/l/y/s/z/', addressPrefix: '/images/', snapshotId: 'z' };

describe('choosing the image a snapshot saves', () => {
  it.each([
    { label: 'src alone', src: 'a.png', srcset: null, chosen: 'a.png' },
    {
      label: 'the widest candidate at most 2000 pixels wide',
      src: 'a.png',
      srcset: 'a-480.png 480w, a-1600.png 1600w, a-2000.png 2000w, a-3200.png 3200w',
      chosen: 'a-2000.png',
    },
    {
      label: 'the narrowest when every candidate is wider',
      src: null,
      srcset: 'a-3200.png 3200w, a-2400.png 2400w',
      chosen: 'a-2400.png',
    },
    {
      label: 'the highest density at most 2x',
      src: 'a.png',
      srcset: 'a-1x.png 1x, a-2x.png 2x, a-3x.png 3x',
      chosen: 'a-2x.png',
    },
    {
      label: 'src when no density fits',
      src: 'a.png',
      srcset: 'a-3x.png 3x',
      chosen: 'a.png',
    },
    { label: 'nothing', src: null, srcset: null, chosen: null },
  ])('takes $label', ({ src, srcset, chosen }) => {
    expect(chooseImage(src, srcset)).toBe(chosen);
  });

  it('chooses among the sources of a <picture>, made absolute by the reader view', () => {
    const page = illustratedArticle(
      [],
      `<picture>
        <source srcset="/img/wide-2400.webp 2400w, /img/wide-1800.webp 1800w" type="image/webp">
        <img src="/img/fallback.jpg" alt="Chart">
      </picture>`,
    );
    const reader = extractReader(page, 'https://news.example/keep');
    const srcset = /srcset="([^"]+)"/.exec(reader.html ?? '')?.[1] ?? null;
    const src = /<img[^>]* src="([^"]+)"/.exec(reader.html ?? '')?.[1] ?? null;
    expect(chooseImage(src, srcset)).toBe('https://news.example/img/wide-1800.webp');
  });
});

describe('saving the images of an article', () => {
  it('stores at most 100 images and puts placeholders for the rest', async () => {
    const origin = new FakeOrigin();
    const images = Array.from({ length: 101 }, (_, i) => `https://i${i}.example/a.png`);
    for (const url of images) origin.page(url, PNG, 'image/png');
    const html = images.map((src, i) => `<p><img src="${src}" alt="Image ${i}"></p>`).join('');
    const saved = await saveImages(env, html, TARGET);
    expect(saved.objects).toHaveLength(100);
    expect(saved.missing).toBe(1);
    expect(origin.log).toHaveLength(100);
    expect(saved.html).toContain('<span class="missing-image">Image 100 (');
    expect(saved.objects[0]).toMatchObject({
      key: 'u/x/l/y/s/z/img/z-1.png',
      contentType: 'image/png',
    });
    expect(saved.html).toContain('src="/images/z-1.png"');
  }, 60_000);

  it('keeps an inline image as it is, and drops srcset', async () => {
    const inline = 'data:image/png;base64,iVBORw0KGgo=';
    const saved = await saveImages(
      env,
      `<img src="${inline}" srcset="${inline} 1x" alt="Dot">`,
      TARGET,
    );
    expect(saved).toEqual({ html: `<img src="${inline}" alt="Dot">`, objects: [], missing: 0 });
  });

  it('gives an image without an address a placeholder without a link', async () => {
    const saved = await saveImages(env, '<img alt="">', TARGET);
    expect(saved).toEqual({
      html: '<span class="missing-image">image</span>',
      objects: [],
      missing: 1,
    });
  });
});

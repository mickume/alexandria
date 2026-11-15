import { parseHTML } from 'linkedom';
import type { Env } from '../env';
import { readLimited, requestFollowing } from './fetch';

/** The most images one snapshot stores. */
export const MAX_IMAGES = 100;
/** The largest image a snapshot stores. */
export const IMAGE_LIMIT = 10 * 1024 * 1024;
/** The most bytes of images one snapshot stores in all. */
export const IMAGES_TOTAL_LIMIT = 50 * 1024 * 1024;
/** How long one image's request may take, from sending it to the last byte of its body. */
export const IMAGE_TIMEOUT_MS = 15_000;
/** The widest srcset candidate a snapshot chooses, in pixels. */
export const MAX_IMAGE_WIDTH = 2000;
/** The highest srcset density a snapshot chooses. */
const MAX_DENSITY = 2;

/** The image types a snapshot stores, with the extension their stored names take. */
const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

const IMAGE_ACCEPT = Object.keys(IMAGE_TYPES).join(', ');

/**
 * Where a srcset separates its candidates: a comma followed by space, or one
 * right after a candidate's descriptor. A comma inside an address, as a data:
 * address has, is neither.
 */
export const SRCSET_SEPARATOR = /\s*,\s+|(?<=\s\d+(?:\.\d+)?[wx]),\s*/i;

/** An object a snapshot writes to SNAPSHOTS. */
export interface StoredObject {
  key: string;
  body: Uint8Array | string;
  contentType: string;
}

/** The article with its images stored: its HTML, the objects to write, and how many images were not saved. */
export interface SavedImages {
  html: string;
  objects: StoredObject[];
  missing: number;
}

/** Where a snapshot's images go and how the article refers to them. */
export interface ImageTarget {
  /** The R2 key prefix of the snapshot's folder, ending in '/'. */
  folder: string;
  /** The address prefix the article's images are served under, ending in '/'. */
  addressPrefix: string;
  /** The snapshot's id, which starts every image name. */
  snapshotId: string;
}

/**
 * The address a snapshot saves for an image: of its srcset (its <picture>
 * sources folded in), the largest candidate at most MAX_IMAGE_WIDTH wide;
 * without width descriptors, the highest density at most 2x; without either,
 * its src. When every width candidate is wider, the narrowest is taken.
 */
export function chooseImage(src: string | null, srcset: string | null): string | null {
  const candidates = (srcset ?? '')
    .split(SRCSET_SEPARATOR)
    .map((c) => c.trim().split(/\s+/))
    .filter(([address]) => Boolean(address))
    .map(([address, descriptor = '1x']) => ({
      address: address!,
      width: /^(\d+)w$/i.exec(descriptor)?.[1],
      density: /^([\d.]+)x$/i.exec(descriptor)?.[1],
    }));
  const widths = candidates
    .filter((c) => c.width !== undefined)
    .map((c) => ({ address: c.address, size: Number(c.width) }));
  if (widths.length > 0) {
    const fitting = widths.filter((c) => c.size <= MAX_IMAGE_WIDTH);
    const pool = fitting.length > 0 ? fitting : widths;
    const pick = fitting.length > 0 ? Math.max : Math.min;
    const size = pick(...pool.map((c) => c.size));
    return pool.find((c) => c.size === size)!.address;
  }
  const densities = candidates
    .filter((c) => c.density !== undefined && Number(c.density) <= MAX_DENSITY)
    .map((c) => ({ address: c.address, size: Number(c.density) }));
  if (densities.length > 0) {
    const size = Math.max(...densities.map((c) => c.size));
    return densities.find((c) => c.size === size)!.address;
  }
  return src?.trim() || candidates[0]?.address || null;
}

/** An image fetched and fit to store, or null. */
async function fetchImage(
  env: Env,
  url: string,
  limit: number,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (limit <= 0) return null;
  try {
    const result = await requestFollowing(
      env,
      url,
      { method: 'GET', timeoutMs: IMAGE_TIMEOUT_MS, accept: IMAGE_ACCEPT },
      async (response, _finalUrl, signal) => {
        const contentType = (response.headers.get('Content-Type') ?? '')
          .split(';')[0]!
          .trim()
          .toLowerCase();
        const declared = Number(response.headers.get('Content-Length') ?? NaN);
        if (
          response.status < 200 ||
          response.status >= 300 ||
          !(contentType in IMAGE_TYPES) ||
          declared > limit
        ) {
          await response.body?.cancel();
          return null;
        }
        const { bytes, over } = await readLimited(response.body, limit, signal, declared);
        return over || bytes.length === 0 ? null : { bytes, contentType };
      },
    );
    return result && 'bytes' in result ? result : null;
  } catch (err) {
    console.error('an image of a snapshot could not be fetched', err);
    return null;
  }
}

/** What a snapshot shows for an image it did not store: its alt text and a link to its address. */
function placeholder(document: Document, img: Element, address: string | null): Element {
  const span = document.createElement('span');
  span.setAttribute('class', 'missing-image');
  span.textContent = img.getAttribute('alt')?.trim() || 'image';
  if (address) {
    const link = document.createElement('a');
    link.setAttribute('href', address);
    link.textContent = 'original image';
    span.appendChild(document.createTextNode(' ('));
    span.appendChild(link);
    span.appendChild(document.createTextNode(')'));
  }
  return span;
}

/**
 * Downloads the images of a sanitised article and stores them with the
 * snapshot, in the order they appear: each <img> gets the address of its
 * stored copy, and one that cannot be stored (a failed request, another
 * type, past a limit) becomes a placeholder. An image already inline (a
 * data: address) stays as it is. Nothing is written here: the objects are
 * returned for the caller to write.
 */
export async function saveImages(
  env: Env,
  html: string,
  target: ImageTarget,
): Promise<SavedImages> {
  const { document } = parseHTML(
    '<!doctype html><html><body><div id="snapshot"></div></body></html>',
  );
  const root = document.getElementById('snapshot')!;
  root.innerHTML = html;
  const objects: StoredObject[] = [];
  let missing = 0;
  let total = 0;
  let tried = 0;
  for (const img of [...root.querySelectorAll('img')]) {
    const address = chooseImage(img.getAttribute('src'), img.getAttribute('srcset'));
    img.removeAttribute('srcset');
    if (address && /^data:image\//i.test(address)) {
      img.setAttribute('src', address);
      continue;
    }
    const remote = address && /^https?:\/\//i.test(address) ? address : null;
    const image =
      remote && tried++ < MAX_IMAGES
        ? await fetchImage(env, remote, Math.min(IMAGE_LIMIT, IMAGES_TOTAL_LIMIT - total))
        : null;
    if (!image) {
      img.replaceWith(placeholder(document, img, remote));
      missing++;
      continue;
    }
    const name = `${target.snapshotId}-${objects.length + 1}.${IMAGE_TYPES[image.contentType]}`;
    objects.push({
      key: `${target.folder}img/${name}`,
      body: image.bytes,
      contentType: image.contentType,
    });
    total += image.bytes.length;
    img.setAttribute('src', `${target.addressPrefix}${name}`);
  }
  return { html: root.innerHTML, objects, missing };
}

/** The note on a snapshot some of whose images could not be saved. */
export function missingImagesNote(missing: number): string {
  return `${missing} images could not be saved`;
}

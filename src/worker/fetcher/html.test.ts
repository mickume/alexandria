import { describe, expect, it } from 'vitest';
import { extractMetadata } from './html';

const page = (head: string, htmlAttrs = '') =>
  `<!doctype html><html${htmlAttrs}><head>${head}</head><body><p>x</p></body></html>`;

describe('a page’s metadata', () => {
  it.each([
    {
      label: 'a title element',
      html: page('<title>Plain title</title>'),
      expected: { title: 'Plain title' },
    },
    {
      label: 'an empty title with og:title',
      html: page('<title> </title><meta property="og:title" content="From OG">'),
      expected: { title: 'From OG' },
    },
    {
      label: 'no title at all',
      html: page(''),
      expected: { title: 'meta.example' },
    },
    {
      label: 'og:description and meta description',
      html: page(
        '<meta name="description" content="Meta one"><meta property="og:description" content="OG one">',
      ),
      expected: { description: 'OG one' },
    },
    {
      label: 'a meta description only',
      html: page('<meta name="description" content="Meta only">'),
      expected: { description: 'Meta only' },
    },
    { label: 'no description', html: page(''), expected: { description: null } },
    {
      label: 'a shortcut icon link',
      html: page('<link rel="stylesheet" href="/s.css"><link rel="shortcut icon" href="/i.png">'),
      expected: { faviconUrl: 'https://meta.example/i.png' },
    },
    {
      label: 'no icon link',
      html: page(''),
      expected: { faviconUrl: 'https://meta.example/favicon.ico' },
    },
    { label: 'a declared language', html: page('', ' lang="de"'), expected: { language: 'de' } },
    { label: 'no language', html: page(''), expected: { language: null } },
    {
      label: 'a title with newlines and double spaces',
      html: page('<title>\n  Spaced   out\n title  </title>'),
      expected: { title: 'Spaced out title' },
    },
  ])('is read from $label', ({ html, expected }) => {
    expect(extractMetadata(html, 'https://meta.example/a/page')).toMatchObject(expected);
  });
});

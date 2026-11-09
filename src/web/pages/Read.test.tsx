import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, makeLink, renderPage } from '../test/helpers';

function readerApi(reader: Record<string, unknown>, kind: 'html' | 'pdf' = 'html'): FakeApi {
  return new FakeApi()
    .on('GET', '/api/v1/links/abc/reader', { status: 200, body: { content_kind: kind, ...reader } })
    .on('GET', '/api/v1/links/abc', {
      status: 200,
      body: makeLink({
        id: 'abc',
        title: 'On Links',
        content_kind: kind,
        has_snapshot: true,
        state: 'active',
      }),
    });
}

describe('the Read page', () => {
  it('shows an article’s title, byline and body', async () => {
    renderPage(
      '/links/abc/read',
      readerApi({
        title: 'An Article',
        byline: 'By Ada Writer',
        html: '<h2>A heading</h2><p>First paragraph.</p>',
        text: 'A heading First paragraph.',
        empty: false,
      }),
    );
    expect(await screen.findByRole('heading', { name: 'An Article' })).toBeTruthy();
    expect(screen.getByText('By Ada Writer')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'A heading' })).toBeTruthy();
    expect(screen.getByText('First paragraph.')).toBeTruthy();
  });

  it('opens the article’s web links in a new tab', async () => {
    renderPage(
      '/links/abc/read',
      readerApi({
        title: 'An Article',
        byline: null,
        html: '<p>See <a href="https://elsewhere.example/b">elsewhere</a> and <a href="#notes">notes</a>.</p>',
        text: 'See elsewhere and notes.',
        empty: false,
      }),
    );
    const web = await screen.findByRole('link', { name: 'elsewhere' });
    expect(web.getAttribute('target')).toBe('_blank');
    expect(web.getAttribute('rel')).toContain('noopener');
    expect(screen.getByRole('link', { name: 'notes' }).getAttribute('target')).toBeNull();
  });

  it('offers the snapshot when nothing readable was extracted', async () => {
    renderPage(
      '/links/abc/read',
      readerApi({ title: 'Thin', byline: null, html: null, text: '', empty: true }),
    );
    expect(await screen.findByText('no readable content extracted')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Snapshot' }).getAttribute('href')).toBe(
      '/links/abc/snapshot',
    );
  });

  it('shows a PDF’s text one paragraph per block', async () => {
    renderPage(
      '/links/abc/read',
      readerApi(
        {
          title: 'On Links',
          byline: null,
          html: null,
          text: 'First block.\n\nSecond block.',
          empty: false,
        },
        'pdf',
      ),
    );
    expect(await screen.findByText('First block.')).toBeTruthy();
    expect(screen.getByText('Second block.').tagName).toBe('P');
    expect(screen.getByText('First block.').tagName).toBe('P');
  });

  it('sanitises the reader view again before showing it', async () => {
    const { container } = renderPage(
      '/links/abc/read',
      readerApi({
        title: 'X',
        byline: null,
        html: '<p>Fine words.</p><img src="https://x.example/a.png" onerror="alert(1)"><script>alert(2)</script>',
        text: 'Fine words.',
        empty: false,
      }),
    );
    await screen.findByText('Fine words.');
    const img = container.querySelector('img');
    expect(img?.getAttribute('onerror')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });
});

describe('the Snapshot page', () => {
  it('shows an HTML snapshot in a frame that may do nothing', async () => {
    const { container } = renderPage('/links/abc/snapshot', readerApi({}, 'html'));
    await screen.findByText('On Links');
    const frame = container.querySelector('iframe');
    expect(frame?.getAttribute('sandbox')).toBe('');
    expect(frame?.getAttribute('src')).toBe('/api/v1/links/abc/snapshot');
  });

  it('shows a PDF snapshot in the browser’s viewer with a Download action', async () => {
    const { container } = renderPage('/links/abc/snapshot', readerApi({}, 'pdf'));
    await screen.findByText('On Links');
    const viewer = container.querySelector('object');
    expect(viewer?.getAttribute('data')).toBe('/api/v1/links/abc/snapshot');
    expect(viewer?.getAttribute('type')).toBe('application/pdf');
    const download = screen.getByRole('link', { name: 'Download' });
    expect(download.getAttribute('href')?.endsWith('?download=1')).toBe(true);
  });
});

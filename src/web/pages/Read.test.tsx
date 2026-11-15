import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, renderPage } from '../test/helpers';

const TAKEN = '2026-10-01T09:00:00.000Z';

function snapshotApi(snapshot: Record<string, unknown>): FakeApi {
  return new FakeApi().on('GET', '/api/v1/links/abc/snapshot', {
    status: 200,
    body: {
      content_kind: 'html',
      title: 'An Article',
      byline: null,
      html: '<p>Body.</p>',
      taken_at: TAKEN,
      notes: [],
      ...snapshot,
    },
  });
}

describe('the Read page', () => {
  it('shows the snapshot’s title, byline, date and article with its stored images', async () => {
    const { container } = renderPage(
      '/links/abc/read',
      snapshotApi({
        byline: 'By Ada Writer',
        html: '<h2>A heading</h2><p>First paragraph.</p><img src="/api/v1/links/abc/snapshot/images/s-1.png" alt="Chart">',
      }),
    );
    expect(await screen.findByRole('heading', { name: 'An Article' })).toBeTruthy();
    expect(screen.getByText('By Ada Writer')).toBeTruthy();
    expect(screen.getByText(/Snapshot taken/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'A heading' })).toBeTruthy();
    expect(screen.getByText('First paragraph.')).toBeTruthy();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/v1/links/abc/snapshot/images/s-1.png',
    );
  });

  it('shows the placeholder of an image that could not be saved, and the note', async () => {
    renderPage(
      '/links/abc/read',
      snapshotApi({
        html: '<p>Text.</p><span class="missing-image">Figure 2 (<a href="https://news.example/b.png">original image</a>)</span>',
        notes: ['1 images could not be saved'],
      }),
    );
    expect(await screen.findByText('1 images could not be saved')).toBeTruthy();
    const original = screen.getByRole('link', { name: 'original image' });
    expect(original.getAttribute('href')).toBe('https://news.example/b.png');
    expect(original.getAttribute('target')).toBe('_blank');
  });

  it('opens the article’s web links in a new tab', async () => {
    renderPage(
      '/links/abc/read',
      snapshotApi({
        html: '<p>See <a href="https://elsewhere.example/b">elsewhere</a> and <a href="#notes">notes</a>.</p>',
      }),
    );
    const web = await screen.findByRole('link', { name: 'elsewhere' });
    expect(web.getAttribute('target')).toBe('_blank');
    expect(web.getAttribute('rel')).toContain('noopener');
    expect(screen.getByRole('link', { name: 'notes' }).getAttribute('target')).toBeNull();
  });

  it('sanitises the article again before showing it', async () => {
    const { container } = renderPage(
      '/links/abc/read',
      snapshotApi({
        html: '<p>Fine words.</p><img src="/x.png" onerror="alert(1)"><script>alert(2)</script>',
      }),
    );
    await screen.findByText('Fine words.');
    expect(container.querySelector('img')?.getAttribute('onerror')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('shows a PDF snapshot in the browser’s viewer with a Download action', async () => {
    const { container } = renderPage(
      '/links/abc/read',
      snapshotApi({
        content_kind: 'pdf',
        title: 'On Links',
        html: null,
        file_url: '/api/v1/links/abc/snapshot/file',
      }),
    );
    await screen.findByText('On Links');
    const viewer = container.querySelector('object');
    expect(viewer?.getAttribute('data')).toBe('/api/v1/links/abc/snapshot/file');
    expect(viewer?.getAttribute('type')).toBe('application/pdf');
    const download = screen.getByRole('link', { name: 'Download' });
    expect(download.getAttribute('href')).toBe('/api/v1/links/abc/snapshot/file?download=1');
  });

  it.each(['/links/abc/read', '/links/abc/snapshot'])(
    'says so at %s when no snapshot is stored',
    async (path) => {
      renderPage(
        path,
        new FakeApi().on('GET', '/api/v1/links/abc/snapshot', {
          status: 404,
          body: { error: 'no_snapshot', message: 'no snapshot stored for this link' },
        }),
      );
      expect(await screen.findByText(/No snapshot is stored for this link/)).toBeTruthy();
    },
  );
});

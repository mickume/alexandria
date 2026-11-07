import { act, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, renderPage } from '../test/helpers';

const tags = [
  { id: 'g1', name: 'cloudflare', count: 4, newest_added_at: '2026-03-02T00:00:00.000Z' },
  { id: 'g2', name: 'javascript', count: 2, newest_added_at: '2026-03-01T00:00:00.000Z' },
];

function rows(): string[][] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .slice(0, 2)
        .map((cell) => cell.textContent ?? ''),
    );
}

describe('the Tags page', () => {
  it('lists every tag with its count in order, each opening its search', async () => {
    const api = new FakeApi().on('GET', '/api/v1/tags', {
      status: 200,
      body: { items: tags, next_cursor: null },
    });
    renderPage('/tags', api);
    expect(await screen.findByRole('heading', { name: 'Tags' })).toBeTruthy();
    await screen.findByRole('link', { name: 'cloudflare' });
    expect(rows()).toEqual([
      ['cloudflare', '4'],
      ['javascript', '2'],
    ]);
    await act(async () => screen.getByRole('link', { name: 'cloudflare' }).click());
    expect(window.location.pathname + window.location.search).toBe('/search?q=tag%3Acloudflare');
  });

  it('says so when there are no tags yet', async () => {
    const api = new FakeApi().on('GET', '/api/v1/tags', {
      status: 200,
      body: { items: [], next_cursor: null },
    });
    renderPage('/tags', api);
    expect(await screen.findByText('No tags yet.')).toBeTruthy();
  });
});

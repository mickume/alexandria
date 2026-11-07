import { act, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, renderPage } from '../test/helpers';

const topics = [
  { id: 't1', name: 'web development', count: 3, newest_added_at: '2026-03-02T00:00:00.000Z' },
  { id: 't2', name: 'cooking', count: 1, newest_added_at: '2026-03-01T00:00:00.000Z' },
];

/** The rows of the list, each as [name, count]. */
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

describe('the Topics page', () => {
  it('lists every topic with its count in order, each opening its search', async () => {
    const api = new FakeApi().on('GET', '/api/v1/topics', {
      status: 200,
      body: { items: topics, next_cursor: null },
    });
    renderPage('/topics', api);
    expect(await screen.findByRole('heading', { name: 'Topics' })).toBeTruthy();
    await screen.findByRole('link', { name: 'web development' });
    expect(rows()).toEqual([
      ['web development', '3'],
      ['cooking', '1'],
    ]);
    await act(async () => screen.getByRole('link', { name: 'web development' }).click());
    expect(window.location.pathname + window.location.search).toBe(
      '/search?q=topic%3A%22web%20development%22',
    );
  });

  it('follows the cursor until every topic is listed', async () => {
    const api = new FakeApi().on('GET', '/api/v1/topics', (req) =>
      req.path.includes('cursor=c2')
        ? { status: 200, body: { items: [topics[1]], next_cursor: null } }
        : { status: 200, body: { items: [topics[0]], next_cursor: 'c2' } },
    );
    renderPage('/topics', api);
    await screen.findByRole('link', { name: 'cooking' });
    expect(rows().map(([name]) => name)).toEqual(['web development', 'cooking']);
  });

  it('is reached from the navigation', async () => {
    renderPage('/', new FakeApi());
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('link', { name: 'Topics' }).getAttribute('href')).toBe('/topics');
    expect(within(nav).getByRole('link', { name: 'Tags' }).getAttribute('href')).toBe('/tags');
  });
});

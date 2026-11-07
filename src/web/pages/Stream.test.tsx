import { act, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Link } from '../api';
import { FakeApi, fakeIntersectionObserver, renderPage } from '../test/helpers';

function makeLinks(n: number): Link[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `l${i}`,
    url: `https://site${i}.example/page`,
    original_url: `https://site${i}.example/page`,
    host: `site${i}.example`,
    title: `Title ${i}`,
    state: 'pending',
    added_at: '2026-03-04T10:00:00.000Z',
    last_used_at: '2026-03-05T10:00:00.000Z',
    use_count: 0,
    pinned: false,
    pin_position: null,
  }));
}

describe('the stream page', () => {
  it('shows one card per link in order and loads the next page at the end of the list', async () => {
    const all = makeLinks(70);
    const api = new FakeApi().on('GET', '/api/v1/links', (req) =>
      req.path.includes('cursor=page2')
        ? { status: 200, body: { items: all.slice(50), next_cursor: null } }
        : { status: 200, body: { items: all.slice(0, 50), next_cursor: 'page2' } },
    );
    const observer = fakeIntersectionObserver();
    renderPage('/', api);
    await screen.findByRole('article', { name: 'Title 0' });
    let cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(50);
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(
      all.slice(0, 50).map((l) => l.title),
    );
    const first = within(cards[0]!);
    expect(first.getByText('Title 0')).toBeTruthy();
    expect(first.getByText('site0.example')).toBeTruthy();
    expect(first.getByText(/Added 4 Mar 2026/)).toBeTruthy();
    expect(first.getByText(/Used 5 Mar 2026/)).toBeTruthy();
    expect(first.getByText('pending')).toBeTruthy();
    expect(first.getByRole('link', { name: 'Open' })).toBeTruthy();
    expect(first.getByRole('button', { name: 'Pin' })).toBeTruthy();
    expect(first.getByRole('button', { name: 'Delete' })).toBeTruthy();

    await act(async () => observer.reveal());
    await screen.findByRole('article', { name: 'Title 69' });
    expect(api.sent('GET', '/api/v1/links?cursor=page2')).toHaveLength(1);
    cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(70);

    await act(async () => observer.reveal());
    expect(api.sent('GET', '/api/v1/links')).toHaveLength(2);
  });
});

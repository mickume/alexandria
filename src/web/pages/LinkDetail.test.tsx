import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, renderPage } from '../test/helpers';

describe('the link detail page', () => {
  it('shows both URLs, the added date, the use count and every use', async () => {
    const api = new FakeApi()
      .on('GET', '/api/v1/links/abc', {
        status: 200,
        body: {
          id: 'abc',
          url: 'https://example.com/a',
          original_url: 'https://example.com/a?utm_source=x',
          host: 'example.com',
          title: 'example.com',
          state: 'pending',
          added_at: '2026-03-04T10:00:00.000Z',
          last_used_at: '2026-03-07T10:00:00.000Z',
          use_count: 2,
          pinned: false,
          pin_position: null,
        },
      })
      .on('GET', '/api/v1/links/abc/history', {
        status: 200,
        body: {
          items: [
            { kind: 'use', at: '2026-03-07T10:00:00.000Z' },
            { kind: 'use', at: '2026-03-06T10:00:00.000Z' },
          ],
          next_cursor: null,
        },
      });
    renderPage('/links/abc', api);
    expect(await screen.findByText('https://example.com/a?utm_source=x')).toBeTruthy();
    expect(screen.getByText('https://example.com/a')).toBeTruthy();
    expect(screen.getByText(/Added 4 Mar 2026/)).toBeTruthy();
    expect(screen.getByText('used 2 times')).toBeTruthy();
    const history = await screen.findByRole('list', { name: 'History' });
    const rows = within(history).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['Opened 7 Mar 2026', 'Opened 6 Mar 2026']);
  });
});

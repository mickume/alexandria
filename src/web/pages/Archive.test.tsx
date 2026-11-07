import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeApi, makeLink, renderPage } from '../test/helpers';

afterEach(() => {
  vi.useRealTimers();
});

describe('the Archive page', () => {
  it('lists archived links with their removal dates, restores one and deletes another after the undo window', async () => {
    const archived = [
      makeLink({
        id: 'b',
        title: 'Bravo',
        state: 'archived',
        archived_at: '2027-03-01T08:00:00.000Z',
        removal_at: '2027-08-28T08:00:00.000Z',
      }),
      makeLink({
        id: 'a',
        title: 'Alpha',
        state: 'archived',
        archived_at: '2027-02-01T08:00:00.000Z',
        removal_at: '2027-07-31T08:00:00.000Z',
      }),
    ];
    const api = new FakeApi()
      .on('GET', '/api/v1/archive', { status: 200, body: { items: archived, next_cursor: null } })
      .on('POST', '/api/v1/links/:id/restore', (_req, { id }) => ({
        status: 200,
        body: { ...archived.find((l) => l.id === id), state: 'active' },
      }))
      .on('DELETE', '/api/v1/links/:id', { status: 204 });
    renderPage('/archive', api);
    const rows = await screen.findAllByRole('article');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Bravo', 'Alpha']);
    expect(within(rows[0]!).getByText('removed on 2027-08-28')).toBeTruthy();

    await act(async () => within(rows[0]!).getByRole('button', { name: 'Restore' }).click());
    expect(api.sent('POST', '/api/v1/links/b/restore')).toHaveLength(1);
    expect(screen.queryByRole('article', { name: 'Bravo' })).toBeNull();

    vi.useFakeTimers();
    await act(async () =>
      within(screen.getByRole('article', { name: 'Alpha' }))
        .getByRole('button', { name: 'Delete' })
        .click(),
    );
    expect(screen.queryByRole('article', { name: 'Alpha' })).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(api.sent('DELETE', '/api/v1/links/a')).toHaveLength(1);
  });
});

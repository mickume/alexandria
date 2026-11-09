import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeApi, makeLink, renderPage } from '../test/helpers';

afterEach(() => {
  vi.useRealTimers();
});

describe('the Expired page', () => {
  it('lists expired links with their removal dates, restores one and deletes another after the undo window', async () => {
    const expired = [
      makeLink({
        id: 'b',
        title: 'Bravo',
        state: 'expired',
        expired_at: '2027-03-01T08:00:00.000Z',
        removal_at: '2027-08-28T08:00:00.000Z',
      }),
      makeLink({
        id: 'a',
        title: 'Alpha',
        state: 'expired',
        expired_at: '2027-02-01T08:00:00.000Z',
        removal_at: '2027-07-31T08:00:00.000Z',
      }),
    ];
    const api = new FakeApi()
      .on('GET', '/api/v1/expired', { status: 200, body: { items: expired, next_cursor: null } })
      .on('POST', '/api/v1/links/:id/restore', (_req, { id }) => ({
        status: 200,
        body: { ...expired.find((l) => l.id === id), state: 'active' },
      }))
      .on('DELETE', '/api/v1/links/:id', { status: 204 });
    renderPage('/expired', api);
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
    expect(screen.getByText('Nothing has expired.')).toBeTruthy();
  });

  it('lists every expired link, page after page', async () => {
    const page = (ids: string[], next: string | null) => ({
      status: 200,
      body: {
        items: ids.map((id) => makeLink({ id, title: `Link ${id}`, state: 'expired' })),
        next_cursor: next,
      },
    });
    const api = new FakeApi().on('GET', '/api/v1/expired', (req) =>
      req.path.includes('cursor=c2') ? page(['b'], null) : page(['a'], 'c2'),
    );
    renderPage('/expired', api);
    expect(await screen.findByRole('article', { name: 'Link b' })).toBeTruthy();
    expect(screen.getByRole('article', { name: 'Link a' })).toBeTruthy();
    expect(api.sent('GET', '/api/v1/expired').map((r) => r.path)).toEqual([
      '/api/v1/expired?limit=100',
      '/api/v1/expired?limit=100&cursor=c2',
    ]);
  });

  it('says so when nothing has expired', async () => {
    renderPage(
      '/expired',
      new FakeApi().on('GET', '/api/v1/expired', {
        status: 200,
        body: { items: [], next_cursor: null },
      }),
    );
    expect(await screen.findByText('Nothing has expired.')).toBeTruthy();
  });

  it('is in the navigation as Expired, and the Archive is gone', async () => {
    renderPage('/', new FakeApi());
    const entry = await screen.findByRole('link', { name: 'Expired' });
    expect(entry.getAttribute('href')).toBe('/expired');
    expect(screen.queryByRole('link', { name: 'Archive' })).toBeNull();
  });

  it('has no Archive page any more', async () => {
    renderPage('/archive', new FakeApi());
    await screen.findByRole('link', { name: 'Expired' });
    expect(screen.queryByRole('heading', { name: 'Archive' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Expired' })).toBeNull();
  });

  it('searches only expired links and shows the results on the Expired page', async () => {
    vi.useFakeTimers();
    const expired = makeLink({ id: 'k', title: 'Kiwi farming', state: 'expired' });
    const api = new FakeApi()
      .on('GET', '/api/v1/expired', {
        status: 200,
        body: {
          items: [makeLink({ id: 'o', title: 'Other', state: 'expired' })],
          next_cursor: null,
        },
      })
      .on('GET', '/api/v1/search', {
        status: 200,
        body: { items: [{ link: expired, snippet: [] }], workspaces: [], next_cursor: null },
      });
    renderPage('/expired', api);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('article', { name: 'Other' })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), {
      target: { value: 'kiwi' },
    });
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(api.sent('GET', '/api/v1/search').map((r) => r.path)).toEqual([
      '/api/v1/search?q=kiwi%20state%3Aexpired',
    ]);
    expect(window.location.pathname).toBe('/expired');
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('heading', { name: 'Expired' })).toBeTruthy();
    expect(screen.getByRole('article', { name: 'Kiwi farming' })).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'Other' })).toBeNull();
  });

  it('repeats a search by meaning from its address, among expired links only', async () => {
    const expired = makeLink({ id: 'k', title: 'Kiwi farming', state: 'expired' });
    const api = new FakeApi().on('GET', '/api/v1/search', {
      status: 200,
      body: {
        items: [{ link: expired, snippet: [] }],
        workspaces: [],
        next_cursor: null,
        meaning: 'used',
      },
    });
    renderPage('/expired?q=kiwi&mode=hybrid', api);

    expect(await screen.findByRole('article', { name: 'Kiwi farming' })).toBeTruthy();
    expect(api.sent('GET', '/api/v1/search').map((r) => r.path)).toEqual([
      '/api/v1/search?q=kiwi%20state%3Aexpired&mode=hybrid',
    ]);
  });

  it('marks a link found by meaning alone and says when meaning was left out', async () => {
    const byMeaning = makeLink({ id: 'm', title: 'Kiwi orchards', state: 'expired' });
    const byWords = makeLink({ id: 'w', title: 'Kiwi farming', state: 'expired' });
    const answer = (meaning: 'used' | 'unavailable') => ({
      items: [
        { link: byMeaning, snippet: [], match: 'meaning' },
        { link: byWords, snippet: [], match: 'keyword' },
      ],
      workspaces: [],
      next_cursor: null,
      meaning,
    });

    renderPage(
      '/expired?q=kiwi&mode=hybrid',
      new FakeApi().on('GET', '/api/v1/search', { status: 200, body: answer('unavailable') }),
    );
    const card = await screen.findByRole('article', { name: 'Kiwi orchards' });

    expect(screen.getAllByText('by meaning')).toHaveLength(1);
    expect(card.contains(screen.getByText('by meaning'))).toBe(true);
    const line = screen.getByText('Showing keyword matches only.');
    expect(line.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no line about meaning when meaning was used', async () => {
    const link = makeLink({ id: 'm', title: 'Kiwi orchards', state: 'expired' });
    renderPage(
      '/expired?q=kiwi&mode=hybrid',
      new FakeApi().on('GET', '/api/v1/search', {
        status: 200,
        body: {
          items: [{ link, snippet: [], match: 'keyword' }],
          workspaces: [],
          next_cursor: null,
          meaning: 'used',
        },
      }),
    );

    await screen.findByRole('article', { name: 'Kiwi orchards' });
    expect(screen.queryByText('Showing keyword matches only.')).toBeNull();
    expect(screen.queryByText('by meaning')).toBeNull();
  });
});

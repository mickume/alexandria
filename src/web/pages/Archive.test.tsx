import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeApi, makeLink, renderPage } from '../test/helpers';

afterEach(() => {
  vi.useRealTimers();
});

describe('the Archive page', () => {
  it('lists archived links dimmed with their archiving dates, unarchives one and deletes another after the undo window', async () => {
    const archived = [
      makeLink({
        id: 'b',
        title: 'Bravo',
        state: 'archived',
        points: null,
        archived_at: '2027-03-01T08:00:00.000Z',
      }),
      makeLink({
        id: 'a',
        title: 'Alpha',
        state: 'archived',
        points: null,
        archived_at: '2027-02-01T08:00:00.000Z',
      }),
    ];
    const api = new FakeApi()
      .on('GET', '/api/v1/archive', { status: 200, body: { items: archived, next_cursor: null } })
      .on('POST', '/api/v1/links/:id/unarchive', (_req, { id }) => ({
        status: 200,
        body: { ...archived.find((l) => l.id === id), state: 'active', archived_at: null },
      }))
      .on('DELETE', '/api/v1/links/:id', { status: 204 });
    renderPage('/archive', api);
    const rows = await screen.findAllByRole('article');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Bravo', 'Alpha']);
    expect(rows.every((r) => r.classList.contains('archived'))).toBe(true);
    expect(within(rows[0]!).getByText('archived on 2027-03-01')).toBeTruthy();

    await act(async () => within(rows[0]!).getByRole('button', { name: 'Unarchive' }).click());
    expect(api.sent('POST', '/api/v1/links/b/unarchive')).toHaveLength(1);
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
    expect(screen.getByText('Nothing is archived.')).toBeTruthy();
  });

  it('lists every archived link, page after page', async () => {
    const page = (ids: string[], next: string | null) => ({
      status: 200,
      body: {
        items: ids.map((id) => makeLink({ id, title: `Link ${id}`, state: 'archived' })),
        next_cursor: next,
      },
    });
    const api = new FakeApi().on('GET', '/api/v1/archive', (req) =>
      req.path.includes('cursor=c2') ? page(['b'], null) : page(['a'], 'c2'),
    );
    renderPage('/archive', api);
    expect(await screen.findByRole('article', { name: 'Link b' })).toBeTruthy();
    expect(screen.getByRole('article', { name: 'Link a' })).toBeTruthy();
  });

  it('says so when nothing is archived', async () => {
    renderPage(
      '/archive',
      new FakeApi().on('GET', '/api/v1/archive', {
        status: 200,
        body: { items: [], next_cursor: null },
      }),
    );
    expect(await screen.findByText('Nothing is archived.')).toBeTruthy();
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('is in the navigation as Archive, after Expired', async () => {
    renderPage('/', new FakeApi());
    const entry = await screen.findByRole('link', { name: 'Archive' });
    expect(entry.getAttribute('href')).toBe('/archive');
    const tabs = within(screen.getByRole('navigation', { name: 'Sections' }))
      .getAllByRole('link')
      .map((l) => l.textContent);
    expect(tabs.indexOf('Archive')).toBe(tabs.indexOf('Expired') + 1);
  });

  it('searches only archived links and shows the results on the Archive page', async () => {
    vi.useFakeTimers();
    const kept = makeLink({ id: 'k', title: 'Kiwi farming', state: 'archived' });
    const api = new FakeApi()
      .on('GET', '/api/v1/archive', {
        status: 200,
        body: {
          items: [makeLink({ id: 'o', title: 'Other', state: 'archived' })],
          next_cursor: null,
        },
      })
      .on('GET', '/api/v1/search', {
        status: 200,
        body: { items: [{ link: kept, snippet: [] }], workspaces: [], next_cursor: null },
      });
    renderPage('/archive', api);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('article', { name: 'Other' })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), {
      target: { value: 'kiwi' },
    });
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(api.sent('GET', '/api/v1/search').map((r) => r.path)).toEqual([
      '/api/v1/search?q=kiwi%20state%3Aarchived',
    ]);
    expect(window.location.pathname).toBe('/archive');
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('heading', { name: 'Archive' })).toBeTruthy();
    expect(screen.getByRole('article', { name: 'Kiwi farming' })).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'Other' })).toBeNull();
  });
});

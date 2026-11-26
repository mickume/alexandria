import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Link } from '../api';
import { FakeApi, makeLink, openMenu, renderPage } from '../test/helpers';

function makeLinks(n: number): Link[] {
  return Array.from({ length: n }, (_, i) =>
    makeLink({ id: `l${i}`, host: `site${i}.example`, title: `Title ${i}` }),
  );
}

/** A fake API that keeps links and answers the pinned list, pin, unpin and archive as the Worker does. */
function pinningApi(links: Link[]): FakeApi {
  const pinned = () =>
    links.filter((l) => l.pinned).sort((a, b) => (a.pin_position ?? 0) - (b.pin_position ?? 0));
  const renumber = (list: Link[]) =>
    list.forEach((l, i) => {
      l.pinned = true;
      l.pin_position = i + 1;
    });
  const unpin = (link: Link) => {
    link.pinned = false;
    link.pin_position = null;
    renumber(pinned());
  };
  return new FakeApi()
    .on('GET', '/api/v1/links', (req) =>
      req.path.includes('is=pinned')
        ? { status: 200, body: { items: pinned(), next_cursor: null } }
        : { status: 400, body: { error: 'unexpected' } },
    )
    .on('POST', '/api/v1/links/:id/pin', (req, { id }) => {
      const link = links.find((l) => l.id === id)!;
      const others = pinned().filter((l) => l.id !== id);
      const position = (req.body as { position?: number } | undefined)?.position;
      others.splice(Math.min(position ?? others.length + 1, others.length + 1) - 1, 0, link);
      renumber(others);
      return { status: 200, body: link };
    })
    .on('DELETE', '/api/v1/links/:id/pin', (_req, { id }) => {
      const link = links.find((l) => l.id === id)!;
      unpin(link);
      return { status: 200, body: link };
    })
    .on('POST', '/api/v1/links/:id/archive', (_req, { id }) => {
      const link = links.find((l) => l.id === id)!;
      unpin(link);
      link.state = 'archived';
      return { status: 200, body: link };
    });
}

function titles(): (string | null)[] {
  return screen.getAllByRole('article').map((c) => c.getAttribute('aria-label'));
}

describe('the pinned page', () => {
  it('has its tab between Stream and Workspaces', async () => {
    renderPage('/pinned', pinningApi([]));
    const tabs = within(screen.getByRole('navigation', { name: 'Sections' })).getAllByRole('link');
    const labels = tabs.map((l) => l.textContent);
    expect(labels.slice(0, 3)).toEqual(['Stream', 'Pinned', 'Workspaces']);
    expect(tabs[1]?.getAttribute('href')).toBe('/pinned');
    expect(tabs[1]?.getAttribute('aria-current')).toBe('page');
  });

  it('lists the pinned links in pin order, as search results are listed', async () => {
    const all = makeLinks(4);
    Object.assign(all[3]!, { pinned: true, pin_position: 1 });
    Object.assign(all[1]!, { pinned: true, pin_position: 2 });
    const api = pinningApi(all);
    renderPage('/pinned', api);
    await screen.findByRole('article', { name: 'Title 3' });
    expect(api.sent('GET', '/api/v1/links')[0]?.path).toBe('/api/v1/links?is=pinned&limit=100');
    const list = screen.getByRole('list', { name: 'Pinned links' });
    expect(
      within(list)
        .getAllByRole('article')
        .map((c) => c.getAttribute('aria-label')),
    ).toEqual(['Title 3', 'Title 1']);
  });

  it('reorders by dragging and takes a card off the page when it is unpinned or archived', async () => {
    const all = makeLinks(4);
    all.forEach((l, i) => Object.assign(l, { pinned: true, pin_position: i + 1 }));
    const api = pinningApi(all);
    renderPage('/pinned', api);
    await screen.findByRole('article', { name: 'Title 0' });

    const third = screen.getByRole('article', { name: 'Title 2' });
    const first = screen.getByRole('article', { name: 'Title 0' });
    await act(async () => {
      fireEvent.dragStart(third);
      fireEvent.dragOver(first);
      fireEvent.drop(first);
    });
    expect(api.sent('POST', '/api/v1/links/l2/pin')[0]?.body).toEqual({ position: 1 });
    await waitFor(() => expect(titles()).toEqual(['Title 2', 'Title 0', 'Title 1', 'Title 3']));

    const moved = screen.getByRole('article', { name: 'Title 2' });
    await act(async () => within(moved).getByRole('button', { name: 'Unpin' }).click());
    expect(api.sent('DELETE', '/api/v1/links/l2/pin')).toHaveLength(1);
    await waitFor(() => expect(titles()).toEqual(['Title 0', 'Title 1', 'Title 3']));

    const last = screen.getByRole('article', { name: 'Title 3' });
    openMenu(within(last).getByRole('button', { name: 'More actions' }));
    await act(async () => screen.getByRole('menuitem', { name: 'Archive' }).click());
    expect(api.sent('POST', '/api/v1/links/l3/archive')).toHaveLength(1);
    await waitFor(() => expect(titles()).toEqual(['Title 0', 'Title 1']));
  });

  it('says so when nothing is pinned', async () => {
    renderPage('/pinned', pinningApi(makeLinks(2)));
    expect(await screen.findByText(/Nothing pinned yet/)).toBeTruthy();
    expect(screen.queryByRole('article')).toBeNull();
  });
});

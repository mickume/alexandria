import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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

/** A fake API that keeps a stream and answers pin and unpin requests the way the Worker does. */
function pinningApi(links: Link[], { limit = false } = {}): FakeApi {
  const order = () => {
    const pinned = links
      .filter((l) => l.pinned)
      .sort((a, b) => (a.pin_position ?? 0) - (b.pin_position ?? 0));
    return [...pinned, ...links.filter((l) => !l.pinned)];
  };
  const renumber = (pinned: Link[]) =>
    pinned.forEach((l, i) => {
      l.pinned = true;
      l.pin_position = i + 1;
    });
  return new FakeApi()
    .on('GET', '/api/v1/links', () => ({
      status: 200,
      body: { items: order(), next_cursor: null },
    }))
    .on('POST', '/api/v1/links/:id/pin', (req, { id }) => {
      const link = links.find((l) => l.id === id)!;
      const pinned = order().filter((l) => l.pinned && l.id !== id);
      if (limit && !link.pinned) {
        return { status: 409, body: { error: 'pin_limit', message: 'unpin something first' } };
      }
      const position = (req.body as { position?: number } | undefined)?.position;
      const at = Math.min(position ?? pinned.length + 1, pinned.length + 1) - 1;
      pinned.splice(at, 0, link);
      renumber(pinned);
      return { status: 200, body: link };
    })
    .on('DELETE', '/api/v1/links/:id/pin', (_req, { id }) => {
      const link = links.find((l) => l.id === id)!;
      link.pinned = false;
      link.pin_position = null;
      renumber(order().filter((l) => l.pinned));
      return { status: 200, body: link };
    });
}

function titles(): (string | null)[] {
  return screen.getAllByRole('article').map((c) => c.getAttribute('aria-label'));
}

describe('pinning on the stream page', () => {
  it('pins, reorders by dragging and unpins, showing the order the API returns', async () => {
    const all = makeLinks(5);
    all.slice(0, 3).forEach((l, i) => Object.assign(l, { pinned: true, pin_position: i + 1 }));
    const api = pinningApi(all);
    renderPage('/', api);
    await screen.findByRole('article', { name: 'Title 0' });

    const fourth = screen.getByRole('article', { name: 'Title 3' });
    await act(async () => within(fourth).getByRole('button', { name: 'Pin' }).click());
    const pins = api.sent('POST', '/api/v1/links/l3/pin');
    expect(pins).toHaveLength(1);
    expect(pins[0]?.body).toBeUndefined();
    await waitFor(() =>
      expect(titles()).toEqual(['Title 0', 'Title 1', 'Title 2', 'Title 3', 'Title 4']),
    );

    const third = screen.getByRole('article', { name: 'Title 2' });
    const first = screen.getByRole('article', { name: 'Title 0' });
    await act(async () => {
      fireEvent.dragStart(third);
      fireEvent.dragOver(first);
      fireEvent.drop(first);
    });
    expect(api.sent('POST', '/api/v1/links/l2/pin')[0]?.body).toEqual({ position: 1 });
    await waitFor(() =>
      expect(titles()).toEqual(['Title 2', 'Title 0', 'Title 1', 'Title 3', 'Title 4']),
    );

    const pinnedFirst = screen.getByRole('article', { name: 'Title 2' });
    await act(async () => within(pinnedFirst).getByRole('button', { name: 'Unpin' }).click());
    expect(api.sent('DELETE', '/api/v1/links/l2/pin')).toHaveLength(1);
    await waitFor(() => expect(titles().slice(0, 3)).toEqual(['Title 0', 'Title 1', 'Title 3']));
  });

  it('says to unpin something first when the pin limit is reached', async () => {
    const api = pinningApi(makeLinks(3), { limit: true });
    renderPage('/', api);
    await screen.findByRole('article', { name: 'Title 0' });
    const before = titles();
    const card = screen.getByRole('article', { name: 'Title 2' });
    await act(async () => within(card).getByRole('button', { name: 'Pin' }).click());
    expect(await screen.findByText('unpin something first')).toBeTruthy();
    expect(titles()).toEqual(before);
  });
});

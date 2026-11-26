import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Link } from '../api';
import { FakeApi, fakeIntersectionObserver, makeLink, renderPage, openMenu } from '../test/helpers';

function makeLinks(n: number): Link[] {
  return Array.from({ length: n }, (_, i) =>
    makeLink({ id: `l${i}`, host: `site${i}.example`, title: `Title ${i}` }),
  );
}

describe('archiving from the stream page', () => {
  it('archives a card from its More actions menu and takes it out of the stream', async () => {
    const all = makeLinks(2);
    const api = new FakeApi()
      .on('GET', '/api/v1/links', { status: 200, body: { items: all, next_cursor: null } })
      .on('POST', '/api/v1/links/:id/archive', (_req, { id }) => ({
        status: 200,
        body: { ...all.find((l) => l.id === id), state: 'archived', points: null },
      }));
    renderPage('/', api);
    const card = await screen.findByRole('article', { name: 'Title 1' });
    openMenu(within(card).getByRole('button', { name: 'More actions' }));
    await act(async () => screen.getByRole('menuitem', { name: 'Archive' }).click());
    expect(api.sent('POST', '/api/v1/links/l1/archive')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Title 1' })).toBeNull());
    expect(screen.getByRole('article', { name: 'Title 0' })).toBeTruthy();
  });
});

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
    expect(first.getByRole('button', { name: 'More actions' })).toBeTruthy();

    await act(async () => observer.reveal());
    await screen.findByRole('article', { name: 'Title 69' });
    expect(api.sent('GET', '/api/v1/links?cursor=page2')).toHaveLength(1);
    cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(70);

    await act(async () => observer.reveal());
    expect(api.sent('GET', '/api/v1/links')).toHaveLength(2);
  });
});

function titles(): (string | null)[] {
  return screen.getAllByRole('article').map((c) => c.getAttribute('aria-label'));
}

describe('pinning on the stream page', () => {
  it('leaves the pinned links out and takes a card out of the stream once it is pinned', async () => {
    const all = makeLinks(70);
    all.slice(0, 2).forEach((l, i) => Object.assign(l, { pinned: true, pin_position: i + 1 }));
    const api = new FakeApi()
      .on('GET', '/api/v1/links', (req) =>
        req.path.includes('cursor=page2')
          ? { status: 200, body: { items: all.slice(50), next_cursor: null } }
          : { status: 200, body: { items: all.slice(0, 50), next_cursor: 'page2' } },
      )
      .on('POST', '/api/v1/links/:id/pin', (_req, { id }) => ({
        status: 200,
        body: { ...all.find((l) => l.id === id), pinned: true, pin_position: 3 },
      }));
    const observer = fakeIntersectionObserver();
    renderPage('/', api);
    await screen.findByRole('article', { name: 'Title 2' });
    expect(screen.queryByRole('article', { name: 'Title 0' })).toBeNull();
    expect(screen.queryByRole('article', { name: 'Title 1' })).toBeNull();
    await act(async () => observer.reveal());
    await screen.findByRole('article', { name: 'Title 69' });
    expect(titles()).toHaveLength(68);

    const far = screen.getByRole('article', { name: 'Title 60' });
    await act(async () => within(far).getByRole('button', { name: 'Pin' }).click());
    expect(api.sent('POST', '/api/v1/links/l60/pin')[0]?.body).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Title 60' })).toBeNull());
    expect(titles()).toHaveLength(67);
    // Pinning shows the card's absence; it does not load the stream again.
    expect(api.sent('GET', '/api/v1/links')).toHaveLength(2);
  });

  it('says to unpin something first when the pin limit is reached', async () => {
    const api = new FakeApi()
      .on('GET', '/api/v1/links', {
        status: 200,
        body: { items: makeLinks(3), next_cursor: null },
      })
      .on('POST', '/api/v1/links/:id/pin', {
        status: 409,
        body: { error: 'pin_limit', message: 'unpin something first' },
      });
    renderPage('/', api);
    await screen.findByRole('article', { name: 'Title 0' });
    const before = titles();
    const card = screen.getByRole('article', { name: 'Title 2' });
    await act(async () => within(card).getByRole('button', { name: 'Pin' }).click());
    expect(await screen.findByText('unpin something first')).toBeTruthy();
    expect(titles()).toEqual(before);
  });
});

describe('adding a link to a workspace on the stream page', () => {
  it('shows the card’s decay note as the API has it once the link is in the workspace', async () => {
    const before = makeLink({
      id: 'l0',
      title: 'Title 0',
      decay_note: 'expires in 60 days',
    });
    const after: Link = {
      ...before,
      workspaces: [{ id: 'w', name: 'Reading' }],
      decay_note: 'in a workspace: never expires',
    };
    const api = new FakeApi()
      .on('GET', '/api/v1/links', { status: 200, body: { items: [before], next_cursor: null } })
      .on('GET', '/api/v1/workspaces', {
        status: 200,
        body: {
          items: [
            {
              id: 'w',
              name: 'Reading',
              description: '',
              link_count: 0,
              created_at: '2026-01-01T00:00:00.000Z',
            },
          ],
          next_cursor: null,
        },
      })
      .on('POST', '/api/v1/workspaces/w/links', { status: 201, body: { position: 1 } })
      .on('GET', '/api/v1/links/l0', { status: 200, body: after });
    renderPage('/', api);
    const card = await screen.findByRole('article', { name: 'Title 0' });
    expect(within(card).getByText('expires in 60 days')).toBeTruthy();

    openMenu(within(card).getByRole('button', { name: 'More actions' }));
    await act(async () => screen.getByRole('menuitem', { name: 'Add to workspace' }).click());
    await act(async () =>
      (await screen.findByRole('menuitemcheckbox', { name: 'Reading' })).click(),
    );

    expect(await within(card).findByText('in a workspace: never expires')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Reading' }).getAttribute('href')).toBe(
      '/workspaces/w',
    );
  });
});

describe('deleting on the stream page', () => {
  async function ready(answer: Parameters<FakeApi['on']>[2] = { status: 204 }) {
    const all = makeLinks(3);
    const api = new FakeApi()
      .on('GET', '/api/v1/links', { status: 200, body: { items: all, next_cursor: null } })
      .on('DELETE', '/api/v1/links/:id', answer);
    renderPage('/', api);
    await screen.findByRole('article', { name: 'Title 1' });
    vi.useFakeTimers();
    return api;
  }

  async function clickDelete(title: string) {
    const card = screen.getByRole('article', { name: title });
    openMenu(within(card).getByRole('button', { name: 'More actions' }));
    await act(async () => screen.getByRole('menuitem', { name: 'Delete' }).click());
    // The toast with Undo shows a moment after the delete is asked for.
    await act(async () => vi.advanceTimersByTimeAsync(50));
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides the card and sends the delete only after 10 seconds without Undo', async () => {
    const api = await ready();
    await clickDelete('Title 1');
    expect(screen.queryByRole('article', { name: 'Title 1' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(9_900));
    expect(api.sent('DELETE')).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    // The toast goes with the window, once it has faded.
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(api.sent('DELETE', '/api/v1/links/l1')).toHaveLength(1);

    await clickDelete('Title 2');
    await act(async () => screen.getByRole('button', { name: 'Undo' }).click());
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(api.sent('DELETE', '/api/v1/links/l2')).toHaveLength(0);
    expect(titles()).toEqual(['Title 0', 'Title 2']);
  });

  it('sends a pending delete at once with keepalive when the page is left', async () => {
    const api = await ready();
    await clickDelete('Title 1');
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    const sent = api.sent('DELETE', '/api/v1/links/l1');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.keepalive).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(api.sent('DELETE')).toHaveLength(1);
  });

  it.each([
    { label: 'a network error', answer: 'network-error' as const },
    { label: 'a server error', answer: { status: 500, body: { error: 'internal' } } },
  ])('puts the card back after $label', async ({ answer }) => {
    await ready(answer);
    await clickDelete('Title 1');
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(titles()).toEqual(['Title 0', 'Title 1', 'Title 2']);
    expect(screen.getAllByText('could not delete, try again')).not.toHaveLength(0);
  });
});

describe('the stream while links are being fetched', () => {
  it('asks for changes every 5 seconds and replaces a fetched card in place, then stops', async () => {
    const links = [
      makeLink({
        id: 'a',
        title: 'Alpha',
        state: 'active',
        updated_at: '2026-03-05T10:00:00.000Z',
      }),
      makeLink({
        id: 'p',
        title: 'p.example',
        state: 'pending',
        updated_at: '2026-03-05T10:00:01.000Z',
      }),
      makeLink({
        id: 'c',
        title: 'Gamma',
        state: 'active',
        updated_at: '2026-03-05T09:00:00.000Z',
      }),
    ];
    const api = new FakeApi().on('GET', '/api/v1/links', (req) =>
      req.path.includes('changed_since=')
        ? {
            status: 200,
            body: {
              items: [
                {
                  ...links[1]!,
                  state: 'active',
                  title: 'An Article',
                  updated_at: '2026-03-05T10:00:04.000Z',
                },
              ],
              server_time: '2026-03-05T10:00:05.000Z',
            },
          }
        : { status: 200, body: { items: links, next_cursor: null } },
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage('/', api);
      await screen.findByRole('article', { name: 'p.example' });
      await act(async () => vi.advanceTimersByTimeAsync(5_000));
      const polls = api.sent('GET', '/api/v1/links?changed_since=');
      expect(polls).toHaveLength(1);
      expect(polls[0]?.path).toBe('/api/v1/links?changed_since=2026-03-05T10%3A00%3A01.000Z');
      expect(titles()).toEqual(['Alpha', 'An Article', 'Gamma']);
      await act(async () => vi.advanceTimersByTimeAsync(15_000));
      expect(api.sent('GET', '/api/v1/links?changed_since=')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the stream while links are being enriched', () => {
  it('keeps asking for changes while a card is queued for enrichment, then shows its summary', async () => {
    const queued = makeLink({
      id: 'q',
      title: 'Queued',
      state: 'active',
      enrichment_status: 'queued',
      updated_at: '2026-03-05T10:00:00.000Z',
    });
    const api = new FakeApi().on('GET', '/api/v1/links', (req) =>
      req.path.includes('changed_since=')
        ? {
            status: 200,
            body: {
              items: [
                {
                  ...queued,
                  enrichment_status: 'enriched',
                  summary: 'Now summarised.',
                  updated_at: '2026-03-05T10:00:06.000Z',
                },
              ],
              server_time: '2026-03-05T10:00:07.000Z',
            },
          }
        : { status: 200, body: { items: [queued], next_cursor: null } },
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage('/', api);
      await screen.findByRole('article', { name: 'Queued' });
      await act(async () => vi.advanceTimersByTimeAsync(5_000));
      expect(api.sent('GET', '/api/v1/links?changed_since=')).toHaveLength(1);
      expect(screen.getByText('Now summarised.')).toBeTruthy();
      await act(async () => vi.advanceTimersByTimeAsync(15_000));
      expect(api.sent('GET', '/api/v1/links?changed_since=')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the stream with a rejected AI key', () => {
  it('carries no rejection message on any card', async () => {
    const api = new FakeApi().on('GET', '/api/v1/links', {
      status: 200,
      body: {
        items: makeLinks(2).map((l) => ({
          ...l,
          state: 'active',
          enrichment_status: 'waiting_for_key',
        })),
        next_cursor: null,
      },
    });
    renderPage('/', api);
    await screen.findByRole('article', { name: 'Title 0' });
    expect(screen.queryByText(/rejected/)).toBeNull();
  });
});

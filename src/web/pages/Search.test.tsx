import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeApi, makeLink, renderPage } from '../test/helpers';

afterEach(() => {
  vi.useRealTimers();
});

const queues = makeLink({ id: 'q1', title: 'Cloudflare Queues explained' });
const results = {
  items: [
    {
      link: queues,
      snippet: [
        { text: 'Cloudflare ', match: false },
        { text: 'Queues', match: true },
        { text: ' and <b>x</b> in depth', match: false },
      ],
    },
  ],
  workspaces: [{ id: 'w1', name: 'Messaging', snippet: [{ text: 'queues', match: true }] }],
  next_cursor: null,
};

function api(answer: unknown = results): FakeApi {
  return new FakeApi()
    .on('GET', '/api/v1/links', {
      status: 200,
      body: { items: [makeLink({ id: 's1', title: 'In the stream' })], next_cursor: null },
    })
    .on('GET', '/api/v1/search', { status: 200, body: answer });
}

const searchBox = () => screen.getByRole('searchbox', { name: 'Search' }) as HTMLInputElement;

/** Types `text` one character every 50 ms, as a person would. */
async function typeSlowly(input: HTMLInputElement, text: string) {
  for (let i = 1; i <= text.length; i++) {
    fireEvent.change(input, { target: { value: text.slice(0, i) } });
    await act(async () => vi.advanceTimersByTimeAsync(50));
  }
}

describe('the Search page', () => {
  it('searches 200 ms after the last keystroke and shows workspaces, then cards with snippets', async () => {
    vi.useFakeTimers();
    const { api: fake } = renderPage('/', api());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(searchBox().maxLength).toBe(200);
    await typeSlowly(searchBox(), 'queues');
    // 50 ms have passed since the last keystroke.
    await act(async () => vi.advanceTimersByTimeAsync(149));
    expect(fake.sent('GET', '/api/v1/search')).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fake.sent('GET', '/api/v1/search').map((r) => r.path)).toEqual([
      '/api/v1/search?q=queues',
    ]);
    expect(window.location.pathname + window.location.search).toBe('/search?q=queues');
    await act(async () => vi.advanceTimersByTimeAsync(0));

    const card = screen.getByRole('article', { name: 'Cloudflare Queues explained' });
    const result = card.closest('li')!;
    const marks = result.querySelectorAll('.snippet mark');
    expect([...marks].map((m) => m.textContent)).toEqual(['Queues']);
    expect(within(result).getByText(/and <b>x<\/b> in depth/)).toBeTruthy();
    expect(result.querySelector('.snippet b')).toBeNull();

    const workspaces = screen.getByRole('list', { name: 'Matching workspaces' });
    expect(within(workspaces).getByRole('link', { name: 'Messaging' }).getAttribute('href')).toBe(
      '/workspaces/w1',
    );
    expect(
      workspaces.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('says nothing was found and lists the active filters', async () => {
    renderPage(
      '/search?q=zebra%20tag%3Aanimals%20is%3Apinned',
      api({ items: [], workspaces: [], next_cursor: null }),
    );
    expect(await screen.findByText('nothing found for zebra tag:animals is:pinned')).toBeTruthy();
    const chips = screen.getByRole('list', { name: 'Active filters' });
    expect(
      within(chips)
        .getAllByRole('listitem')
        .map((c) => c.textContent),
    ).toEqual(['tag:animals', 'is:pinned']);
  });

  it('returns to the stream when the box is emptied', async () => {
    vi.useFakeTimers();
    renderPage('/search?q=x', api());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    fireEvent.change(searchBox(), { target: { value: '' } });
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(window.location.pathname + window.location.search).toBe('/');
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('article', { name: 'In the stream' })).toBeTruthy();
  });

  it('loads the next page of results', async () => {
    const second = makeLink({ id: 'q2', title: 'More queues' });
    const fake = new FakeApi().on('GET', '/api/v1/search', (req) =>
      req.path.includes('cursor=c2')
        ? {
            status: 200,
            body: { items: [{ link: second, snippet: [] }], workspaces: [], next_cursor: null },
          }
        : { status: 200, body: { ...results, next_cursor: 'c2' } },
    );
    renderPage('/search?q=queues', fake);
    await screen.findByRole('article', { name: 'Cloudflare Queues explained' });
    await act(async () => screen.getByRole('button', { name: 'More results' }).click());
    expect(await screen.findByRole('article', { name: 'More queues' })).toBeTruthy();
    expect(fake.sent('GET', '/api/v1/search').at(-1)?.path).toBe(
      '/api/v1/search?q=queues&cursor=c2',
    );
  });
});

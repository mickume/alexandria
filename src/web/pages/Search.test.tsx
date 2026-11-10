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

  it('goes back to searching by keyword when the owner types after a search by meaning', async () => {
    vi.useFakeTimers();
    const { api: fake } = renderPage('/search?q=alarms&mode=hybrid', api());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(fake.sent('GET', '/api/v1/search').map((r) => r.path)).toEqual([
      '/api/v1/search?q=alarms&mode=hybrid',
    ]);

    fireEvent.change(searchBox(), { target: { value: 'alarms later' } });
    await act(async () => vi.advanceTimersByTimeAsync(200));

    expect(fake.sent('GET', '/api/v1/search').at(-1)?.path).toBe('/api/v1/search?q=alarms%20later');
    expect(window.location.pathname + window.location.search).toBe('/search?q=alarms%20later');
  });

  it('unarchives an archived result in place, which is then no longer dimmed', async () => {
    const kept = makeLink({ id: 'k1', title: 'Kept page', state: 'archived', points: null });
    const fake = api({
      items: [{ link: kept, snippet: [] }],
      workspaces: [],
      next_cursor: null,
    }).on('POST', '/api/v1/links/k1/unarchive', {
      status: 200,
      body: { ...kept, state: 'active', points: 60 },
    });
    renderPage('/search?q=kept', fake);
    const card = await screen.findByRole('article', { name: 'Kept page' });
    expect(card.classList.contains('archived')).toBe(true);
    await act(async () => within(card).getByRole('button', { name: 'Unarchive' }).click());
    expect(fake.sent('POST', '/api/v1/links/k1/unarchive')).toHaveLength(1);
    const after = await screen.findByRole('article', { name: 'Kept page' });
    expect(after.classList.contains('archived')).toBe(false);
    expect(within(after).getByRole('button', { name: 'Pin' })).toBeTruthy();
  });

  it('repeats a search by meaning from its address, the next page included', async () => {
    const second = makeLink({ id: 'q2', title: 'More queues' });
    const fake = new FakeApi().on('GET', '/api/v1/search', (req) =>
      req.path.includes('cursor=c2')
        ? {
            status: 200,
            body: {
              items: [{ link: second, snippet: [] }],
              workspaces: [],
              next_cursor: null,
              meaning: 'used',
            },
          }
        : { status: 200, body: { ...results, next_cursor: 'c2', meaning: 'used' } },
    );
    renderPage('/search?q=queues&mode=hybrid', fake);
    await screen.findByRole('article', { name: 'Cloudflare Queues explained' });
    await act(async () => screen.getByRole('button', { name: 'More results' }).click());
    await screen.findByRole('article', { name: 'More queues' });

    expect(fake.sent('GET', '/api/v1/search').map((r) => r.path)).toEqual([
      '/api/v1/search?q=queues&mode=hybrid',
      '/api/v1/search?q=queues&cursor=c2&mode=hybrid',
    ]);
  });

  describe('a search by meaning', () => {
    const found = makeLink({ id: 'm1', title: 'Durable Object alarms' });
    const both = makeLink({ id: 'b1', title: 'Alarm clocks' });
    const words = makeLink({ id: 'k1', title: 'Alarm bells' });
    const hybrid = (meaningState?: 'used' | 'unavailable') => ({
      items: [
        {
          link: found,
          snippet: [{ text: 'schedule a task for later', match: false }],
          match: 'meaning',
        },
        { link: both, snippet: [{ text: 'Alarm', match: true }], match: 'both' },
        { link: words, snippet: [{ text: 'Alarm', match: true }], match: 'keyword' },
      ],
      workspaces: [],
      next_cursor: null,
      ...(meaningState ? { meaning: meaningState } : {}),
    });

    it('marks a link found by meaning alone “by meaning” beside its snippet, and no other', async () => {
      renderPage('/search?q=later&mode=hybrid', api(hybrid('used')));
      await screen.findByRole('article', { name: 'Durable Object alarms' });

      const marks = screen.getAllByText('by meaning');
      expect(marks).toHaveLength(1);
      const row = screen.getByRole('article', { name: 'Durable Object alarms' }).closest('li')!;
      expect(row.contains(marks[0]!)).toBe(true);
      expect(within(row).getByText('schedule a task for later')).toBeTruthy();
      expect(marks[0]!.parentElement).toBe(
        within(row).getByText('schedule a task for later').closest('p')!.parentElement,
      );
    });

    it.each([
      { name: 'meaning was not used', answer: hybrid('unavailable'), shown: true },
      { name: 'meaning was used', answer: hybrid('used'), shown: false },
      {
        name: 'the answer is a keyword search’s',
        answer: { ...hybrid(), items: [] },
        shown: false,
      },
    ])(
      'shows “Showing keyword matches only.” above the results only when $name',
      async ({ answer, shown }) => {
        renderPage('/search?q=later&mode=hybrid', api(answer));
        await act(async () => undefined);
        await act(async () => undefined);

        const line = screen.queryByText('Showing keyword matches only.');
        expect(line !== null).toBe(shown);
        if (line) {
          const results = screen.getByRole('list', { name: 'Results' });
          expect(
            line.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING,
          ).toBeTruthy();
        }
      },
    );
  });
});

describe("a topic's links", () => {
  const topic = (id: string, name: string, parent_id: string | null) => ({
    id,
    name,
    count: 1,
    subtree_count: 1,
    newest_added_at: '2026-01-01T00:00:00Z',
    parent_id,
  });
  const tree = [
    topic('t1', 'Software engineering', null),
    topic('t2', 'Testing', 't1'),
    topic('t3', 'Unit tests', 't2'),
    topic('t4', 'Cooking', null),
  ];

  function withTopics(): FakeApi {
    return api().on('GET', '/api/v1/topics', {
      status: 200,
      body: { items: tree, next_cursor: null },
    });
  }

  it('shows the topic’s path above the results, each parent opening its own topic', async () => {
    const { api: fake } = renderPage('/search?q=topic%3A%22unit%20tests%22', withTopics());
    await act(async () => undefined);
    await act(async () => undefined);

    const nav = screen.getByRole('navigation', { name: 'Topic path' });
    expect(nav.textContent).toBe('Software engineering›Testing›Unit tests');
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Software engineering', '/search?q=topic%3A%22Software%20engineering%22'],
      ['Testing', '/search?q=topic%3ATesting'],
    ]);
    expect(within(nav).getByText('Unit tests').getAttribute('aria-current')).toBe('page');
    const results = screen.getByRole('list', { name: 'Results' });
    expect(nav.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fake.sent('GET', '/api/v1/topics')).toHaveLength(1);
  });

  it('finds the topic ignoring case, beside other words of the query', async () => {
    renderPage('/search?q=mocks%20topic%3Atesting', withTopics());
    await act(async () => undefined);
    await act(async () => undefined);

    const nav = screen.getByRole('navigation', { name: 'Topic path' });
    expect(nav.textContent).toBe('Software engineering›Testing');
  });

  it('shows a top-level topic alone', async () => {
    renderPage('/search?q=topic%3Acooking', withTopics());
    await act(async () => undefined);
    await act(async () => undefined);

    const nav = screen.getByRole('navigation', { name: 'Topic path' });
    expect(within(nav).queryAllByRole('link')).toHaveLength(0);
    expect(within(nav).getByText('Cooking').getAttribute('aria-current')).toBe('page');
  });

  it.each([
    { name: 'without a topic filter', q: 'queues tag%3Atesting' },
    { name: 'with two topic filters', q: 'topic%3Atesting topic%3Acooking' },
  ])('shows no path and asks for no topics $name', async ({ q }) => {
    const { api: fake } = renderPage(`/search?q=${q}`, withTopics());
    await act(async () => undefined);
    await act(async () => undefined);

    expect(screen.queryByRole('navigation', { name: 'Topic path' })).toBeNull();
    expect(fake.sent('GET', '/api/v1/topics')).toHaveLength(0);
  });

  it('shows no path for a topic the owner does not have', async () => {
    renderPage('/search?q=topic%3Aunit-tests', withTopics());
    await act(async () => undefined);
    await act(async () => undefined);

    expect(screen.queryByRole('navigation', { name: 'Topic path' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Results' })).toBeTruthy();
  });
});

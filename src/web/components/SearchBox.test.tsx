import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeApi, makeLink, renderPage } from '../test/helpers';

afterEach(() => {
  vi.useRealTimers();
});

/** A fake API that answers what the pages load on their own. */
function pagesApi(): FakeApi {
  const link = makeLink({ id: 'l1', title: 'Queues explained' });
  return new FakeApi()
    .on('GET', '/api/v1/links', { status: 200, body: { items: [link], next_cursor: null } })
    .on('GET', '/api/v1/links/:id', { status: 200, body: { ...link, note: '' } })
    .on('GET', '/api/v1/links/:id/history', { status: 200, body: { items: [], next_cursor: null } })
    .on('GET', '/api/v1/archive', { status: 200, body: { items: [], next_cursor: null } })
    .on('GET', '/api/v1/topics', { status: 200, body: { items: [], next_cursor: null } })
    .on('GET', '/api/v1/tags', { status: 200, body: { items: [], next_cursor: null } })
    .on('GET', '/api/v1/search', {
      status: 200,
      body: { items: [{ link, snippet: [] }], workspaces: [], next_cursor: null },
    });
}

const searchBox = () => screen.getByRole('searchbox', { name: 'Search' }) as HTMLInputElement;

describe('the search box', () => {
  it.each(['/', '/settings', '/topics', '/tags', '/links/l1', '/archive'])(
    "is on %s, and '/' outside a text field focuses it without typing",
    async (page) => {
      const user = userEvent.setup();
      renderPage(page, pagesApi());
      await act(async () => undefined);
      expect(searchBox().maxLength).toBe(200);
      (document.activeElement as HTMLElement | null)?.blur();
      await user.keyboard('/');
      expect(document.activeElement).toBe(searchBox());
      expect(searchBox().value).toBe('');
    },
  );

  it("types '/' into another text field and leaves the focus there", async () => {
    const user = userEvent.setup();
    renderPage('/', pagesApi());
    const add = await screen.findByRole('textbox', { name: 'Add links' });
    await user.click(add);
    await user.keyboard('a/b');
    expect((add as HTMLTextAreaElement).value).toBe('a/b');
    expect(document.activeElement).toBe(add);
    expect(searchBox().value).toBe('');
  });

  it('clears on Escape, returns to the page the search started from and focuses the main region', async () => {
    vi.useFakeTimers();
    renderPage('/', pagesApi());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(searchBox());
    fireEvent.change(searchBox(), { target: { value: 'queues' } });
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(window.location.pathname + window.location.search).toBe('/search?q=queues');
    fireEvent.keyDown(searchBox(), { key: 'Escape' });
    expect(searchBox().value).toBe('');
    expect(window.location.pathname + window.location.search).toBe('/');
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('returns to the page it started from, not the stream, when that page was another', async () => {
    vi.useFakeTimers();
    renderPage('/topics', pagesApi());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    fireEvent.change(searchBox(), { target: { value: 'kiwi' } });
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(window.location.pathname).toBe('/search');
    fireEvent.keyDown(searchBox(), { key: 'Escape' });
    expect(window.location.pathname).toBe('/topics');
  });

  it('returns to the stream on Escape when the search started on the results page', async () => {
    const user = userEvent.setup();
    renderPage('/search?q=queues', pagesApi());
    await act(async () => undefined);
    expect(searchBox().value).toBe('queues');
    await user.click(searchBox());
    await user.keyboard('{Escape}');
    expect(window.location.pathname + window.location.search).toBe('/');
    expect(searchBox().value).toBe('');
  });

  it.each([
    'j',
    'k',
    'n',
    'g',
    '?',
    's',
    '{Enter}',
    '{Delete}',
    '{ArrowDown}',
    '{Control>}k{/Control}',
  ])('takes %s outside a text field as no shortcut', async (key) => {
    const user = userEvent.setup();
    const { api } = renderPage('/', pagesApi());
    await act(async () => undefined);
    (document.activeElement as HTMLElement | null)?.blur();
    const focused = document.activeElement;
    const sent = api.requests.length;
    await user.keyboard(key);
    await act(async () => undefined);
    expect(document.activeElement).toBe(focused);
    expect(window.location.pathname + window.location.search).toBe('/');
    expect(api.requests.length).toBe(sent);
  });
});

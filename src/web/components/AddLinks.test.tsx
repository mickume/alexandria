import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, renderPage } from '../test/helpers';

function link(host: string, extra: Record<string, unknown> = {}) {
  return {
    id: `id-${host}`,
    url: `https://${host}`,
    original_url: `https://${host}`,
    host,
    title: host,
    state: 'pending',
    added_at: '2026-06-01T00:00:00.000Z',
    last_used_at: '2026-06-01T00:00:00.000Z',
    use_count: 0,
    pinned: false,
    pin_position: null,
    ...extra,
  };
}

describe('the add input', () => {
  it('sends a paste as one batch and shows what happened to each URL', async () => {
    const older = link('older.example', { last_used_at: '2026-05-01T00:00:00.000Z' });
    const c = link('c.example', { last_used_at: '2026-04-01T00:00:00.000Z' });
    const api = new FakeApi()
      .on('GET', '/api/v1/links', { status: 200, body: { items: [older, c], next_cursor: null } })
      .on('POST', '/api/v1/links/batch', {
        status: 200,
        body: {
          added: [link('a.example', { last_used_at: '2026-06-02T00:00:00.000Z' })],
          boosted: [{ ...c, last_used_at: '2026-06-01T23:59:59.999Z' }],
          invalid: [
            { url: 'nope', error: 'invalid_url' },
            { url: 'x', error: 'library_full' },
          ],
        },
      });
    renderPage('/', api);
    await screen.findByRole('article', { name: 'older.example' });

    const input = screen.getByLabelText('Add links');
    fireEvent.change(input, { target: { value: 'https://a.example\nnope  https://c.example x' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    const batches = api.sent('POST', '/api/v1/links/batch');
    expect(batches).toHaveLength(1);
    expect(batches[0]?.body).toEqual({
      urls: ['https://a.example', 'nope', 'https://c.example', 'x'],
    });
    const cards = await screen.findAllByRole('article');
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
      'a.example',
      'c.example',
      'older.example',
    ]);
    expect(cards[0]?.textContent).toContain('pending');
    expect(screen.getByText('already in your library, moved to top')).toBeTruthy();
    expect(screen.getByText('nope: not a valid web address')).toBeTruthy();
    expect(screen.getByText('library full (20,000 links)')).toBeTruthy();
    expect((input as HTMLTextAreaElement).value).toBe('');
  });
});

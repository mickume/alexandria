import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Link } from '../api';
import { FakeApi, makeLink, renderPage } from '../test/helpers';

function link(host: string, extra: Partial<Link> = {}): Link {
  return makeLink({ id: `id-${host}`, host, last_used_at: '2026-06-01T00:00:00.000Z', ...extra });
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
            { url: 'https://-bad-.example', error: 'invalid_url' },
            { url: 'https://x.example', error: 'library_full' },
          ],
        },
      });
    renderPage('/', api);
    await screen.findByRole('article', { name: 'older.example' });

    const input = screen.getByLabelText('Add links');
    fireEvent.change(input, {
      target: {
        value: 'https://a.example\nhttps://-bad-.example\nhttps://c.example\nhttps://x.example',
      },
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    const batches = api.sent('POST', '/api/v1/links/batch');
    expect(batches).toHaveLength(1);
    expect(batches[0]?.body).toEqual({
      urls: [
        'https://a.example',
        'https://-bad-.example',
        'https://c.example',
        'https://x.example',
      ],
    });
    const cards = await screen.findAllByRole('article');
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
      'a.example',
      'c.example',
      'older.example',
    ]);
    expect(cards[0]?.textContent).toContain('pending');
    expect(screen.getByText('already in your library, moved to top')).toBeTruthy();
    expect(screen.getByText('https://-bad-.example: not a valid web address')).toBeTruthy();
    expect(screen.getByText('library full (20,000 links)')).toBeTruthy();
    expect((input as HTMLTextAreaElement).value).toBe('');
  });

  it('reads a paste line by line as an import file is read, sending only web addresses', async () => {
    const api = new FakeApi()
      .on('GET', '/api/v1/links', { status: 200, body: { items: [], next_cursor: null } })
      .on('POST', '/api/v1/links/batch', {
        status: 200,
        body: { added: [], boosted: [], invalid: [] },
      });
    renderPage('/', api);
    const input = await screen.findByLabelText('Add links');
    const paste = [
      'Things to read this week',
      '# https://skipped.example',
      '- [Docs](https://a.example/docs).',
      'see https://b.example/x and https://ignored.example',
      'example.com',
      '<https://c.example>\r',
    ].join('\n');
    fireEvent.change(input, { target: { value: paste } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(api.sent('POST', '/api/v1/links/batch')[0]?.body).toEqual({
      urls: ['https://a.example/docs', 'https://b.example/x', 'https://c.example'],
    });
  });

  it('says a paste holds no web address, sends nothing and keeps the text', async () => {
    const api = new FakeApi().on('GET', '/api/v1/links', {
      status: 200,
      body: { items: [], next_cursor: null },
    });
    renderPage('/', api);
    const input = await screen.findByLabelText('Add links');
    fireEvent.change(input, { target: { value: 'example.com and some words' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(api.sent('POST', '/api/v1/links/batch')).toHaveLength(0);
    expect(screen.getByText('no http:// or https:// address found')).toBeTruthy();
    expect((input as HTMLTextAreaElement).value).toBe('example.com and some words');
  });
});

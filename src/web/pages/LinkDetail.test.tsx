import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, makeLink, renderPage } from '../test/helpers';

describe('the link detail page', () => {
  it('shows both URLs, the added date, the use count and every use', async () => {
    const api = new FakeApi()
      .on('GET', '/api/v1/links/abc', {
        status: 200,
        body: makeLink({
          id: 'abc',
          url: 'https://example.com/a',
          original_url: 'https://example.com/a?utm_source=x',
          host: 'example.com',
          title: 'example.com',
          added_at: '2026-03-04T10:00:00.000Z',
          last_used_at: '2026-03-07T10:00:00.000Z',
          use_count: 2,
        }),
      })
      .on('GET', '/api/v1/links/abc/history', {
        status: 200,
        body: {
          items: [
            { kind: 'use', at: '2026-03-07T10:00:00.000Z' },
            { kind: 'use', at: '2026-03-06T10:00:00.000Z' },
          ],
          next_cursor: null,
        },
      });
    renderPage('/links/abc', api);
    expect(await screen.findByText('https://example.com/a?utm_source=x')).toBeTruthy();
    expect(screen.getByText('https://example.com/a')).toBeTruthy();
    expect(screen.getByText(/Added 4 Mar 2026/)).toBeTruthy();
    expect(screen.getByText('used 2 times')).toBeTruthy();
    const history = await screen.findByRole('list', { name: 'History' });
    const rows = within(history).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['Opened · 7 Mar 2026', 'Opened · 6 Mar 2026']);
  });
});

describe('the detail page of a fetched link', () => {
  it('shows what the fetch found and every fetch beside the uses', async () => {
    const api = new FakeApi()
      .on('GET', '/api/v1/links/abc', {
        status: 200,
        body: makeLink({
          id: 'abc',
          title: 'An Article',
          state: 'active',
          final_url: 'https://news.example/articles/a',
          http_status: 200,
          fetched_at: '2026-09-01T10:10:00.000Z',
          notes: ['truncated'],
          has_snapshot: true,
          content_kind: 'html',
        }),
      })
      .on('GET', '/api/v1/links/abc/history', {
        status: 200,
        body: {
          items: [
            { kind: 'use', at: '2026-09-01T11:00:00.000Z' },
            {
              kind: 'fetch',
              at: '2026-09-01T10:10:00.000Z',
              outcome: 'ok',
              http_status: 200,
              reason: null,
            },
            {
              kind: 'fetch',
              at: '2026-09-01T10:00:00.000Z',
              outcome: 'failed',
              http_status: 503,
              reason: 'HTTP 503',
            },
          ],
          next_cursor: null,
        },
      });
    renderPage('/links/abc', api);
    expect(await screen.findByText('https://news.example/articles/a')).toBeTruthy();
    expect(screen.getByText('HTTP 200')).toBeTruthy();
    expect(screen.getByText(/fetched 1 Sept? 2026/)).toBeTruthy();
    expect(screen.getByText('truncated')).toBeTruthy();
    const rows = within(await screen.findByRole('list', { name: 'History' })).getAllByRole(
      'listitem',
    );
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^Opened/),
      expect.stringMatching(/^Fetched/),
      expect.stringMatching(/^Fetch failed: HTTP 503/),
    ]);
  });
});

describe('editing a link on its detail page', () => {
  function detailApi(): FakeApi {
    let current = makeLink({
      id: 'abc',
      title: 'An Article',
      state: 'active',
      summary: 'Auto summary.',
      tags: ['auto'],
      topic: 'Auto',
    });
    return new FakeApi()
      .on('GET', '/api/v1/links/abc', () => ({ status: 200, body: current }))
      .on('GET', '/api/v1/links/abc/history', {
        status: 200,
        body: { items: [], next_cursor: null },
      })
      .on('PATCH', '/api/v1/links/abc', (req) => {
        const body = req.body as Record<string, unknown>;
        current = {
          ...current,
          ...body,
          edited_fields: [...current.edited_fields, ...Object.keys(body)],
        } as typeof current;
        return { status: 200, body: current };
      });
  }

  it('sends only the changed field and marks it as edited', async () => {
    const api = detailApi();
    renderPage('/links/abc', api);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit topic' }));
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'Rust' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    const patches = api.sent('PATCH', '/api/v1/links/abc');
    expect(patches).toHaveLength(1);
    expect(patches[0]?.body).toEqual({ topic: 'Rust' });
    const topic = await screen.findByTestId('field-topic');
    expect(topic.textContent).toContain('Rust');
    expect(within(topic).getByText('edited')).toBeTruthy();
  });

  it('shows a refusal beside the field', async () => {
    const api = detailApi().on('PATCH', '/api/v1/links/abc', {
      status: 400,
      body: { error: 'invalid_topic', field: 'topic', message: 'a topic of 1 to 100 characters' },
    });
    renderPage('/links/abc', api);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit topic' }));
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: '' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    const topic = screen.getByTestId('field-topic');
    expect(within(topic).getByText('a topic of 1 to 100 characters')).toBeTruthy();
  });
});

import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, renderPage } from '../test/helpers';

const tags = [
  { id: 'g1', name: 'cloudflare', count: 4, newest_added_at: '2026-03-02T00:00:00.000Z' },
  { id: 'g2', name: 'javascript', count: 2, newest_added_at: '2026-03-01T00:00:00.000Z' },
];

function rows(): string[][] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .slice(0, 2)
        .map((cell) => cell.textContent ?? ''),
    );
}

describe('the Tags page', () => {
  it('lists every tag with its count in order, each opening its search', async () => {
    const api = new FakeApi().on('GET', '/api/v1/tags', {
      status: 200,
      body: { items: tags, next_cursor: null },
    });
    renderPage('/tags', api);
    expect(await screen.findByRole('heading', { name: 'Tags' })).toBeTruthy();
    await screen.findByRole('link', { name: 'cloudflare' });
    expect(rows()).toEqual([
      ['cloudflare', '4'],
      ['javascript', '2'],
    ]);
    await act(async () => screen.getByRole('link', { name: 'cloudflare' }).click());
    expect(window.location.pathname + window.location.search).toBe('/search?q=tag%3Acloudflare');
    await act(async () => undefined);
    expect(api.sent('GET', '/api/v1/search').map((r) => r.path)).toEqual([
      '/api/v1/search?q=tag%3Acloudflare',
    ]);
  });

  it('says so when there are no tags yet', async () => {
    const api = new FakeApi().on('GET', '/api/v1/tags', {
      status: 200,
      body: { items: [], next_cursor: null },
    });
    renderPage('/tags', api);
    expect(await screen.findByText('No tags yet.')).toBeTruthy();
  });

  it('renames a tag, showing why a rename was refused', async () => {
    let names = ['cloudflare', 'javascript'];
    const api = new FakeApi()
      .on('GET', '/api/v1/tags', () => ({
        status: 200,
        body: { items: tags.map((t, i) => ({ ...t, name: names[i] })), next_cursor: null },
      }))
      .on('PATCH', '/api/v1/tags/:id', (req) => {
        const name = (req.body as { name: string }).name;
        if (name === 'javascript') {
          return {
            status: 409,
            body: {
              error: 'name_taken',
              message: 'another tag is named javascript: merge this tag into it instead',
            },
          };
        }
        names = [name, names[1]!];
        return { status: 200, body: { id: 'g1', name, count: 4 } };
      });
    renderPage('/tags', api);
    const row = (await screen.findByRole('link', { name: 'cloudflare' })).closest('tr')!;
    await act(async () => within(row).getByRole('button', { name: 'Rename' }).click());
    const input = within(row).getByRole('textbox', { name: 'New name' });
    fireEvent.change(input, { target: { value: 'javascript' } });
    await act(async () => within(row).getByRole('button', { name: 'Save' }).click());
    expect((await screen.findByRole('alert')).textContent).toContain('merge this tag into it');
    fireEvent.change(input, { target: { value: 'cf' } });
    await act(async () => within(row).getByRole('button', { name: 'Save' }).click());
    expect(api.sent('PATCH', '/api/v1/tags/g1').at(-1)?.body).toEqual({ name: 'cf' });
    expect(await screen.findByRole('link', { name: 'cf' })).toBeTruthy();
  });

  it('merges a tag into another chosen from the list', async () => {
    let items = tags;
    const api = new FakeApi()
      .on('GET', '/api/v1/tags', () => ({ status: 200, body: { items, next_cursor: null } }))
      .on('POST', '/api/v1/tags/:id/merge', () => {
        items = [{ ...tags[1]!, count: 6 }];
        return { status: 200, body: { id: 'g2', name: 'javascript', count: 6 } };
      });
    renderPage('/tags', api);
    const row = (await screen.findByRole('link', { name: 'cloudflare' })).closest('tr')!;
    await act(async () => within(row).getByRole('button', { name: 'Merge' }).click());
    const select = within(row).getByRole('combobox', { name: 'Merge into' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['javascript']);
    fireEvent.change(select, { target: { value: 'g2' } });
    await act(async () => within(row).getByRole('button', { name: 'Merge into it' }).click());
    expect(api.sent('POST', '/api/v1/tags/g1/merge')[0]?.body).toEqual({ into: 'g2' });
    await screen.findByText('6');
    expect(rows()).toEqual([['javascript', '6']]);
  });
});

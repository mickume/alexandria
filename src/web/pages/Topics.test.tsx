import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, renderPage } from '../test/helpers';

const N = '2026-03-01T00:00:00.000Z';
const topics = [
  {
    id: 't1',
    name: 'web development',
    parent_id: null,
    count: 3,
    subtree_count: 3,
    newest_added_at: N,
  },
  { id: 't5', name: 'Pulsars', parent_id: 't4', count: 1, subtree_count: 1, newest_added_at: N },
  { id: 't2', name: 'cooking', parent_id: null, count: 1, subtree_count: 1, newest_added_at: N },
  { id: 't4', name: 'Stars', parent_id: 't3', count: 1, subtree_count: 2, newest_added_at: N },
  { id: 't3', name: 'Astronomy', parent_id: null, count: 0, subtree_count: 2, newest_added_at: N },
];

const listed = { status: 200, body: { items: topics, next_cursor: null } };

/** The rows of the list, each as [name, count]. */
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

describe('the Topics page', () => {
  it('lists the topics as a tree, each with its subtree count, opening its search', async () => {
    const api = new FakeApi().on('GET', '/api/v1/topics', listed);
    renderPage('/topics', api);
    expect(await screen.findByRole('heading', { name: 'Topics' })).toBeTruthy();
    await screen.findByRole('link', { name: 'web development' });
    expect(rows()).toEqual([
      ['Astronomy', '2'],
      ['Stars', '2'],
      ['Pulsars', '1'],
      ['cooking', '1'],
      ['web development', '3'],
    ]);
    expect(
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.getAttribute('data-level')),
    ).toEqual(['1', '2', '3', '1', '1']);
    await act(async () => screen.getByRole('link', { name: 'Stars' }).click());
    expect(window.location.pathname + window.location.search).toBe('/search?q=topic%3AStars');
    await act(async () => undefined);
    expect(api.sent('GET', '/api/v1/search').map((r) => r.path)).toEqual([
      '/api/v1/search?q=topic%3AStars',
    ]);
  });

  it('offers to move a topic under any topic outside its subtree, or to the top level', async () => {
    const api = new FakeApi().on('GET', '/api/v1/topics', listed);
    renderPage('/topics', api);
    const row = (await screen.findByRole('link', { name: 'Stars' })).closest('tr')!;
    await act(async () => within(row).getByRole('button', { name: 'Move under…' }).click());
    const select = within(row).getByRole('combobox', { name: 'Move under' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Top level', 'Astronomy', 'cooking', 'web development']);
    expect(within(row).getByRole('button', { name: 'Move' })).toBeTruthy();
  });

  it.each([
    { choice: 't2', parent: 't2' },
    { choice: '', parent: null },
  ])(
    'moves a topic under the choice $choice and loads the tree again',
    async ({ choice, parent }) => {
      const api = new FakeApi()
        .on('GET', '/api/v1/topics', listed)
        .on('POST', '/api/v1/topics/:id/move', {
          status: 200,
          body: { id: 't4', name: 'Stars', parent_id: parent, count: 1, subtree_count: 2 },
        });
      renderPage('/topics', api);
      const row = (await screen.findByRole('link', { name: 'Stars' })).closest('tr')!;
      await act(async () => within(row).getByRole('button', { name: 'Move under…' }).click());
      fireEvent.change(within(row).getByRole('combobox', { name: 'Move under' }), {
        target: { value: choice },
      });
      await act(async () => within(row).getByRole('button', { name: 'Move' }).click());
      expect(api.sent('POST', '/api/v1/topics/t4/move').map((r) => r.body)).toEqual([{ parent }]);
      expect(api.sent('GET', '/api/v1/topics')).toHaveLength(2);
    },
  );

  it('shows why a move was refused, and leaves the tree as it was', async () => {
    const api = new FakeApi()
      .on('GET', '/api/v1/topics', listed)
      .on('POST', '/api/v1/topics/:id/move', {
        status: 409,
        body: { error: 'too_deep', message: 'topics are at most three levels deep' },
      });
    renderPage('/topics', api);
    const row = (await screen.findByRole('link', { name: 'Astronomy' })).closest('tr')!;
    const before = rows();
    await act(async () => within(row).getByRole('button', { name: 'Move under…' }).click());
    fireEvent.change(within(row).getByRole('combobox', { name: 'Move under' }), {
      target: { value: 't2' },
    });
    await act(async () => within(row).getByRole('button', { name: 'Move' }).click());
    expect((await screen.findByRole('alert')).textContent).toContain(
      'topics are at most three levels deep',
    );
    expect(rows()).toEqual(before);
  });

  it('follows the cursor until every topic is listed', async () => {
    const api = new FakeApi().on('GET', '/api/v1/topics', (req) =>
      req.path.includes('cursor=c2')
        ? { status: 200, body: { items: [topics[2]], next_cursor: null } }
        : { status: 200, body: { items: [topics[0]], next_cursor: 'c2' } },
    );
    renderPage('/topics', api);
    await screen.findByRole('link', { name: 'cooking' });
    expect(rows().map(([name]) => name)).toEqual(['cooking', 'web development']);
  });

  it('offers the other topics to merge into by name', async () => {
    const api = new FakeApi().on('GET', '/api/v1/topics', listed);
    renderPage('/topics', api);
    const row = (await screen.findByRole('link', { name: 'cooking' })).closest('tr')!;
    await act(async () => within(row).getByRole('button', { name: 'Merge' }).click());
    const select = within(row).getByRole('combobox', { name: 'Merge into' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Astronomy', 'Pulsars', 'Stars', 'web development']);
    expect(select).toHaveProperty('value', 't3');
  });

  describe('splitting a topic', () => {
    const tree = [
      {
        id: 's1',
        name: 'Software engineering',
        parent_id: null,
        count: 25,
        subtree_count: 44,
        newest_added_at: N,
      },
      {
        id: 's2',
        name: 'Testing',
        parent_id: 's1',
        count: 19,
        subtree_count: 19,
        newest_added_at: N,
      },
      {
        id: 's3',
        name: 'Cooking',
        parent_id: null,
        count: 20,
        subtree_count: 20,
        newest_added_at: N,
      },
    ];
    const answered = {
      status: 200,
      body: {
        topic: {
          id: 's1',
          name: 'Software engineering',
          parent_id: null,
          count: 5,
          subtree_count: 44,
        },
        children: [{ id: 's2', name: 'Testing', count: 39 }],
        moved: 20,
      },
    };
    const row = async (name: string) => (await screen.findByRole('link', { name })).closest('tr')!;

    it('is offered on a topic with at least 20 links of its own, and no other', async () => {
      renderPage(
        '/topics',
        new FakeApi().on('GET', '/api/v1/topics', {
          status: 200,
          body: { items: tree, next_cursor: null },
        }),
      );
      expect(
        within(await row('Software engineering')).queryByRole('button', { name: 'Split' }),
      ).not.toBeNull();
      expect(within(await row('Cooking')).queryByRole('button', { name: 'Split' })).not.toBeNull();
      expect(within(await row('Testing')).queryByRole('button', { name: 'Split' })).toBeNull();
    });

    it('shows Splitting… with the row’s actions disabled until the answer, then loads the tree again', async () => {
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      const api = new FakeApi()
        .on('GET', '/api/v1/topics', { status: 200, body: { items: tree, next_cursor: null } })
        .on('POST', '/api/v1/topics/:id/split', async () => {
          await held;
          return answered;
        });
      renderPage('/topics', api);
      const se = await row('Software engineering');
      await act(async () => within(se).getByRole('button', { name: 'Split' }).click());
      expect(within(se).getByText('Splitting…')).toBeTruthy();
      for (const name of ['Rename', 'Merge', 'Move under…', 'Split']) {
        expect(within(se).getByRole('button', { name })).toHaveProperty('disabled', true);
      }
      await act(async () => {
        release();
        await held;
      });
      await act(async () => undefined);
      expect(api.sent('POST', '/api/v1/topics/s1/split')).toHaveLength(1);
      expect(api.sent('GET', '/api/v1/topics')).toHaveLength(2);
      expect(within(await row('Software engineering')).queryByText('Splitting…')).toBeNull();
    });

    it('shows why a split failed, and gives the row its actions back', async () => {
      const api = new FakeApi()
        .on('GET', '/api/v1/topics', { status: 200, body: { items: tree, next_cursor: null } })
        .on('POST', '/api/v1/topics/:id/split', {
          status: 409,
          body: { error: 'no_ai_key', message: 'add an AI key in settings' },
        });
      renderPage('/topics', api);
      const se = await row('Software engineering');
      const before = rows();
      await act(async () => within(se).getByRole('button', { name: 'Split' }).click());
      expect((await screen.findByRole('alert')).textContent).toContain('add an AI key in settings');
      expect(rows()).toEqual(before);
      expect(within(se).getByRole('button', { name: 'Split' })).toHaveProperty('disabled', false);
    });
  });

  it('is reached from the navigation', async () => {
    renderPage('/', new FakeApi());
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('link', { name: 'Topics' }).getAttribute('href')).toBe('/topics');
    expect(within(nav).getByRole('link', { name: 'Tags' }).getAttribute('href')).toBe('/tags');
  });
});

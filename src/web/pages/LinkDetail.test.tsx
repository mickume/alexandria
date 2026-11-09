import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Link } from '../api';
import { FakeApi, makeLink, renderPage } from '../test/helpers';

describe('the link detail page', () => {
  it('shows the added date, the use count, every use, and after them both URLs under Technical details', async () => {
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
    const details = await screen.findByRole('region', { name: 'Technical details' });
    expect(within(details).getByText('https://example.com/a?utm_source=x')).toBeTruthy();
    expect(within(details).getByText('https://example.com/a')).toBeTruthy();
    expect(screen.getByText(/Added 4 Mar 2026/)).toBeTruthy();
    expect(screen.getByText('used 2 times')).toBeTruthy();
    const history = await screen.findByRole('list', { name: 'History' });
    const rows = within(history).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['Opened · 7 Mar 2026', 'Opened · 6 Mar 2026']);
    expect(
      history.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('the detail page’s related links', () => {
  const page = (related: { status: number; body: unknown }) =>
    new FakeApi()
      .on('GET', '/api/v1/links/abc', { status: 200, body: makeLink({ id: 'abc' }) })
      .on('GET', '/api/v1/links/abc/history', {
        status: 200,
        body: { items: [], next_cursor: null },
      })
      .on('GET', '/api/v1/links/abc/related', related);

  it('lists them between the summary and the history, each opening its own page', async () => {
    const near = makeLink({ id: 'near', title: 'Near in meaning', host: 'near.example' });
    renderPage('/links/abc', page({ status: 200, body: { items: [{ ...near, score: 0.8 }] } }));
    const list = await screen.findByRole('list', { name: 'Related links' });
    const a = within(list).getByRole('link', { name: 'Near in meaning' });
    expect(a.getAttribute('href')).toBe('/links/near');
    expect(within(list).getByText('near.example')).toBeTruthy();
    const history = screen.getByRole('list', { name: 'History' });
    expect(list.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    {
      label: 'says so when there are none',
      answer: { status: 200, body: { items: [] } },
      text: 'Nothing in your library is near this link yet.',
    },
    {
      label: 'says so when they cannot be worked out',
      answer: { status: 503, body: { error: 'search_unavailable', message: 'x' } },
      text: 'Related links can’t be worked out right now.',
    },
  ])('$label', async ({ answer, text }) => {
    renderPage('/links/abc', page(answer));
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Related links' })).toBeTruthy();
  });

  it('says it is looking for them while they load', async () => {
    const api = new FakeApi()
      .on('GET', '/api/v1/links/abc', { status: 200, body: makeLink({ id: 'abc' }) })
      .on('GET', '/api/v1/links/abc/history', {
        status: 200,
        body: { items: [], next_cursor: null },
      })
      .on('GET', '/api/v1/links/abc/related', () => new Promise(() => undefined));
    renderPage('/links/abc', api);
    expect(await screen.findByText('Looking for related links…')).toBeTruthy();
  });
});

describe('the detail page’s days left', () => {
  const DAY = 86_400_000;
  it.each([
    { label: 'an active link', fields: { points: 12 }, text: '12 days left' },
    { label: 'a link with one point', fields: { points: 1 }, text: '1 day left' },
    { label: 'a link out of points', fields: { points: -2 }, text: 'expires today' },
    {
      label: 'a pinned link',
      fields: { points: 5, pinned: true, pin_position: 1 },
      text: 'never expires: pinned',
    },
    {
      label: 'a link in a workspace',
      fields: { points: 5, workspaces: [{ id: 'w', name: 'W' }] },
      text: 'never expires: in a workspace',
    },
    {
      label: 'an expired link',
      fields: {
        state: 'expired' as const,
        points: -40,
        expired_at: new Date(Date.now() - 20 * DAY).toISOString(),
        removal_at: new Date(Date.now() + 10 * DAY).toISOString(),
      },
      text: 'expired: removed in 10 days',
    },
    {
      label: 'an archived link',
      fields: { state: 'archived' as const, points: null },
      text: 'never expires: archived',
    },
  ])('shows them for $label', async ({ fields, text }) => {
    renderPage(
      '/links/abc',
      new FakeApi()
        .on('GET', '/api/v1/links/abc', { status: 200, body: makeLink({ id: 'abc', ...fields }) })
        .on('GET', '/api/v1/links/abc/history', {
          status: 200,
          body: { items: [], next_cursor: null },
        })
        .on('GET', '/api/v1/links/abc/related', { status: 200, body: { items: [] } }),
    );
    expect(await screen.findByText(text)).toBeTruthy();
  });
});

describe('the detail page’s headline', () => {
  it('opens the site in a new tab, as the stream’s cards do', async () => {
    const api = new FakeApi()
      .on('GET', '/api/v1/links/abc', {
        status: 200,
        body: makeLink({ id: 'abc', title: 'An Article' }),
      })
      .on('GET', '/api/v1/links/abc/history', {
        status: 200,
        body: { items: [], next_cursor: null },
      });
    renderPage('/links/abc', api);
    const heading = await screen.findByRole('heading', { level: 1, name: 'An Article' });
    const a = within(heading).getByRole('link', { name: 'An Article' });
    expect(a.getAttribute('href')).toBe('/api/v1/links/abc/open');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
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

describe('the topic and tags of a link on its detail page', () => {
  it.each([
    { label: 'topic', name: 'Machine learning', search: 'topic:"Machine learning"' },
    { label: 'tag', name: 'wasm', search: 'tag:wasm' },
  ])('open the search for the links of the $label when clicked', async ({ name, search }) => {
    const link = makeLink({ id: 'abc', tags: ['rust', 'wasm'], topic: 'Machine learning' });
    renderPage(
      '/links/abc',
      new FakeApi().on('GET', '/api/v1/links/abc', { status: 200, body: link }),
    );

    fireEvent.click(await screen.findByRole('link', { name }));

    expect(window.location.pathname + window.location.search).toBe(
      `/search?q=${encodeURIComponent(search)}`,
    );
  });

  it('say none when the link has no topic or tags', async () => {
    const link = makeLink({ id: 'abc', tags: [], topic: null });
    renderPage(
      '/links/abc',
      new FakeApi().on('GET', '/api/v1/links/abc', { status: 200, body: link }),
    );

    for (const field of ['field-tags', 'field-topic']) {
      expect(within(await screen.findByTestId(field)).getByText('none')).toBeTruthy();
    }
  });
});

describe('the note of a link on its detail page', () => {
  function noteApi(): FakeApi {
    let current = makeLink({
      id: 'abc',
      title: 'Noted',
      state: 'active',
      note: '**read** first',
      workspaces: [{ id: 'wa', name: 'A' }],
    });
    return new FakeApi()
      .on('GET', '/api/v1/links/abc', () => ({ status: 200, body: current }))
      .on('GET', '/api/v1/links/abc/history', {
        status: 200,
        body: { items: [], next_cursor: null },
      })
      .on('PATCH', '/api/v1/links/abc', (req) => {
        current = { ...current, ...(req.body as object) };
        return { status: 200, body: current };
      });
  }

  it('shows the rendered note and the workspaces, and saves an edit', async () => {
    const api = noteApi();
    const { container } = renderPage('/links/abc', api);
    expect((await screen.findByText('read')).tagName).toBe('STRONG');
    const chip = [...container.querySelectorAll('a')].find(
      (a) => a.getAttribute('href') === '/workspaces/wa',
    );
    expect(chip?.textContent).toBe('A');
    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: '*new* text' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    });
    expect(api.sent('PATCH', '/api/v1/links/abc')[0]?.body).toEqual({ note: '*new* text' });
    expect((await screen.findByText('new')).tagName).toBe('EM');
  });

  it('keeps the editor open with the text when the note is too long', async () => {
    const api = noteApi().on('PATCH', '/api/v1/links/abc', {
      status: 400,
      body: { error: 'note_too_long', field: 'note', message: 'note too long (20,000 characters)' },
    });
    renderPage('/links/abc', api);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit note' }));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'too much' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    });
    expect(await screen.findByText('note too long (20,000 characters)')).toBeTruthy();
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('too much');
  });
});

describe('checking a link from its detail page', () => {
  function checkApi(answer: { status: number; body: unknown }): FakeApi {
    const link = makeLink({ id: 'abc', title: 'Checked', state: 'active' });
    return new FakeApi()
      .on('GET', '/api/v1/links/abc', { status: 200, body: link })
      .on('GET', '/api/v1/links/abc/history', {
        status: 200,
        body: { items: [], next_cursor: null },
      })
      .on('POST', '/api/v1/links/abc/check', answer);
  }

  it.each([
    {
      label: 'a pass',
      answer: {
        status: 200,
        body: {
          passed: true,
          result: 'HTTP 200',
          checked_at: new Date().toISOString(),
          link: makeLink({ id: 'abc' }),
        },
      },
      text: 'Reachable (HTTP 200), checked just now',
    },
    {
      label: 'a failure',
      answer: {
        status: 200,
        body: {
          passed: false,
          result: 'could not connect',
          checked_at: new Date().toISOString(),
          link: makeLink({ id: 'abc' }),
        },
      },
      text: 'Not reachable (could not connect), checked just now',
    },
    {
      label: 'a refusal',
      answer: {
        status: 429,
        body: { error: 'checked_recently', message: 'already checked recently' },
      },
      text: 'already checked recently',
    },
  ])('shows $label', async ({ answer, text }) => {
    const api = checkApi(answer);
    renderPage('/links/abc', api);
    const button = await screen.findByRole('button', { name: 'Check now' });
    await act(async () => button.click());
    expect(api.sent('POST', '/api/v1/links/abc/check')).toHaveLength(1);
    expect(await screen.findByText(text)).toBeTruthy();
  });
});

describe('the side column of a link’s detail page', () => {
  afterEach(() => vi.restoreAllMocks());

  /** A fake API for a link in workspace A, with workspaces A and B, that pins, unpins, removes and deletes. */
  function sideApi(fields: Partial<Link> = {}): FakeApi {
    let current = makeLink({
      id: 'abc',
      title: 'Alarms',
      tags: ['rust'],
      topic: 'Programming',
      workspaces: [{ id: 'wa', name: 'A' }],
      ...fields,
    });
    const workspace = (id: string, name: string) => ({
      id,
      name,
      description: '',
      link_count: 1,
      created_at: '2026-03-01T00:00:00.000Z',
    });
    return new FakeApi()
      .on('GET', '/api/v1/links/abc', () => ({ status: 200, body: current }))
      .on('GET', '/api/v1/links/abc/history', {
        status: 200,
        body: { items: [], next_cursor: null },
      })
      .on('GET', '/api/v1/links', { status: 200, body: { items: [], next_cursor: null } })
      .on('POST', '/api/v1/links/abc/pin', () => {
        current = { ...current, pinned: true };
        return { status: 200, body: current };
      })
      .on('DELETE', '/api/v1/links/abc/pin', () => {
        current = { ...current, pinned: false };
        return { status: 200, body: current };
      })
      .on('POST', '/api/v1/links/abc/archive', () => {
        current = { ...current, state: 'archived', points: null, pinned: false };
        return { status: 200, body: current };
      })
      .on('POST', '/api/v1/links/abc/unarchive', () => {
        current = { ...current, state: 'active', points: 60 };
        return { status: 200, body: current };
      })
      .on('GET', '/api/v1/workspaces', {
        status: 200,
        body: { items: [workspace('wa', 'A'), workspace('wb', 'B')], next_cursor: null },
      })
      .on('POST', '/api/v1/workspaces/wb/links', { status: 201, body: { position: 1 } })
      .on('DELETE', '/api/v1/workspaces/wa/links/abc', { status: 204 })
      .on('DELETE', '/api/v1/links/abc', { status: 204 });
  }

  const side = async () =>
    within(await screen.findByRole('complementary', { name: 'About this link' }));

  it('holds the tags, topic and workspaces, then the actions', async () => {
    renderPage('/links/abc', sideApi());
    const column = await side();

    expect(column.getByRole('link', { name: 'rust' })).toBeTruthy();
    expect(column.getByRole('link', { name: 'Programming' })).toBeTruthy();
    expect(column.getByRole('link', { name: 'A' }).getAttribute('href')).toBe('/workspaces/wa');
    const actions = within(column.getByRole('group', { name: 'Actions' }));
    expect(actions.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Refresh',
      'Check now',
      'Pin',
      'Add to workspace',
      'Archive',
      'Delete',
    ]);
  });

  it('archives the link, offering Unarchive in place of Pin, and unarchives it again', async () => {
    const api = sideApi();
    renderPage('/links/abc', api);
    const column = await side();

    fireEvent.click(column.getByRole('button', { name: 'Archive' }));
    await column.findByRole('button', { name: 'Unarchive' });
    const actions = within(column.getByRole('group', { name: 'Actions' }));
    expect(actions.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Refresh',
      'Check now',
      'Unarchive',
      'Add to workspace',
      'Delete',
    ]);
    expect(api.sent('POST', '/api/v1/links/abc/archive')).toHaveLength(1);

    fireEvent.click(column.getByRole('button', { name: 'Unarchive' }));
    await column.findByRole('button', { name: 'Archive' });
    expect(column.getByRole('button', { name: 'Pin' })).toBeTruthy();
    expect(column.queryByRole('button', { name: 'Unarchive' })).toBeNull();
    expect(api.sent('POST', '/api/v1/links/abc/unarchive')).toHaveLength(1);
  });

  it('pins the link and unpins it again', async () => {
    const api = sideApi();
    renderPage('/links/abc', api);
    const column = await side();

    fireEvent.click(column.getByRole('button', { name: 'Pin' }));
    fireEvent.click(await column.findByRole('button', { name: 'Unpin' }));

    await column.findByRole('button', { name: 'Pin' });
    expect(api.sent('POST', '/api/v1/links/abc/pin')).toHaveLength(1);
    expect(api.sent('DELETE', '/api/v1/links/abc/pin')).toHaveLength(1);
  });

  it('adds the link to a workspace and removes it from one', async () => {
    const api = sideApi();
    renderPage('/links/abc', api);
    const column = await side();

    fireEvent.click(column.getByRole('button', { name: 'Add to workspace' }));
    fireEvent.click(await column.findByRole('menuitemcheckbox', { name: 'B' }));
    await column.findByRole('link', { name: 'B' });
    fireEvent.click(column.getByRole('button', { name: 'Remove from A' }));

    await waitFor(() => expect(column.queryByRole('link', { name: 'A' })).toBeNull());
    expect(api.sent('POST', '/api/v1/workspaces/wb/links').map((r) => r.body)).toEqual([
      { link_id: 'abc' },
    ]);
    expect(api.sent('DELETE', '/api/v1/workspaces/wa/links/abc')).toHaveLength(1);
    expect(column.getByRole('link', { name: 'B' })).toBeTruthy();
  });

  it.each([
    { confirmed: false, deletes: 0, path: '/links/abc' },
    { confirmed: true, deletes: 1, path: '/' },
  ])(
    'deletes the link and goes to the stream only when confirmed ($confirmed)',
    async ({ confirmed, deletes, path }) => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(confirmed);
      const api = sideApi();
      renderPage('/links/abc', api);
      const column = await side();

      fireEvent.click(column.getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(window.location.pathname).toBe(path));
      expect(confirm).toHaveBeenCalledOnce();
      expect(api.sent('DELETE', '/api/v1/links/abc')).toHaveLength(deletes);
    },
  );
});

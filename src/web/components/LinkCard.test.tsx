import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Link } from '../api';
import { FakeApi, installFakeApi, makeLink } from '../test/helpers';
import { LinkCard } from './LinkCard';

const link: Link = makeLink({
  id: 'abc',
  url: 'https://example.com/a',
  original_url: 'https://example.com/a?utm_source=x',
  host: 'example.com',
  title: 'example.com',
});

const noop = () => undefined;

/** Opens the card's More actions menu, where the less frequent actions are. */
async function moreActions() {
  await act(async () => screen.getByRole('button', { name: 'More actions' }).click());
}

describe('a card’s links to the site', () => {
  it('open the site in a new tab from the title, the address and Open', () => {
    const l = makeLink({ id: 'abc', host: 'example.com', title: 'An Article' });
    render(<LinkCard link={l} actions={{ onPin: noop, onUnpin: noop, onDelete: noop }} />);
    for (const name of ['An Article', 'example.com', 'Open']) {
      const a = screen.getByRole('link', { name });
      expect(a.getAttribute('href'), name).toBe('/api/v1/links/abc/open');
      expect(a.getAttribute('target'), name).toBe('_blank');
      expect(a.getAttribute('rel'), name).toContain('noopener');
    }
  });
});

describe('a card’s More actions menu', () => {
  const stored = makeLink({ id: 'abc', state: 'active', has_snapshot: true, title: 'Stored' });
  const actions = { onPin: noop, onUnpin: noop, onDelete: noop };

  it('keeps Open, Read and Pin on the card and the rest behind it', async () => {
    render(<LinkCard link={stored} actions={actions} />);
    expect(screen.getByRole('link', { name: 'Open' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Read' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pin' })).toBeTruthy();
    const trigger = screen.getByRole('button', { name: 'More actions' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    for (const name of ['Refresh', 'Add to workspace', 'Delete']) {
      expect(screen.queryByRole('button', { name }), name).toBeNull();
    }
    expect(screen.queryByRole('link', { name: 'Details' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Snapshot' })).toBeNull();

    await moreActions();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    for (const name of ['Refresh', 'Add to workspace', 'Delete']) {
      expect(screen.getByRole('button', { name }), name).toBeTruthy();
    }
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Details' }).getAttribute('href')).toBe('/links/abc');
    expect(screen.getByRole('link', { name: 'Snapshot' }).getAttribute('href')).toBe(
      '/links/abc/snapshot',
    );
  });

  it('closes on Escape, giving the focus back to its button, and on a click elsewhere', async () => {
    render(<LinkCard link={stored} actions={actions} />);
    await moreActions();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Delete' }), { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More actions' }));

    await moreActions();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('closes once an action is chosen', async () => {
    let deleted = 0;
    render(<LinkCard link={stored} actions={{ ...actions, onDelete: () => (deleted += 1) }} />);
    await moreActions();
    await act(async () => screen.getByRole('button', { name: 'Delete' }).click());
    expect(deleted).toBe(1);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});

describe('refreshing from a card', () => {
  it('sends one refresh, shows the card as refreshing, and says when it was refreshed recently', async () => {
    const api = installFakeApi(
      new FakeApi().on('POST', '/api/v1/links/abc/refresh', {
        status: 202,
        body: { status: 'queued' },
      }),
    );
    const { unmount } = render(
      <LinkCard link={link} actions={{ onPin: noop, onUnpin: noop, onDelete: noop }} />,
    );
    await moreActions();
    await act(async () => screen.getByRole('button', { name: 'Refresh' }).click());
    expect(api.sent('POST', '/api/v1/links/abc/refresh')).toHaveLength(1);
    expect(screen.getByText('refreshing…')).toBeTruthy();
    unmount();

    installFakeApi(
      new FakeApi().on('POST', '/api/v1/links/abc/refresh', {
        status: 429,
        headers: { 'Retry-After': '360' },
        body: { error: 'refreshed_recently', message: 'already refreshed recently' },
      }),
    );
    render(<LinkCard link={link} actions={{ onPin: noop, onUnpin: noop, onDelete: noop }} />);
    await moreActions();
    await act(async () => screen.getByRole('button', { name: 'Refresh' }).click());
    expect(await screen.findByText('already refreshed recently')).toBeTruthy();
  });
});

describe('a card’s fetch results', () => {
  it.each([
    {
      label: 'a fetched article',
      link: makeLink({
        id: 'art',
        state: 'active',
        title: 'An Article',
        favicon_url: 'https://art.example/i.png',
        has_snapshot: true,
        content_kind: 'html',
      }),
      texts: ['An Article'],
      read: true,
      favicon: true,
    },
    {
      label: 'a pinned link, with a pin for its icon',
      link: makeLink({
        id: 'pin',
        state: 'active',
        pinned: true,
        pin_position: 1,
        favicon_url: 'https://art.example/i.png',
      }),
      texts: [],
      roles: ['Pinned'],
      read: false,
    },
    {
      label: 'an unreachable link',
      link: makeLink({ id: 'un', state: 'unreachable', state_reason: 'timed out' }),
      texts: ['unreachable: timed out'],
      read: false,
    },
    {
      label: 'something that is not a web page',
      link: makeLink({
        id: 'img',
        state: 'active',
        content_kind: 'other',
        notes: ['not a web page (image/png)'],
      }),
      texts: ['not a web page (image/png)'],
      read: false,
    },
    {
      label: 'a PDF without text',
      link: makeLink({
        id: 'pdf',
        state: 'active',
        content_kind: 'pdf',
        has_snapshot: true,
        notes: ['no text in this PDF'],
      }),
      texts: ['no text in this PDF'],
      read: true,
    },
  ])('shows $label as it is', async ({ link: l, texts, roles, read, favicon }) => {
    const { container } = render(
      <LinkCard link={l} actions={{ onPin: noop, onUnpin: noop, onDelete: noop }} />,
    );
    for (const text of texts) expect(screen.getByText(text)).toBeTruthy();
    for (const name of roles ?? []) expect(screen.getByRole('img', { name })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Read' }) !== null).toBe(read);
    await moreActions();
    expect(screen.queryByRole('link', { name: 'Snapshot' }) !== null).toBe(read);
    if (read) {
      expect(screen.getByRole('link', { name: 'Read' }).getAttribute('href')).toBe(
        `/links/${l.id}/read`,
      );
      expect(screen.getByRole('link', { name: 'Snapshot' }).getAttribute('href')).toBe(
        `/links/${l.id}/snapshot`,
      );
    }
    expect(container.querySelector('img.favicon') !== null).toBe(favicon === true);
  });
});

describe('an enriched card', () => {
  it('shows the summary in one line that expands, a chip per tag, and the topic', () => {
    const summary = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const l = makeLink({
      id: 'rich',
      state: 'active',
      summary,
      tags: ['rust', 'wasm', 'performance'],
      topic: 'Programming',
      enrichment_status: 'enriched',
    });
    render(<LinkCard link={l} actions={{ onPin: noop, onUnpin: noop, onDelete: noop }} />);
    const text = screen.getByText(summary);
    expect(text.classList.contains('clamped')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    expect(screen.getByText(summary).classList.contains('clamped')).toBe(false);
    const chips = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(chips).toEqual(['rust', 'wasm', 'performance']);
    expect(screen.getByText('Programming')).toBeTruthy();
  });

  it.each([
    { label: 'topic', name: 'Machine learning', search: 'topic:"Machine learning"' },
    { label: 'tag', name: 'wasm', search: 'tag:wasm' },
  ])(
    'opens the search for the links of its $label when the chip is clicked',
    ({ name, search }) => {
      const l = makeLink({ id: 'rich', tags: ['rust', 'wasm'], topic: 'Machine learning' });
      render(<LinkCard link={l} actions={{ onPin: noop, onUnpin: noop, onDelete: noop }} />);

      const chip = screen.getByRole('link', { name });
      expect(chip.getAttribute('href')).toBe(`/search?q=${encodeURIComponent(search)}`);
      fireEvent.click(chip);

      expect(window.location.pathname + window.location.search).toBe(
        `/search?q=${encodeURIComponent(search)}`,
      );
    },
  );
});

describe('a card whose enrichment failed', () => {
  it('says so and re-runs the enrichment on request', async () => {
    const api = installFakeApi(
      new FakeApi().on('POST', '/api/v1/links/bad/enrich', {
        status: 202,
        body: { status: 'queued' },
      }),
    );
    const l = makeLink({
      id: 'bad',
      state: 'active',
      enrichment_status: 'failed',
      enrichment_reason: 'internal error',
    });
    render(<LinkCard link={l} actions={{ onPin: noop, onUnpin: noop, onDelete: noop }} />);
    expect(screen.getByText('enrichment failed')).toBeTruthy();
    await act(async () => screen.getByRole('button', { name: 're-run enrichment' }).click());
    expect(api.sent('POST', '/api/v1/links/bad/enrich')).toHaveLength(1);
    expect(screen.getByText('queued for enrichment')).toBeTruthy();
  });
});

describe('adding a link to a workspace from its card', () => {
  it('offers the workspaces, marks those holding the link, and adds it to another', async () => {
    const api = installFakeApi(
      new FakeApi()
        .on('GET', '/api/v1/workspaces', {
          status: 200,
          body: {
            items: [
              {
                id: 'A',
                name: 'A',
                description: '',
                link_count: 1,
                created_at: '2026-01-01T00:00:00.000Z',
              },
              {
                id: 'b',
                name: 'b',
                description: '',
                link_count: 0,
                created_at: '2026-01-01T00:00:00.000Z',
              },
            ],
            next_cursor: null,
          },
        })
        .on('POST', '/api/v1/workspaces/b/links', {
          status: 201,
          body: { workspace_id: 'b', link_id: 'in-a', position: 1 },
        }),
    );
    const l = makeLink({ id: 'in-a', state: 'active', workspaces: [{ id: 'A', name: 'A' }] });
    render(<LinkCard link={l} actions={{ onPin: noop, onUnpin: noop, onDelete: noop }} />);
    await moreActions();
    await act(async () => screen.getByRole('button', { name: 'Add to workspace' }).click());
    const a = await screen.findByRole('menuitemcheckbox', { name: 'A' });
    expect(a.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'b' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    await act(async () => screen.getByRole('menuitemcheckbox', { name: 'b' }).click());
    expect(api.sent('POST', '/api/v1/workspaces/b/links')).toHaveLength(1);
    expect(api.sent('POST', '/api/v1/workspaces/b/links')[0]?.body).toEqual({ link_id: 'in-a' });
    const chips = screen
      .getAllByRole('link')
      .filter((x) => x.getAttribute('href')?.startsWith('/workspaces/'));
    expect(chips.map((c) => c.textContent)).toEqual(['A', 'b']);
    await act(async () => screen.getByRole('button', { name: 'Add to workspace' }).click());
    await act(async () => (await screen.findByRole('menuitemcheckbox', { name: 'A' })).click());
    expect(api.sent('POST')).toHaveLength(1);
  });
});

describe('a card’s note and workspaces', () => {
  it.each([
    {
      label: 'a note and two workspaces',
      note_preview: 'Hotels',
      workspaces: [
        { id: 'wa', name: 'A' },
        { id: 'wb', name: 'b' },
      ],
    },
    { label: 'neither', note_preview: null, workspaces: [] },
  ])('shows $label', ({ note_preview, workspaces }) => {
    const l = makeLink({ id: 'n', title: 'Noted', note_preview, workspaces });
    const { container } = render(
      <LinkCard link={l} actions={{ onPin: noop, onUnpin: noop, onDelete: noop }} />,
    );
    const card = container.querySelector('article')!;
    const preview = card.querySelector('.note-preview');
    if (note_preview) {
      expect(preview?.textContent).toBe(note_preview);
      expect(card.firstElementChild).toBe(preview);
    } else {
      expect(preview).toBeNull();
    }
    const chips = [...card.querySelectorAll('a')].filter((a) =>
      a.getAttribute('href')?.startsWith('/workspaces/'),
    );
    expect(chips.map((c) => [c.textContent, c.getAttribute('href')])).toEqual(
      workspaces.map((w) => [w.name, `/workspaces/${w.id}`]),
    );
  });
});

describe('a card’s decay', () => {
  it.each([
    { state: 'active', decay_note: '42 points: expires in 42 days' },
    { state: 'pending', decay_note: '0 points: expires today' },
    { state: 'active', decay_note: 'pinned: never expires, -3 points', pinned: true },
    {
      state: 'active',
      decay_note: 'in a workspace: never expires, 12 points',
      dead_since: '2027-03-01T10:00:00.000Z',
    },
  ])('shows the note "$decay_note", undimmed and without a sticky label', (overrides) => {
    const l = makeLink({ id: 'd', title: 'Decaying', ...overrides });
    const { container } = render(
      <LinkCard link={l} actions={{ onPin: noop, onUnpin: noop, onDelete: noop }} />,
    );
    const card = container.querySelector('article')!;
    expect(screen.getByText(overrides.decay_note)).toBeTruthy();
    expect(card.classList.contains('dormant')).toBe(false);
    expect(card.textContent).not.toContain('sticky');
  });
});

describe('a dead link’s card', () => {
  it.each([
    {
      label: 'a dead link',
      overrides: {
        dead_since: '2027-03-01T10:00:00.000Z',
        last_check_result: 'could not connect',
        has_snapshot: true,
      },
      dead: true,
    },
    { label: 'a live link', overrides: { has_snapshot: true }, dead: false },
  ])('shows $label as it is', ({ overrides, dead }) => {
    const l = makeLink({ id: 'gone', title: 'Gone Site', state: 'active', ...overrides });
    render(<LinkCard link={l} actions={{ onPin: noop, onUnpin: noop, onDelete: noop }} />);
    const title = screen.getByRole('link', { name: 'Gone Site' });
    expect(getComputedStyle(title).textDecoration.includes('line-through')).toBe(dead);
    expect(screen.queryByText('dead since 2027-03-01 (could not connect)') !== null).toBe(dead);
    expect(screen.getByRole('link', { name: 'Read' })).toBeTruthy();
  });
});

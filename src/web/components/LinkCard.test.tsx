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

describe('a link card', () => {
  it('opens the link through the open endpoint, from its title and its Open action', () => {
    render(<LinkCard link={link} actions={{ onPin: noop, onUnpin: noop, onDelete: noop }} />);
    expect(screen.getByRole('link', { name: 'example.com' }).getAttribute('href')).toBe(
      '/api/v1/links/abc/open',
    );
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe(
      '/api/v1/links/abc/open',
    );
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
  ])('shows $label as it is', ({ link: l, texts, read, favicon }) => {
    const { container } = render(
      <LinkCard link={l} actions={{ onPin: noop, onUnpin: noop, onDelete: noop }} />,
    );
    for (const text of texts) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Read' }) !== null).toBe(read);
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
  it('shows the summary in two lines that expand, a chip per tag, and the topic', () => {
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

import { act, render, screen } from '@testing-library/react';
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

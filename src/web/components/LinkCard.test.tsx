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

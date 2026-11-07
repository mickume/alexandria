import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Link } from '../api';
import { LinkCard } from './LinkCard';

const link: Link = {
  id: 'abc',
  url: 'https://example.com/a',
  original_url: 'https://example.com/a?utm_source=x',
  host: 'example.com',
  title: 'example.com',
  state: 'pending',
  added_at: '2026-03-04T10:00:00.000Z',
  last_used_at: '2026-03-05T10:00:00.000Z',
  use_count: 0,
  pinned: false,
  pin_position: null,
};

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

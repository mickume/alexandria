import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderPage } from '../test/helpers';

describe('the sign-in page', () => {
  it.each([
    { query: '', message: null },
    { query: '?error=private', message: 'This library is private' },
    { query: '?error=failed', message: 'Sign-in failed, please try again' },
  ])('offers one action and shows $message for "$query"', ({ query, message }) => {
    const { container } = renderPage(`/signin${query}`);
    const interactive = container.querySelectorAll('a[href], button, input, select, textarea');
    expect(interactive).toHaveLength(1);
    const action = within(container).getByRole('link', { name: 'Sign in with Google' });
    expect(action.getAttribute('href')).toBe('/auth/google');
    for (const text of ['This library is private', 'Sign-in failed, please try again']) {
      if (text === message) expect(screen.getByText(text)).toBeTruthy();
      else expect(screen.queryByText(text)).toBeNull();
    }
  });

  it.each([
    ['?error=deleting', 'Your account is being deleted, try again in a few minutes'],
    ['?deleted=1', 'Your account and all its data are being deleted.'],
  ])('says the account is being deleted for "%s"', (query, message) => {
    renderPage(`/signin${query}`);
    expect(screen.getByText(message)).toBeTruthy();
  });
});

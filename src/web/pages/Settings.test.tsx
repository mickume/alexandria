import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi, renderPage } from '../test/helpers';

const existing = {
  id: 't1',
  name: 'old script',
  created_at: '2026-01-15T10:00:00.000Z',
  last_used_at: '2026-02-20T08:00:00.000Z',
};

function fakeApi(): FakeApi {
  const items: { id: string; name: string; created_at: string; last_used_at: string | null }[] = [
    existing,
  ];
  return new FakeApi()
    .on('GET', '/api/v1/tokens', () => ({ status: 200, body: { items } }))
    .on('POST', '/api/v1/tokens', (req) => {
      const token = {
        id: 't2',
        name: (req.body as { name: string }).name,
        created_at: '2026-03-01T12:00:00.000Z',
        last_used_at: null,
      };
      items.unshift(token);
      return { status: 201, body: { ...token, secret: 'alx_secret-shown-once' } };
    })
    .on('DELETE', '/api/v1/tokens/:id', (_req, { id }) => {
      items.splice(
        items.findIndex((t) => t.id === id),
        1,
      );
      return { status: 204 };
    });
}

async function createToken(name: string): Promise<void> {
  fireEvent.change(screen.getByLabelText('Token name'), { target: { value: name } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
  });
}

describe('the tokens section of the settings page', () => {
  it('shows a new secret once, lists tokens with their dates, and revokes them', async () => {
    const api = fakeApi();
    renderPage('/settings', api);
    const row = await screen.findByRole('listitem', { name: 'old script' });
    expect(within(row).getByText(/Created 15 Jan 2026/)).toBeTruthy();
    expect(within(row).getByText(/Last used 20 Feb 2026/)).toBeTruthy();

    await createToken('laptop script');
    expect(api.sent('POST', '/api/v1/tokens')[0]?.body).toEqual({ name: 'laptop script' });
    expect(await screen.findByText('alx_secret-shown-once')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    const created = await screen.findByRole('listitem', { name: 'laptop script' });
    expect(within(created).getByText(/Last used never/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('alx_secret-shown-once')).toBeNull();

    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }));
    });
    expect(api.sent('DELETE', '/api/v1/tokens/t1')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'old script' })).toBeNull());
  });

  it('does not show a secret after a reload', async () => {
    const api = fakeApi();
    const first = renderPage('/settings', api);
    await screen.findByRole('listitem', { name: 'old script' });
    await createToken('laptop script');
    expect(await screen.findByText('alx_secret-shown-once')).toBeTruthy();
    first.unmount();
    renderPage('/settings', api);
    expect(await screen.findByRole('listitem', { name: 'laptop script' })).toBeTruthy();
    expect(screen.queryByText('alx_secret-shown-once')).toBeNull();
  });

  it('says so when the token limit is reached', async () => {
    const api = fakeApi().on('POST', '/api/v1/tokens', {
      status: 409,
      body: { error: 'token_limit', message: 'token limit reached' },
    });
    renderPage('/settings', api);
    await screen.findByRole('listitem', { name: 'old script' });
    await createToken('one too many');
    expect(await screen.findByText('token limit reached')).toBeTruthy();
  });
});

describe('the decay section of the settings page', () => {
  function decayApi(): FakeApi {
    let stored = { start_points: 60, remove_days: 180, use_boost: 40 };
    return fakeApi()
      .on('GET', '/api/v1/settings/decay', () => ({ status: 200, body: stored }))
      .on('PUT', '/api/v1/settings/decay', (req) => {
        stored = req.body as typeof stored;
        return { status: 200, body: stored };
      });
  }

  /** The text of the help that describes `input`. */
  const helpOf = (input: HTMLElement) =>
    document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent;

  it('shows the three settings with their meanings, and saves them all', async () => {
    const api = decayApi();
    renderPage('/settings', api);
    const start = (await screen.findByLabelText('Start points')) as HTMLInputElement;
    const remove = screen.getByLabelText('Remove after expiring (days)') as HTMLInputElement;
    const boost = screen.getByLabelText('Use boost (%)') as HTMLInputElement;
    await waitFor(() => expect(start.value).toBe('60'));
    expect(remove.value).toBe('180');
    expect(boost.value).toBe('40');
    const section = start.closest('section')!;
    expect(section.querySelectorAll('input[type="number"]')).toHaveLength(3);
    expect(helpOf(start)).toBe('Points a link starts with, plus one per use. It loses one a day.');
    expect(helpOf(boost)).toBe(
      'Share of the points a link has lost that a use wins back, once a day. At 100, a use gives back all of them.',
    );
    fireEvent.change(start, { target: { value: '30' } });
    fireEvent.change(boost, { target: { value: '75' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(api.sent('PUT', '/api/v1/settings/decay')[0]?.body).toEqual({
      start_points: 30,
      remove_days: 180,
      use_boost: 75,
    });
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect([start.value, remove.value, boost.value]).toEqual(['30', '180', '75']);
  });

  it.each([
    {
      label: 'Remove after expiring (days)',
      field: 'remove_days',
      typed: '3000',
      message: 'remove_days must be a whole number from 7 to 3650',
    },
    {
      label: 'Use boost (%)',
      field: 'use_boost',
      typed: '5',
      message: 'use_boost must be a whole number from 10 to 100',
    },
  ])(
    'shows a refusal of $field beside its field alone and keeps the typed value',
    async ({ label, field, typed, message }) => {
      const api = decayApi().on('PUT', '/api/v1/settings/decay', {
        status: 400,
        body: { error: 'invalid_threshold', field, message },
      });
      renderPage('/settings', api);
      const input = (await screen.findByLabelText(label)) as HTMLInputElement;
      await waitFor(() => expect(input.value).not.toBe(''));
      fireEvent.change(input, { target: { value: typed } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      });
      const shown = await screen.findByText(message);
      expect(shown.closest(`[data-field="${field}"]`)).not.toBeNull();
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(input.value).toBe(typed);
    },
  );
});

describe('exporting from the settings page', () => {
  it('offers the whole library as a download', async () => {
    renderPage('/settings', fakeApi());
    const link = await screen.findByRole('link', { name: 'Export library' });
    expect(link.getAttribute('href')).toBe('/api/v1/export');
    expect(link.hasAttribute('download')).toBe(true);
  });
});

describe('deleting the account from the settings page', () => {
  function meApi() {
    return fakeApi().on('GET', '/api/v1/me', {
      status: 200,
      body: { email: 'owner@example.test', name: 'Ada Owner' },
    });
  }

  async function typeEmail(text: string) {
    const field = await screen.findByLabelText('Type your email address to confirm');
    fireEvent.change(field, { target: { value: text } });
    return screen.getByRole('button', { name: 'Delete account' }) as HTMLButtonElement;
  }

  it.each([
    ['', true],
    ['owner@example.tes', true],
    [' OWNER@example.test ', false],
  ])('keeps the button disabled until the email is typed: %j', async (text, disabled) => {
    renderPage('/settings', meApi());
    const button = await typeEmail(text);
    await waitFor(() => expect(button.disabled).toBe(disabled));
    expect(screen.getByText(/cannot be undone/)).toBeTruthy();
    expect(screen.getByText(/every link, snapshot, workspace and token/)).toBeTruthy();
  });

  it('deletes the account and goes to the sign-in page', async () => {
    const api = meApi().on('DELETE', '/api/v1/me', { status: 202, body: { status: 'deleting' } });
    renderPage('/settings', api);
    const button = await typeEmail('Owner@example.test');
    await waitFor(() => expect(button.disabled).toBe(false));
    await act(async () => button.click());
    expect(api.sent('DELETE', '/api/v1/me').map((r) => r.body)).toEqual([
      { confirm_email: 'Owner@example.test' },
    ]);
    expect(window.location.pathname + window.location.search).toBe('/signin?deleted=1');
  });

  it.each([
    [
      {
        status: 400,
        body: {
          error: 'confirmation_mismatch',
          field: 'confirm_email',
          message: 'type your email address to confirm',
        },
      },
      'type your email address to confirm',
    ],
    ['network-error' as const, 'could not delete the account, try again'],
    [{ status: 500, body: { error: 'internal' } }, 'could not delete the account, try again'],
  ])('stays on the page and says why when the deletion fails (%#)', async (answer, message) => {
    renderPage('/settings', meApi().on('DELETE', '/api/v1/me', answer));
    const button = await typeEmail('owner@example.test');
    await waitFor(() => expect(button.disabled).toBe(false));
    await act(async () => button.click());
    expect(await screen.findByText(message)).toBeTruthy();
    expect(window.location.pathname).toBe('/settings');
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
  });
});

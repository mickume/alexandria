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

describe('the AI key section of the settings page', () => {
  function aiApi(): FakeApi {
    let stored: Record<string, unknown> = { configured: false, unenriched_count: 0 };
    return fakeApi()
      .on('GET', '/api/v1/settings/ai', () => ({ status: 200, body: stored }))
      .on('PUT', '/api/v1/settings/ai', (req) => {
        const body = req.body as { provider: string; api_key: string; model?: string };
        stored = {
          configured: true,
          provider: body.provider,
          model: body.model ?? 'claude-opus-5-5',
          key_last4: body.api_key.slice(-4),
          status: 'verified',
          rejected_message: null,
          unenriched_count: 0,
        };
        const { unenriched_count: _ignored, ...view } = stored;
        return { status: 200, body: view };
      })
      .on('DELETE', '/api/v1/settings/ai', () => {
        stored = { configured: false, unenriched_count: 0 };
        return { status: 204 };
      });
  }

  it('saves a key, shows it verified by its last 4 characters, and removes it', async () => {
    const api = aiApi();
    renderPage('/settings', api);
    const provider = (await screen.findByLabelText('Provider')) as unknown as HTMLSelectElement;
    expect(provider.value).toBe('anthropic');
    const model = screen.getByLabelText('Model') as HTMLInputElement;
    expect(model.placeholder).toBe('claude-opus-5-5');
    expect(model.required).toBe(false);
    fireEvent.change(provider, { target: { value: 'openrouter' } });
    expect((screen.getByLabelText('Model') as HTMLInputElement).required).toBe(true);
    fireEvent.change(provider, { target: { value: 'anthropic' } });

    const key = screen.getByLabelText('API key') as HTMLInputElement;
    fireEvent.change(key, { target: { value: 'sk-ant-abcd1234' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
    });
    expect(api.sent('PUT', '/api/v1/settings/ai')[0]?.body).toEqual({
      provider: 'anthropic',
      api_key: 'sk-ant-abcd1234',
    });
    expect(await screen.findByText('key verified')).toBeTruthy();
    expect(screen.getByText('…1234')).toBeTruthy();
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    });
    expect(api.sent('DELETE', '/api/v1/settings/ai')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText('…1234')).toBeNull());
  });

  it('shows the provider’s message when it rejects the key', async () => {
    const api = aiApi().on('PUT', '/api/v1/settings/ai', {
      status: 400,
      body: { error: 'key_rejected', field: 'api_key', message: 'invalid x-api-key' },
    });
    renderPage('/settings', api);
    fireEvent.change(await screen.findByLabelText('API key'), { target: { value: 'sk-ant-bad' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
    });
    expect(await screen.findByText('invalid x-api-key')).toBeTruthy();
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('');
  });
});

describe('the Firecrawl section of the settings page', () => {
  function firecrawlApi(stored: Record<string, unknown> = { configured: false }): FakeApi {
    return fakeApi()
      .on('GET', '/api/v1/settings/firecrawl', () => ({ status: 200, body: stored }))
      .on('PUT', '/api/v1/settings/firecrawl', (req) => {
        const key = (req.body as { api_key: string }).api_key;
        stored = {
          configured: true,
          key_last4: key.slice(-4),
          status: 'verified',
          rejected_message: null,
        };
        return { status: 200, body: stored };
      })
      .on('DELETE', '/api/v1/settings/firecrawl', () => {
        stored = { configured: false };
        return { status: 204 };
      });
  }

  it('saves a key, shows it verified by its last 4 characters, and removes it', async () => {
    const api = firecrawlApi();
    renderPage('/settings', api);
    fireEvent.change(await screen.findByLabelText('Firecrawl API key'), {
      target: { value: 'fc-wxyz9876' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Firecrawl key' }));
    });
    expect(api.sent('PUT', '/api/v1/settings/firecrawl')[0]?.body).toEqual({
      api_key: 'fc-wxyz9876',
    });
    expect(await screen.findByText('…9876')).toBeTruthy();
    expect((screen.getByLabelText('Firecrawl API key') as HTMLInputElement).value).toBe('');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove Firecrawl key' }));
    });
    expect(api.sent('DELETE', '/api/v1/settings/firecrawl')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText('…9876')).toBeNull());
  });

  it.each([
    {
      label: 'Firecrawl’s message when it refuses a new key',
      stored: { configured: false },
      put: {
        status: 400,
        body: { error: 'key_rejected', field: 'api_key', message: 'Unauthorized: Invalid token' },
      },
      text: 'Unauthorized: Invalid token',
    },
    {
      label: 'that the stored key was rejected, and why',
      stored: {
        configured: true,
        key_last4: '9876',
        status: 'rejected',
        rejected_message: 'Insufficient credits',
      },
      put: null,
      text: 'your Firecrawl key was rejected: Insufficient credits',
    },
  ])('shows $label', async ({ stored, put, text }) => {
    const api = firecrawlApi(stored);
    if (put) api.on('PUT', '/api/v1/settings/firecrawl', put);
    renderPage('/settings', api);
    if (put) {
      fireEvent.change(await screen.findByLabelText('Firecrawl API key'), {
        target: { value: 'fc-bad' },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save Firecrawl key' }));
      });
    }
    expect(await screen.findByText(text)).toBeTruthy();
  });
});

describe('enriching all unenriched links from the settings page', () => {
  const verified = (unenriched_count: number) => ({
    configured: true,
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    key_last4: '1234',
    status: 'verified',
    rejected_message: null,
    unenriched_count,
  });

  it('offers to enrich the waiting links and says how many were queued', async () => {
    const api = fakeApi()
      .on('GET', '/api/v1/settings/ai', { status: 200, body: verified(27) })
      .on('POST', '/api/v1/links/enrich-unenriched', { status: 202, body: { queued: 27 } });
    renderPage('/settings', api);
    const button = await screen.findByRole('button', { name: 'Enrich all unenriched links (27)' });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(api.sent('POST', '/api/v1/links/enrich-unenriched')).toHaveLength(1);
    expect(await screen.findByText('queued 27 links')).toBeTruthy();
  });

  it('offers nothing when no link is waiting', async () => {
    renderPage(
      '/settings',
      fakeApi().on('GET', '/api/v1/settings/ai', { status: 200, body: verified(0) }),
    );
    await screen.findByText('…1234');
    expect(screen.queryByRole('button', { name: /Enrich all/ })).toBeNull();
  });
});

describe('a rejected AI key on the settings page', () => {
  const settings = (status: string, message: string | null) => ({
    configured: true,
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    key_last4: '1234',
    status,
    rejected_message: message,
    unenriched_count: 0,
  });

  it('is reported once, beside Replace and Remove', async () => {
    renderPage(
      '/settings',
      fakeApi().on('GET', '/api/v1/settings/ai', {
        status: 200,
        body: settings('rejected', 'insufficient credits'),
      }),
    );
    expect(
      await screen.findAllByText('your AI key was rejected: insufficient credits'),
    ).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Replace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('is not reported while the key is verified', async () => {
    renderPage(
      '/settings',
      fakeApi().on('GET', '/api/v1/settings/ai', { status: 200, body: settings('verified', null) }),
    );
    await screen.findByText('…1234');
    expect(screen.queryByText(/your AI key was rejected/)).toBeNull();
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
    expect(screen.getByText(/every link, snapshot, workspace, token and the AI key/)).toBeTruthy();
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

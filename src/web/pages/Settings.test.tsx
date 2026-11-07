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

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    let stored = { dormant_days: 60, archive_days: 120, remove_days: 180 };
    return fakeApi()
      .on('GET', '/api/v1/settings/decay', () => ({ status: 200, body: stored }))
      .on('PUT', '/api/v1/settings/decay', (req) => {
        stored = req.body as typeof stored;
        return { status: 200, body: stored };
      });
  }

  it('shows the thresholds and saves new ones', async () => {
    const api = decayApi();
    renderPage('/settings', api);
    const dormant = (await screen.findByLabelText('Dormant after (days)')) as HTMLInputElement;
    const archive = screen.getByLabelText('Archive after (days)') as HTMLInputElement;
    const remove = screen.getByLabelText('Remove after archiving (days)') as HTMLInputElement;
    await waitFor(() => expect(dormant.value).toBe('60'));
    expect([archive.value, remove.value]).toEqual(['120', '180']);
    fireEvent.change(dormant, { target: { value: '30' } });
    fireEvent.change(archive, { target: { value: '90' } });
    fireEvent.change(remove, { target: { value: '30' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save thresholds' }));
    });
    expect(api.sent('PUT', '/api/v1/settings/decay')[0]?.body).toEqual({
      dormant_days: 30,
      archive_days: 90,
      remove_days: 30,
    });
  });

  it('shows a refusal beside the field it names and keeps the typed values', async () => {
    const api = decayApi().on('PUT', '/api/v1/settings/decay', {
      status: 400,
      body: {
        error: 'invalid_thresholds',
        field: 'dormant_days',
        message: 'the dormant threshold must be below the archive threshold',
      },
    });
    renderPage('/settings', api);
    const dormant = (await screen.findByLabelText('Dormant after (days)')) as HTMLInputElement;
    await waitFor(() => expect(dormant.value).toBe('60'));
    fireEvent.change(dormant, { target: { value: '200' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save thresholds' }));
    });
    const message = await screen.findByText(
      'the dormant threshold must be below the archive threshold',
    );
    expect(message.closest('[data-field="dormant_days"]')).not.toBeNull();
    expect(dormant.value).toBe('200');
  });
});

describe('importing from the settings page', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const report = {
    id: 'imp1',
    created_at: '2026-11-07T10:00:00.000Z',
    counts: { url_lines: 400, added: 397, duplicates: 0, invalid: 3, not_imported: 0 },
    invalid: [
      { line: 57, text: 'not-a-url' },
      { line: 211, text: 'javascript:alert(1)' },
      { line: 399, text: 'http://localhost/x' },
    ],
    duplicates: [],
    stopped_at_limit: null,
  };

  function importApi(
    answer: { status: number; body: unknown },
    progress: { waiting: number; in_progress: number; done: number; enriched: number }[] = [],
  ) {
    let polls = 0;
    return fakeApi()
      .on('POST', '/api/v1/imports', answer)
      .on('GET', '/api/v1/imports/:id', () => ({
        status: 200,
        body: { ...report, progress: progress[Math.min(polls++, progress.length - 1)] },
      }));
  }

  async function startImport() {
    const input = screen.getByLabelText('File of URLs') as HTMLInputElement;
    const file = new File(['https://a.example\n'], 'links.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    await act(async () => screen.getByRole('button', { name: 'Import' }).click());
    return file;
  }

  it('uploads the file, shows the report and follows the progress until done', async () => {
    vi.useFakeTimers();
    const api = importApi({ status: 201, body: report }, [
      { waiting: 377, in_progress: 20, done: 0, enriched: 0 },
      { waiting: 0, in_progress: 0, done: 397, enriched: 397 },
    ]);
    renderPage('/settings', api);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    const file = await startImport();
    await act(async () => vi.advanceTimersByTimeAsync(0));

    const sent = api.sent('POST', '/api/v1/imports');
    expect(sent).toHaveLength(1);
    expect((sent[0]!.body as FormData).get('file')).toBe(file);
    const view = screen.getByRole('region', { name: 'Import' });
    for (const text of ['added 397', 'duplicates 0', 'invalid 3']) {
      expect(within(view).getByText(text)).toBeTruthy();
    }
    expect(within(view).getByText('line 57: not-a-url')).toBeTruthy();
    expect(within(view).getByText('line 211: javascript:alert(1)')).toBeTruthy();
    expect(within(view).getByText('line 399: http://localhost/x')).toBeTruthy();
    expect(within(view).getByRole('link', { name: 'Download report' }).getAttribute('href')).toBe(
      '/api/v1/imports/imp1/report',
    );

    expect(api.sent('GET', '/api/v1/imports/imp1')).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(api.sent('GET', '/api/v1/imports/imp1')).toHaveLength(1);
    expect(within(view).getByText('waiting 377')).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(api.sent('GET', '/api/v1/imports/imp1')).toHaveLength(2);
    expect(within(view).getByText('done 397')).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(api.sent('GET', '/api/v1/imports/imp1')).toHaveLength(2);
  });

  it.each([
    [400, 'unsupported_file', 'only plain-text files with one URL per line are accepted'],
    [409, 'import_too_large', 'too large: at most 5,000 URLs / 2 MB per import'],
    [400, 'no_urls', 'the file holds no URL: one URL per line is expected'],
  ])('shows a refusal (%s %s) and no progress', async (status, error, message) => {
    renderPage('/settings', importApi({ status, body: { error, field: 'file', message } }));
    await startImport();
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText(/^added /)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Download report' })).toBeNull();
  });

  it('says where the library limit stopped the import', async () => {
    const stopped = {
      ...report,
      counts: { url_lines: 5, added: 2, duplicates: 1, invalid: 0, not_imported: 2 },
      invalid: [],
      stopped_at_limit: { line: 4 },
    };
    renderPage(
      '/settings',
      importApi({ status: 201, body: stopped }, [
        { waiting: 0, in_progress: 0, done: 2, enriched: 0 },
      ]),
    );
    await startImport();
    expect(
      await screen.findByText(
        'library full (20,000 links): stopped at line 4, 2 lines not imported',
      ),
    ).toBeTruthy();
  });
});

describe('exporting from the settings page', () => {
  it('offers the whole library as a download', async () => {
    renderPage('/settings', fakeApi());
    const link = await screen.findByRole('link', { name: 'Export library' });
    expect(link.getAttribute('href')).toBe('/api/v1/export');
    expect(link.hasAttribute('download')).toBe(true);
  });
});

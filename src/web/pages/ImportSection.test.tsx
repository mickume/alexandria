import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeApi, renderPage } from '../test/helpers';

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
  workspace: null,
};

const trip = {
  id: 'w1',
  name: 'Trip',
  description: '',
  link_count: 2,
  created_at: '2026-01-01T00:00:00.000Z',
};

type Progress = { waiting: number; in_progress: number; done: number; enriched: number };

/** The API of the import section: the workspaces, the upload's answer and the progress polls. */
function importApi(
  answer: { status: number; body: unknown } = { status: 201, body: report },
  progress: Progress[] = [{ waiting: 0, in_progress: 0, done: 397, enriched: 0 }],
) {
  let polls = 0;
  return new FakeApi()
    .on('GET', '/api/v1/workspaces', { status: 200, body: { items: [trip], next_cursor: null } })
    .on('POST', '/api/v1/imports', answer)
    .on('GET', '/api/v1/imports/:id', () => ({
      status: 200,
      body: { ...report, progress: progress[Math.min(polls++, progress.length - 1)] },
    }));
}

const linksFile = () => new File(['https://a.example\n'], 'links.txt', { type: 'text/plain' });

/** Picks `file` with the file input. */
function pick(file: File) {
  fireEvent.change(screen.getByLabelText('File of URLs'), { target: { files: [file] } });
}

async function submit() {
  await act(async () => screen.getByRole('button', { name: 'Import' }).click());
}

describe('the import section of the settings page', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uploads the file, shows the report and follows the progress until done', async () => {
    vi.useFakeTimers();
    const api = importApi({ status: 201, body: report }, [
      { waiting: 377, in_progress: 20, done: 0, enriched: 0 },
      { waiting: 0, in_progress: 0, done: 397, enriched: 397 },
    ]);
    renderPage('/settings', api);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    const file = linksFile();
    pick(file);
    await submit();
    await act(async () => vi.advanceTimersByTimeAsync(0));

    const sent = api.sent('POST', '/api/v1/imports');
    expect(sent).toHaveLength(1);
    expect((sent[0]!.body as FormData).get('file')).toBe(file);
    expect((sent[0]!.body as FormData).has('workspace_id')).toBe(false);
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

  it('takes a file dropped on the drop zone, and shows it while dragging', async () => {
    const api = importApi();
    renderPage('/settings', api);
    const button = screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('No file chosen')).toBeTruthy();
    const zone = screen.getByText('Drop a file of URLs here').closest('.dropzone')!;
    const file = linksFile();
    fireEvent.dragOver(zone, { dataTransfer: { files: [], dropEffect: 'none' } });
    expect(zone.classList.contains('is-dragging')).toBe(true);
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(zone.classList.contains('is-dragging')).toBe(false);
    expect(screen.getByText('links.txt (18 B)')).toBeTruthy();
    await submit();
    expect((api.sent('POST', '/api/v1/imports')[0]!.body as FormData).get('file')).toBe(file);
  });

  it('adds the links to the chosen workspace and links to it from the report', async () => {
    const into = { ...report, workspace: { id: 'w1', name: 'Trip', added: 397 } };
    const api = importApi({ status: 201, body: into });
    renderPage('/settings', api);
    const select = (await screen.findByRole('option', { name: 'Trip' })).closest('select')!;
    expect([...select.options].map((o) => o.text)).toEqual([
      'No workspace',
      'Trip',
      'New workspace…',
    ]);
    fireEvent.change(select, { target: { value: 'w1' } });
    pick(linksFile());
    await submit();
    expect((api.sent('POST', '/api/v1/imports')[0]!.body as FormData).get('workspace_id')).toBe(
      'w1',
    );
    expect(screen.getByRole('link', { name: 'Trip' }).getAttribute('href')).toBe('/workspaces/w1');
    expect(screen.getByText(/397 links new to it/)).toBeTruthy();
  });

  it('creates a new workspace first and imports into it', async () => {
    const api = importApi().on('POST', '/api/v1/workspaces', (req) => ({
      status: 201,
      body: { ...trip, id: 'w2', name: (req.body as { name: string }).name, note: '' },
    }));
    renderPage('/settings', api);
    const select = (await screen.findByRole('option', { name: 'Trip' })).closest('select')!;
    fireEvent.change(select, { target: { value: 'new' } });
    fireEvent.change(screen.getByLabelText('Name of the new workspace'), {
      target: { value: ' Reading list ' },
    });
    pick(linksFile());
    await submit();
    expect(api.sent('POST', '/api/v1/workspaces').map((r) => r.body)).toEqual([
      { name: 'Reading list' },
    ]);
    expect((api.sent('POST', '/api/v1/imports')[0]!.body as FormData).get('workspace_id')).toBe(
      'w2',
    );
    expect(select.value).toBe('w2');
    expect(screen.queryByLabelText('Name of the new workspace')).toBeNull();
  });

  it('imports nothing when the new workspace cannot be created', async () => {
    const api = importApi().on('POST', '/api/v1/workspaces', {
      status: 409,
      body: { error: 'name_taken', message: 'a workspace with this name already exists' },
    });
    renderPage('/settings', api);
    const select = (await screen.findByRole('option', { name: 'Trip' })).closest('select')!;
    fireEvent.change(select, { target: { value: 'new' } });
    fireEvent.change(screen.getByLabelText('Name of the new workspace'), {
      target: { value: 'trip' },
    });
    pick(linksFile());
    await submit();
    expect(await screen.findByText('a workspace with this name already exists')).toBeTruthy();
    expect(api.sent('POST', '/api/v1/imports')).toHaveLength(0);
  });

  it.each([
    [400, 'unsupported_file', 'only text or Markdown files (.txt, .md) are accepted'],
    [409, 'import_too_large', 'too large: at most 5,000 URLs / 2 MB per import'],
    [400, 'no_urls', 'the file holds no URL: no line has an http:// or https:// address'],
  ])('shows a refusal (%s %s) and no progress', async (status, error, message) => {
    renderPage('/settings', importApi({ status, body: { error, field: 'file', message } }));
    pick(linksFile());
    await submit();
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
    pick(linksFile());
    await submit();
    expect(
      await screen.findByText(
        'library full (20,000 links): stopped at line 4, 2 lines not imported',
      ),
    ).toBeTruthy();
  });
});

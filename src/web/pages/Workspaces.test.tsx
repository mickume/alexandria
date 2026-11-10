import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeApi, renderPage } from '../test/helpers';

function workspacesApi(): FakeApi {
  const items = [
    { id: 'wa', name: 'A', description: '', link_count: 0, created_at: '2026-01-01T00:00:00.000Z' },
    { id: 'wb', name: 'b', description: '', link_count: 2, created_at: '2026-01-02T00:00:00.000Z' },
  ];
  return new FakeApi()
    .on('GET', '/api/v1/workspaces', () => ({ status: 200, body: { items, next_cursor: null } }))
    .on('POST', '/api/v1/workspaces', (req) => {
      const w = {
        id: 'wl',
        name: (req.body as { name: string }).name,
        description: '',
        link_count: 0,
        created_at: '2026-01-03T00:00:00.000Z',
        note: '',
      };
      items.push(w);
      return { status: 201, body: w };
    })
    .on('PATCH', '/api/v1/workspaces/:id', (req, { id }) => {
      const w = items.find((i) => i.id === id)!;
      Object.assign(w, req.body);
      return { status: 200, body: { ...w, note: '' } };
    })
    .on('DELETE', '/api/v1/workspaces/:id', (_req, { id }) => {
      items.splice(
        items.findIndex((i) => i.id === id),
        1,
      );
      return { status: 204 };
    });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Workspaces page', () => {
  it('lists, creates, renames and, after asking, deletes workspaces', async () => {
    const api = workspacesApi();
    renderPage('/workspaces', api);
    expect(await screen.findByRole('link', { name: 'A (0)' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'b (2)' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Lisbon' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    });
    expect(api.sent('POST', '/api/v1/workspaces')[0]?.body).toEqual({ name: 'Lisbon' });
    expect(await screen.findByRole('link', { name: 'Lisbon (0)' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Rename b' }));
    fireEvent.change(screen.getByLabelText('New name of b'), { target: { value: 'Porto' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(api.sent('PATCH', '/api/v1/workspaces/wb')[0]?.body).toEqual({ name: 'Porto' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete A' }));
    const asked = within(
      await screen.findByRole('alertdialog', { name: 'Delete this workspace?' }),
    );
    expect(asked.getByText('Its links stay in your library.')).toBeTruthy();
    fireEvent.click(asked.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.sent('DELETE')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Delete A' }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Delete workspace' }));
    });
    expect(api.sent('DELETE', '/api/v1/workspaces/wa')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('link', { name: 'A (0)' })).toBeNull());
  });

  it('shows the API’s refusal of a name', async () => {
    const api = workspacesApi().on('POST', '/api/v1/workspaces', {
      status: 409,
      body: { error: 'name_taken', message: 'a workspace with this name already exists' },
    });
    renderPage('/workspaces', api);
    fireEvent.change(await screen.findByLabelText('Workspace name'), { target: { value: 'a' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    });
    expect(await screen.findByText('a workspace with this name already exists')).toBeTruthy();
  });
});

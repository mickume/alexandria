import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Member } from '../api';
import { FakeApi, makeLink, renderPage } from '../test/helpers';

function workspaceApi(): FakeApi {
  let note = '# Plan\n\n- book flights';
  const members: Member[] = [
    { ...makeLink({ id: 'a', title: 'Alpha' }), position: 1 },
    { ...makeLink({ id: 'b', title: 'Beta' }), position: 2 },
  ];
  const view = () => ({
    id: 'w1',
    name: 'Trip',
    description: '',
    link_count: members.length,
    created_at: '2026-01-01T00:00:00.000Z',
    note,
  });
  return new FakeApi()
    .on('GET', '/api/v1/workspaces/w1', () => ({ status: 200, body: view() }))
    .on('GET', '/api/v1/workspaces/w1/links', () => ({
      status: 200,
      body: { items: members, next_cursor: null },
    }))
    .on('PATCH', '/api/v1/workspaces/w1', (req) => {
      note = (req.body as { note: string }).note;
      return { status: 200, body: view() };
    })
    .on('POST', '/api/v1/workspaces/w1/links', (req) => {
      const { link_id, position } = req.body as { link_id: string; position: number };
      const moving = members.splice(
        members.findIndex((m) => m.id === link_id),
        1,
      )[0]!;
      members.splice(position - 1, 0, moving);
      members.forEach((m, i) => (m.position = i + 1));
      return { status: 200, body: { workspace_id: 'w1', link_id, position } };
    })
    .on('DELETE', '/api/v1/workspaces/w1/links/:link', (_req, { link }) => {
      members.splice(
        members.findIndex((m) => m.id === link),
        1,
      );
      return { status: 204 };
    });
}

const titles = () => screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'));

describe('a workspace’s page', () => {
  it('shows the rendered note above the links, reorders them by drag and removes one', async () => {
    const api = workspaceApi();
    const { container } = renderPage('/workspaces/w1', api);
    const heading = await screen.findByRole('heading', { name: 'Plan' });
    await screen.findByRole('article', { name: 'Alpha' });
    expect(titles()).toEqual(['Alpha', 'Beta']);
    expect(
      heading.compareDocumentPosition(screen.getByRole('article', { name: 'Alpha' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.querySelector('.markdown li')?.textContent).toBe('book flights');

    await act(async () => {
      fireEvent.dragStart(screen.getByRole('article', { name: 'Beta' }));
      fireEvent.dragOver(screen.getByRole('article', { name: 'Alpha' }));
      fireEvent.drop(screen.getByRole('article', { name: 'Alpha' }));
    });
    expect(api.sent('POST', '/api/v1/workspaces/w1/links')[0]?.body).toEqual({
      link_id: 'b',
      position: 1,
    });
    await waitFor(() => expect(titles()).toEqual(['Beta', 'Alpha']));

    const alpha = screen.getByRole('article', { name: 'Alpha' });
    fireEvent.click(within(alpha).getByRole('button', { name: 'More actions' }));
    await act(async () => {
      fireEvent.click(within(alpha).getByRole('button', { name: 'Remove from workspace' }));
    });
    expect(api.sent('DELETE', '/api/v1/workspaces/w1/links/a')).toHaveLength(1);
    await waitFor(() => expect(titles()).toEqual(['Beta']));
  });

  it('edits the note in place, and keeps the text when it is too long', async () => {
    const api = workspaceApi();
    renderPage('/workspaces/w1', api);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit note' }));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: '## Hotels' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    });
    expect(api.sent('PATCH', '/api/v1/workspaces/w1')[0]?.body).toEqual({ note: '## Hotels' });
    expect(await screen.findByRole('heading', { name: 'Hotels' })).toBeTruthy();

    api.on('PATCH', '/api/v1/workspaces/w1', {
      status: 400,
      body: { error: 'note_too_long', field: 'note', message: 'note too long (20,000 characters)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'x'.repeat(20_001) } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    });
    expect(await screen.findByText('note too long (20,000 characters)')).toBeTruthy();
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toHaveLength(20_001);
  });
});

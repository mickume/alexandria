import { useCallback, useEffect, useRef, useState } from 'react';
import { links, workspaces, type Member, type Workspace } from '../api';
import { LinkCard, type CardActions } from '../components/LinkCard';
import { NoteEditor } from '../components/NoteEditor';

/**
 * A workspace's page: its note rendered above its links in the owner's order;
 * the note is edited in place, the links reordered by drag and removed.
 */
export function WorkspacePage({ id }: { id: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragged = useRef<Member | null>(null);

  const reload = useCallback(async () => setMembers(await workspaces.links(id)), [id]);

  useEffect(() => {
    let live = true;
    Promise.all([workspaces.get(id), workspaces.links(id)])
      .then(([w, m]) => {
        if (!live) return;
        setWorkspace(w);
        setMembers(m);
      })
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [id]);

  async function move(target: Member) {
    const moving = dragged.current;
    dragged.current = null;
    if (!moving || moving.id === target.id) return;
    try {
      await workspaces.addLink(id, moving.id, target.position);
      await reload();
    } catch {
      setError('could not move the link, try again');
    }
  }

  /** Runs a change to a member link, then shows the members as the API has them. */
  function change(action: () => Promise<unknown>) {
    action()
      .then(reload)
      .catch(() => setError('something went wrong, try again'));
  }

  const actions: CardActions = {
    onPin: (link) => change(() => links.pin(link.id)),
    onUnpin: (link) => change(() => links.unpin(link.id)),
    onDelete: (link) => change(() => links.remove(link.id)),
    onRemoveFromWorkspace: (link) => {
      workspaces
        .removeLink(id, link.id)
        .then(() => setMembers((current) => current.filter((m) => m.id !== link.id)))
        .catch(() => setError('could not remove the link, try again'));
    },
  };

  if (missing) return <p className="muted">This workspace does not exist.</p>;
  if (!workspace) return null;
  return (
    <section className="workspace">
      <h1>{workspace.name}</h1>
      {workspace.description && <p className="muted">{workspace.description}</p>}
      <NoteEditor
        note={workspace.note}
        onSave={async (note) => setWorkspace(await workspaces.update(id, { note }))}
      />
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <div className="cards">
        {members.map((m) => (
          <div
            key={m.id}
            className="member"
            draggable
            onDragStart={() => {
              dragged.current = m;
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void move(m);
            }}
          >
            <LinkCard link={m} actions={actions} />
          </div>
        ))}
      </div>
      {members.length === 0 && <p className="muted">No links yet. Add them from the stream.</p>}
    </section>
  );
}

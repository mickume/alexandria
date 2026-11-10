import { useCallback, useEffect, useState } from 'react';
import { Link as PageLink } from '../App';
import {
  ApiError,
  filterQuery,
  searchPath,
  vocabulary,
  type TopicItem,
  type VocabularyItem,
  type VocabularyKind,
} from '../api';
import { byName } from '../format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

const FILTER: Record<VocabularyKind, 'topic' | 'tag'> = { topics: 'topic', tags: 'tag' };

/** What a row is doing: showing its actions, renaming, merging, moving, or waiting for a split. */
type Mode = 'idle' | 'rename' | 'merge' | 'move' | 'splitting';

/** The fewest links filed directly under a topic that a split takes. */
const SPLIT_MIN_LINKS = 20;

/** A topic or tag in the list's order, with its level in the topic tree (1 for a tag). */
interface Entry {
  item: VocabularyItem;
  level: number;
  /** For a topic: the topics it can move under, outside its own subtree, in the list's order. */
  moveTargets?: VocabularyItem[];
}

/**
 * The topics as a tree: the top-level topics by name, each followed by its
 * children by name and theirs beneath them. A topic whose parent is not
 * listed is shown at the top level.
 */
function topicTree(items: TopicItem[]): Entry[] {
  const ids = new Set(items.map((t) => t.id));
  const children = new Map<string | null, TopicItem[]>();
  for (const t of items) {
    const parent = t.parent_id !== null && ids.has(t.parent_id) ? t.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), t]);
  }
  const order: { item: TopicItem; level: number; subtree: Set<string> }[] = [];
  const visit = (parent: string | null, level: number): Set<string> => {
    const below = new Set<string>();
    for (const t of [...(children.get(parent) ?? [])].sort(byName)) {
      const entry = { item: t, level, subtree: new Set([t.id]) };
      order.push(entry);
      for (const id of visit(t.id, level + 1)) entry.subtree.add(id);
      for (const id of entry.subtree) below.add(id);
    }
    return below;
  };
  visit(null, 1);
  return order.map(({ item, level, subtree }) => ({
    item,
    level,
    moveTargets: order.filter((o) => !subtree.has(o.item.id)).map((o) => o.item),
  }));
}

/** A drop-down of choices, the first chosen, with a button to confirm and one to cancel: Merge into or Move under. */
function PickForm({
  label,
  action,
  options,
  onPick,
  onCancel,
}: {
  label: string;
  action: string;
  options: { value: string; name: string }[];
  onPick: (value: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState(options[0]?.value ?? '');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onPick(picked);
      }}
    >
      <NativeSelect aria-label={label} value={picked} onChange={(e) => setPicked(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.name}
          </option>
        ))}
      </NativeSelect>
      <button type="submit">{action}</button>
      <Button type="button" variant="link" className="h-auto p-0" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

/**
 * A row's actions: Rename, Merge when there are others, and for a topic
 * Move and, with at least 20 links of its own, Split; all disabled,
 * with "Splitting…", while a split runs.
 */
function RowActions({
  canMerge,
  canMove,
  canSplit,
  splitting,
  onMode,
  onSplit,
}: {
  canMerge: boolean;
  canMove: boolean;
  canSplit: boolean;
  splitting: boolean;
  onMode: (mode: 'rename' | 'merge' | 'move') => void;
  onSplit: () => void;
}) {
  const button = (label: string, onClick: () => void) => (
    <Button
      type="button"
      variant="link"
      className="h-auto p-0"
      disabled={splitting}
      onClick={onClick}
    >
      {label}
    </Button>
  );
  return (
    <>
      {splitting && <span className="muted">Splitting…</span>}
      {button('Rename', () => onMode('rename'))}
      {canMerge && button('Merge', () => onMode('merge'))}
      {canMove && button('Move', () => onMode('move'))}
      {canSplit && button('Split', onSplit)}
    </>
  );
}

/** One topic or tag: its name opening its search, its count, Rename and Merge, and for a topic Move. */
function Row({
  kind,
  entry: { item, level, moveTargets },
  others,
  onChanged,
  onError,
}: {
  kind: VocabularyKind;
  entry: Entry;
  others: VocabularyItem[];
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [mode, setMode] = useState<Mode>('idle');
  const [name, setName] = useState(item.name);

  async function act(run: () => Promise<unknown>) {
    onError(null);
    try {
      await run();
      setMode('idle');
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'could not save, try again');
    }
  }

  function split() {
    setMode('splitting');
    void act(() => vocabulary.split(item.id)).finally(() => setMode('idle'));
  }

  return (
    <tr data-level={kind === 'topics' ? level : undefined}>
      <td>
        <PageLink to={searchPath(filterQuery(FILTER[kind], item.name))}>{item.name}</PageLink>
      </td>
      <td className="count number">{(item as TopicItem).subtree_count ?? item.count}</td>
      <td className="actions">
        {(mode === 'idle' || mode === 'splitting') && (
          <RowActions
            canMerge={others.length > 0}
            canMove={moveTargets !== undefined}
            canSplit={kind === 'topics' && item.count >= SPLIT_MIN_LINKS}
            splitting={mode === 'splitting'}
            onMode={setMode}
            onSplit={split}
          />
        )}
        {mode === 'rename' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(() => vocabulary.rename(kind, item.id, name));
            }}
          >
            <Input
              aria-label="New name"
              value={name}
              maxLength={kind === 'tags' ? 50 : 100}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit">Save</button>
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              onClick={() => setMode('idle')}
            >
              Cancel
            </Button>
          </form>
        )}
        {mode === 'merge' && (
          <PickForm
            label="Merge into"
            action="Merge into it"
            options={others.map((o) => ({ value: o.id, name: o.name }))}
            onPick={(target) => act(() => vocabulary.merge(kind, item.id, target))}
            onCancel={() => setMode('idle')}
          />
        )}
        {mode === 'move' && moveTargets && (
          <PickForm
            label="Move under"
            action="Move"
            options={[
              { value: '', name: 'Top level' },
              ...moveTargets.map((o) => ({ value: o.id, name: o.name })),
            ]}
            onPick={(parent) => act(() => vocabulary.move(item.id, parent === '' ? null : parent))}
            onCancel={() => setMode('idle')}
          />
        )}
      </td>
    </tr>
  );
}

/**
 * The Topics or Tags page: every tag by name with its number of links, or
 * the topic tree with each topic's links and those beneath it; each opens the
 * search for its filter, with Rename and Merge, whose drop-down offers the
 * others by name, and for a topic Move.
 */
export function VocabularyList({ kind, title }: { kind: VocabularyKind; title: string }) {
  const [items, setItems] = useState<VocabularyItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let live = true;
    vocabulary
      .listAll(kind)
      .then((list) => live && setItems([...list].sort(byName)))
      .catch(() => live && setError(`could not load the ${kind}`));
    return () => {
      live = false;
    };
  }, [kind]);

  useEffect(load, [load]);

  return (
    <section className="vocabulary">
      <h1>{title}</h1>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {items && items.length === 0 && <p className="muted">No {kind} yet.</p>}
      {items && items.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Links</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(kind === 'topics'
              ? topicTree(items as TopicItem[])
              : items.map((item) => ({ item, level: 1 }))
            ).map((entry) => (
              <Row
                key={`${entry.item.id}-${entry.item.name}-${entry.level}`}
                kind={kind}
                entry={entry}
                others={items.filter((o) => o.id !== entry.item.id)}
                onChanged={load}
                onError={setError}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

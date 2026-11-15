import { applyD1Migrations } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  api,
  emptySchema,
  env,
  runEveryMinute,
  seedLinks,
  signIn,
  type TestUser,
} from '../test/helpers';
import { LEGACY_SWEEP, sweepLegacySnapshots } from './sweep';

/** Gives the sweep work to do, as the migration that introduced it leaves it. */
async function startSweep(): Promise<void> {
  await env.DB.prepare(
    'INSERT OR REPLACE INTO maintenance_state (name, cursor, done_at) VALUES (?, NULL, NULL)',
  )
    .bind(LEGACY_SWEEP)
    .run();
}

/** The objects of a link as fetches stored them before snapshots. */
async function legacyCopies(user: TestUser, id: string, kind: 'html' | 'pdf'): Promise<void> {
  const prefix = `u/${user.id}/l/${id}/`;
  if (kind === 'pdf') {
    await env.SNAPSHOTS.put(`${prefix}snapshot`, '%PDF-1.4', {
      httpMetadata: { contentType: 'application/pdf' },
    });
    return;
  }
  await env.SNAPSHOTS.put(`${prefix}snapshot`, '<html>raw</html>', {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });
  await env.SNAPSHOTS.put(`${prefix}reader.json`, '{}', {
    httpMetadata: { contentType: 'application/json' },
  });
}

async function keysOf(user: TestUser): Promise<string[]> {
  return (await env.SNAPSHOTS.list({ prefix: `u/${user.id}/` })).objects
    .map((o) => o.key.slice(`u/${user.id}/l/`.length))
    .sort();
}

describe('carrying a library over to snapshots', () => {
  it('keeps PDFs as snapshots, drops the web pages’ copies and sweeps them from storage', async () => {
    await emptySchema();
    await applyD1Migrations(
      env.DB,
      env.TEST_MIGRATIONS.filter((m) => m.name < '0024'),
    );
    const user = await signIn();
    const [page = '', pdf = ''] = await seedLinks(user, [
      { url: 'https://page.example/', state: 'active' },
      { url: 'https://paper.example/a.pdf', state: 'archived' },
    ]);
    const fetchedAt = '2026-05-01T00:00:00.000Z';
    for (const [id, kind] of [
      [page, 'html'],
      [pdf, 'pdf'],
    ] as const) {
      await env.DB.prepare(
        'UPDATE links SET content_kind = ?, has_snapshot = 1, fetched_at = ? WHERE id = ?',
      )
        .bind(kind, fetchedAt, id)
        .run();
      await legacyCopies(user, id, kind);
    }
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

    const read = async (id: string) =>
      (await api('GET', `/api/v1/links/${id}`, { as: user.session })).json;
    expect(await read(page)).toMatchObject({ has_snapshot: false, snapshot_at: null });
    expect(await read(pdf)).toMatchObject({
      has_snapshot: true,
      snapshot_kind: 'pdf',
      snapshot_at: fetchedAt,
    });
    await runEveryMinute();
    expect(await keysOf(user)).toEqual([`${pdf}/snapshot`]);
    const file = await api('GET', `/api/v1/links/${pdf}/snapshot/file`, { as: user.session });
    expect(await file.response.text()).toBe('%PDF-1.4');
  });
});

describe('the sweep of the copies stored before snapshots', () => {
  it('removes reader views and raw HTML, keeps PDFs and snapshots, then stops', async () => {
    const user = await signIn();
    const [page = '', pdf = '', kept = ''] = await seedLinks(user, [
      { url: 'https://page.example/' },
      { url: 'https://paper.example/a.pdf' },
      { url: 'https://kept.example/' },
    ]);
    await legacyCopies(user, page, 'html');
    await legacyCopies(user, pdf, 'pdf');
    await env.SNAPSHOTS.put(`u/${user.id}/l/${kept}/s/abc/article.json`, '{}');
    await startSweep();
    expect(await sweepLegacySnapshots(env)).toBeGreaterThanOrEqual(2);
    expect(await keysOf(user)).toEqual([`${kept}/s/abc/article.json`, `${pdf}/snapshot`].sort());
    const state = await env.DB.prepare(
      'SELECT cursor, done_at FROM maintenance_state WHERE name = ?',
    )
      .bind(LEGACY_SWEEP)
      .first<{ cursor: string | null; done_at: string | null }>();
    expect(state?.done_at).not.toBeNull();
    await legacyCopies(user, page, 'html');
    expect(await sweepLegacySnapshots(env)).toBe(0);
  });

  it('finishes on the next run when a run fails part-way', async () => {
    const user = await signIn();
    const [page = ''] = await seedLinks(user, [{ url: 'https://page.example/' }]);
    await legacyCopies(user, page, 'html');
    await startSweep();
    const failing = new Proxy(env.SNAPSHOTS, {
      get(target, prop) {
        if (prop === 'delete') return () => Promise.reject(new Error('R2 delete failed'));
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(sweepLegacySnapshots({ ...env, SNAPSHOTS: failing })).rejects.toThrow();
    expect(await keysOf(user)).toHaveLength(2);
    // Storage is shared by the tests of a file: the sweep may find others' objects too.
    expect(await sweepLegacySnapshots(env)).toBeGreaterThanOrEqual(2);
    expect(await keysOf(user)).toEqual([]);
  });
});

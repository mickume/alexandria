import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterQuery, imports, searchPath, type Stats } from '../api';
import { FakeApi, renderPage } from '../test/helpers';

afterEach(() => {
  vi.useRealTimers();
});

/** The 30 days ending 2026-11-10, each with `count(i)`. */
function series(count: (i: number) => number = () => 0) {
  return Array.from({ length: 30 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 9, 12 + i)).toISOString().slice(0, 10),
    count: count(i),
  }));
}

/** A statistics answer, with `overrides` replacing whole sections. */
function statsBody(overrides: Partial<Stats> = {}): Stats {
  return {
    library: {
      total: 812,
      by_state: { pending: 3, active: 700, unreachable: 9, expired: 61, archived: 39 },
      pinned: 12,
      in_workspace: 44,
      limit: 20000,
    },
    content: {
      by_kind: { html: 750, pdf: 40, other: 19, unfetched: 3 },
      with_snapshot: 790,
      reader_empty: 7,
    },
    topics: {
      total: 3,
      by_level: { '1': 1, '2': 1, '3': 1 },
      links_without_topic: 5,
      largest: [{ id: 't1', name: 'Testing', path: ['Software', 'Testing'], count: 20 }],
    },
    tags: {
      total: 2,
      used_once: 1,
      links_without_tags: 4,
      top: [{ id: 'g1', name: 'rust', count: 30 }],
    },
    workspaces: { total: 1, largest: [{ id: 'w1', name: 'Trip', count: 8 }] },
    hosts: { distinct: 2, top: [{ host: 'example.com', count: 31 }] },
    expiry: {
      expiring: { today: 4, within_7_days: 6, within_30_days: 25 },
      points_histogram: [
        { range: '≤0', count: 4 },
        { range: '1–7', count: 6 },
        { range: '8–30', count: 25 },
        { range: '31–60', count: 600 },
        { range: '61–90', count: 50 },
        { range: '>90', count: 15 },
      ],
      protected_at_risk: 2,
      awaiting_removal: { total: 61, within_7_days: 3, within_30_days: 10 },
      settings: { start_points: 60, remove_days: 180 },
    },
    health: {
      unreachable: { count: 9, by_reason: [{ reason: 'HTTP 503', count: 5 }] },
      dead: { count: 2, dead_over_30_days: 1 },
      enrichment: {
        no_key: 0,
        queued: 1,
        enriched: 790,
        failed: 3,
        skipped: 18,
        waiting_for_key: 0,
        none: 0,
        failed_by_reason: [{ reason: 'provider_failed', count: 3 }],
      },
      ai_key: 'verified',
    },
    backlog: {
      fetch_pending: 17,
      fetch_retrying: 1,
      enrichment_queued: 1,
      imports: [
        {
          id: 'i1',
          created_at: '2026-11-10T09:00:00.000Z',
          added: 50,
          waiting: 30,
          in_progress: 20,
          done: 0,
        },
      ],
      index_stale: 0,
      vector_deletions: 0,
      liveness_due: 5,
      throttle_clear_at: null,
    },
    activity: {
      added_per_day: series((i) => (i === 28 ? 4 : 1)),
      uses_per_day: series((i) => i % 3),
      added_last_7_days: 10,
      added_last_30_days: 33,
      most_used: [{ id: 'k1', title: 'Kept page', host: 'kept.example', uses: 9 }],
      never_used: 120,
      fetches: { ok: 40, failed: 2, failed_by_reason: [{ reason: 'HTTP 503', count: 2 }] },
      imports: [
        {
          id: 'i1',
          created_at: '2026-11-10T09:00:00.000Z',
          url_lines: 52,
          added: 50,
          duplicates: 1,
          invalid: 1,
          not_imported: 0,
        },
      ],
    },
    ...overrides,
  };
}

describe('the Stats page', () => {
  it('has its own tab between Archive and Settings, and its breadcrumb', async () => {
    renderPage(
      '/stats',
      new FakeApi().on('GET', '/api/v1/stats', { status: 200, body: statsBody() }),
    );
    await screen.findByRole('heading', { name: 'Library' });
    const nav = within(screen.getByRole('navigation', { name: 'Sections' }));
    const tabs = nav.getAllByRole('link').map((l) => l.textContent);
    expect(tabs.indexOf('Stats')).toBe(tabs.indexOf('Archive') + 1);
    expect(tabs.indexOf('Settings')).toBe(tabs.indexOf('Stats') + 1);
    expect(nav.getByRole('link', { name: 'Stats' }).getAttribute('aria-current')).toBe('page');
    expect(nav.getByRole('link', { name: 'Stats' }).getAttribute('href')).toBe('/stats');
    expect(document.querySelector('.q-breadcrumb .is-current')?.textContent).toBe('Stats');
  });

  it('loads once with a spinner, shows its sections in order, and reloads only on Refresh', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const api = new FakeApi().on('GET', '/api/v1/stats', async () => {
      await gate;
      return { status: 200, body: statsBody() };
    });
    renderPage('/stats', api);
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(document.querySelector('.q-spinner')).toBeTruthy();
    await act(async () => release());
    await screen.findByRole('heading', { name: 'Library' });
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Library', 'Expiry', 'Background work', 'Health', 'Activity']);
    const library = within(screen.getByRole('region', { name: 'Library' }));
    expect(library.getByText('812')).toBeTruthy();
    const background = within(screen.getByRole('region', { name: 'Background work' }));
    expect(background.getByText('17')).toBeTruthy();
    expect(api.sent('GET', '/api/v1/stats')).toHaveLength(1);

    vi.useFakeTimers();
    await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(api.sent('GET', '/api/v1/stats')).toHaveLength(1);
    vi.useRealTimers();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh' })));
    expect(api.sent('GET', '/api/v1/stats')).toHaveLength(2);
  });

  it('says it could not load the statistics, and tries again', async () => {
    let calls = 0;
    const api = new FakeApi().on('GET', '/api/v1/stats', () =>
      ++calls === 1
        ? { status: 500, body: { error: 'internal' } }
        : { status: 200, body: statsBody() },
    );
    renderPage('/stats', api);
    expect(await screen.findByText("Couldn't load statistics")).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Library' })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeTruthy();
  });
});

/** Renders the page with `body` and waits for its sections. */
async function show(body: Stats) {
  renderPage('/stats', new FakeApi().on('GET', '/api/v1/stats', { status: 200, body }));
  await screen.findByRole('heading', { name: 'Library' });
}

/** The table row whose header cell reads `label`, within `scope`. */
function row(label: string, scope: HTMLElement = document.body): HTMLElement {
  const header = within(scope).getByRole('rowheader', { name: label });
  return header.closest('tr') as HTMLElement;
}

describe('the Stats page’s links, charts and captions', () => {
  it('links each count to the page listing what it counts', async () => {
    await show(statsBody());
    const link = (r: HTMLElement) => within(r).getByRole('link').getAttribute('href');
    expect(link(row('Expired'))).toBe('/expired');
    expect(link(row('Archived'))).toBe('/archive');
    expect(link(row('Software › Testing'))).toBe(searchPath(filterQuery('topic', 'Testing')));
    expect(link(row('rust'))).toBe(searchPath(filterQuery('tag', 'rust')));
    expect(link(row('Trip'))).toBe('/workspaces/w1');
    const activity = screen.getByRole('region', { name: 'Activity' });
    expect(link(row('Import of 2026-11-10', activity))).toBe(imports.reportUrl('i1'));
    expect(link(row('Kept page'))).toBe('/links/k1');
  });

  it('draws the daily series and the points histogram as bar charts with their tables', async () => {
    await show(statsBody());
    const chart = screen.getByRole('img', { name: 'Added per day' });
    const bars = chart.querySelectorAll('rect');
    expect(bars).toHaveLength(30);
    expect(bars[28]!.querySelector('title')?.textContent).toBe('2026-11-09: 4');
    const figure = chart.closest('figure') as HTMLElement;
    const table = within(figure).getByRole('table', { hidden: true });
    expect(table.classList.contains('visually-hidden')).toBe(true);
    const rows = within(table).getAllByRole('row', { hidden: true }).slice(1);
    expect(rows).toHaveLength(30);
    expect(rows[28]!.textContent).toBe('2026-11-094');
    expect(screen.getByRole('img', { name: 'Uses per day' }).querySelectorAll('rect')).toHaveLength(
      30,
    );
    const histogram = screen.getByRole('img', { name: 'Points of the links decay can expire' });
    const titles = [...histogram.querySelectorAll('rect title')].map((t) => t.textContent);
    expect(titles).toEqual(['≤0: 4', '1–7: 6', '8–30: 25', '31–60: 600', '61–90: 50', '>90: 15']);
  });

  it.each([
    ['every list empty and no throttle', true, null, 'background work is idle'],
    [
      'a throttle clearing in 11 min 20 s',
      false,
      680_000,
      'background work clears in about 12 minutes',
    ],
  ])(
    'shows empty states, captions and the throttle line with %s',
    async (_, empty, clearIn, line) => {
      const body = statsBody();
      if (empty) {
        body.topics.largest = [];
        body.tags.top = [];
        body.workspaces.largest = [];
        body.activity.imports = [];
      }
      body.backlog.throttle_clear_at =
        clearIn === null ? null : new Date(Date.now() + clearIn).toISOString();
      await show(body);
      for (const text of ['No topics yet', 'No tags yet', 'No workspaces yet', 'No imports yet']) {
        expect(screen.queryByText(text) !== null).toBe(empty);
      }
      expect(screen.getByText(line)).toBeTruthy();
      const activity = within(screen.getByRole('region', { name: 'Activity' }));
      expect(activity.getAllByText('counts only links still in your library')).toHaveLength(2);
    },
  );
});

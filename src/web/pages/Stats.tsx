import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from '../App';
import {
  filterQuery,
  imports as importsApi,
  searchPath,
  stats as statsApi,
  type DayCount,
  type HistoryDay,
  type Stats as StatsAnswer,
  type StatsHistory,
} from '../api';
import { BarChart, TrendChart } from '../components/BarChart';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';

/** The caption of every series computed from the history the library keeps. */
const STILL_IN_LIBRARY = 'counts only links still in your library';

/** A whole number as the page writes it, with thousands separators. */
function num(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * One row of a section's table: what is counted, and how many. `labelTo` links
 * the label, and `to` the count, to the page listing what it counts.
 */
function Row({
  label,
  value,
  labelTo,
  to,
}: {
  label: ReactNode;
  value: ReactNode;
  labelTo?: string;
  to?: string;
}) {
  const shown = typeof value === 'number' ? num(value) : value;
  return (
    <tr>
      <th scope="row">{labelTo ? <Link to={labelTo}>{label}</Link> : label}</th>
      <td className="number">{to ? <Link to={to}>{shown}</Link> : shown}</td>
    </tr>
  );
}

/** The row a list shows when it is empty. */
function Empty({ text }: { text: string }) {
  return (
    <tr>
      <td colSpan={2} className="muted">
        {text}
      </td>
    </tr>
  );
}

/** A daily series as the chart's bars. */
function dayBars(series: DayCount[]) {
  return series.map((d) => ({ label: d.day, count: d.count }));
}

/** When background work clears, in words, from now. */
function throttleLine(clearAt: string | null): string {
  const minutes = clearAt === null ? 0 : Math.ceil((Date.parse(clearAt) - Date.now()) / 60_000);
  if (minutes <= 0) return 'background work is idle';
  return `background work clears in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/** A table of label and count rows, under an optional caption. */
function Counts({ caption, children }: { caption?: string; children: ReactNode }) {
  return (
    <table className="data-table stats-counts">
      {caption && <caption>{caption}</caption>}
      <tbody>{children}</tbody>
    </table>
  );
}

/** One section of the page: a box headed by its name, which is also the region's name. */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="stats-section" aria-labelledby={`stats-${id}`}>
      <Card className="gap-4 py-4 shadow-none">
        <CardHeader className="px-4">
          <CardTitle>
            <h2 id={`stats-${id}`} className="m-0 text-base">
              {title}
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="stats-body px-4">{children}</CardContent>
      </Card>
    </section>
  );
}

function LibrarySection({ s }: { s: StatsAnswer }) {
  const { library, content, topics, tags, workspaces, hosts } = s;
  return (
    <Section id="library" title="Library">
      <Counts caption="Links">
        <Row label="All links" value={library.total} />
        <Row label="Pending" value={library.by_state.pending} />
        <Row label="Active" value={library.by_state.active} />
        <Row label="Unreachable" value={library.by_state.unreachable} />
        <Row label="Expired" value={library.by_state.expired} to="/expired" />
        <Row label="Archived" value={library.by_state.archived} to="/archive" />
        <Row label="Pinned" value={library.pinned} />
        <Row label="In a workspace" value={library.in_workspace} />
        <Row label="Library limit" value={library.limit} />
      </Counts>
      <Counts caption="Content">
        <Row label="Web pages" value={content.by_kind.html} />
        <Row label="PDFs" value={content.by_kind.pdf} />
        <Row label="Other files" value={content.by_kind.other} />
        <Row label="Not fetched yet" value={content.by_kind.unfetched} />
        <Row label="With a snapshot" value={content.with_snapshot} />
        <Row label="Empty reader view" value={content.reader_empty} />
      </Counts>
      <Counts caption="Topics">
        <Row label="Topics" value={topics.total} />
        <Row label="Top-level topics" value={topics.by_level['1']} />
        <Row label="Second-level topics" value={topics.by_level['2']} />
        <Row label="Third-level topics" value={topics.by_level['3']} />
        <Row label="Links without a topic" value={topics.links_without_topic} />
        {topics.largest.length === 0 && <Empty text="No topics yet" />}
        {topics.largest.map((t) => (
          <Row
            key={t.id}
            label={t.path.join(' › ')}
            value={t.count}
            labelTo={searchPath(filterQuery('topic', t.name))}
          />
        ))}
      </Counts>
      <Counts caption="Tags">
        <Row label="Tags" value={tags.total} />
        <Row label="Tags on one link" value={tags.used_once} />
        <Row label="Links without tags" value={tags.links_without_tags} />
        {tags.top.length === 0 && <Empty text="No tags yet" />}
        {tags.top.map((t) => (
          <Row
            key={t.id}
            label={t.name}
            value={t.count}
            labelTo={searchPath(filterQuery('tag', t.name))}
          />
        ))}
      </Counts>
      <Counts caption="Workspaces">
        <Row label="Workspaces" value={workspaces.total} />
        {workspaces.largest.length === 0 && <Empty text="No workspaces yet" />}
        {workspaces.largest.map((w) => (
          <Row key={w.id} label={w.name} value={w.count} labelTo={`/workspaces/${w.id}`} />
        ))}
      </Counts>
      <Counts caption="Hosts">
        <Row label="Distinct hosts" value={hosts.distinct} />
        {hosts.top.map((h) => (
          <Row key={h.host} label={h.host} value={h.count} />
        ))}
      </Counts>
    </Section>
  );
}

function ExpirySection({ s }: { s: StatsAnswer }) {
  const { expiring, protected_at_risk, awaiting_removal, settings } = s.expiry;
  return (
    <Section id="expiry" title="Expiry">
      <p className="muted">
        Links start at {num(settings.start_points)} points; expired links are removed{' '}
        {num(settings.remove_days)} days after they expire.
      </p>
      <Counts caption="Expiring">
        <Row label="Expires today" value={expiring.today} />
        <Row label="Expires within 7 days" value={expiring.within_7_days} />
        <Row label="Expires within 30 days" value={expiring.within_30_days} />
        <Row label="Pinned or in a workspace, at 0 points or below" value={protected_at_risk} />
      </Counts>
      <BarChart
        title="Points of the links decay can expire"
        bars={s.expiry.points_histogram.map((r) => ({ label: r.range, count: r.count }))}
      />
      <Counts caption="Awaiting removal">
        <Row label="Expired, to be removed" value={awaiting_removal.total} />
        <Row label="Removed within 7 days" value={awaiting_removal.within_7_days} />
        <Row label="Removed within 30 days" value={awaiting_removal.within_30_days} />
      </Counts>
    </Section>
  );
}

function BacklogSection({ s }: { s: StatsAnswer }) {
  const b = s.backlog;
  return (
    <Section id="backlog" title="Background work">
      <p className="muted">{throttleLine(b.throttle_clear_at)}</p>
      <Counts>
        <Row label="Waiting to be fetched" value={b.fetch_pending} />
        <Row label="Being fetched again" value={b.fetch_retrying} />
        <Row label="Queued for enrichment" value={b.enrichment_queued} />
        <Row label="Waiting to be indexed" value={b.index_stale} />
        <Row label="Index entries to delete" value={b.vector_deletions} />
        <Row label="Due a liveness check" value={b.liveness_due} />
      </Counts>
      <Counts caption="Imports in progress">
        {b.imports.length === 0 && <Empty text="No imports in progress" />}
        {b.imports.map((i) => (
          <Row
            key={i.id}
            label={`Import of ${i.created_at.slice(0, 10)}`}
            value={`${num(i.waiting)} waiting, ${num(i.in_progress)} in progress, ${num(i.done)} done of ${num(i.added)}`}
          />
        ))}
      </Counts>
    </Section>
  );
}

function HealthSection({ s }: { s: StatsAnswer }) {
  const { unreachable, dead, enrichment, ai_key } = s.health;
  return (
    <Section id="health" title="Health">
      <Counts caption="Reachability">
        <Row label="Unreachable" value={unreachable.count} />
        {unreachable.by_reason.map((r) => (
          <Row key={r.reason} label={r.reason} value={r.count} />
        ))}
        <Row label="Failing liveness checks" value={dead.count} />
        <Row label="Dead for 30 days or more" value={dead.dead_over_30_days} />
      </Counts>
      <Counts caption="Enrichment">
        <Row label="AI key" value={ai_key === 'none' ? 'not set' : ai_key} />
        <Row label="Enriched" value={enrichment.enriched} />
        <Row label="Queued" value={enrichment.queued} />
        <Row label="Failed" value={enrichment.failed} />
        {enrichment.failed_by_reason.map((r) => (
          <Row key={r.reason} label={r.reason} value={r.count} />
        ))}
        <Row label="Skipped (nothing to read)" value={enrichment.skipped} />
        <Row label="Waiting for a working key" value={enrichment.waiting_for_key} />
        <Row label="No key" value={enrichment.no_key} />
        <Row label="Not fetched yet" value={enrichment.none} />
      </Counts>
    </Section>
  );
}

function ActivitySection({ s }: { s: StatsAnswer }) {
  const a = s.activity;
  return (
    <Section id="activity" title="Activity">
      <Counts>
        <Row label="Added in the last 7 days" value={a.added_last_7_days} />
        <Row label="Added in the last 30 days" value={a.added_last_30_days} />
        <Row label="Never used" value={a.never_used} />
        <Row label="Fetches that succeeded (30 days)" value={a.fetches.ok} />
        <Row label="Fetches that failed (30 days)" value={a.fetches.failed} />
        {a.fetches.failed_by_reason.map((r) => (
          <Row key={r.reason} label={r.reason} value={r.count} />
        ))}
      </Counts>
      <BarChart title="Added per day" bars={dayBars(a.added_per_day)} caption={STILL_IN_LIBRARY} />
      <BarChart title="Uses per day" bars={dayBars(a.uses_per_day)} caption={STILL_IN_LIBRARY} />
      <Counts caption="Most used in the last 30 days">
        {a.most_used.map((m) => (
          <Row key={m.id} label={m.title} value={m.uses} labelTo={`/links/${m.id}`} />
        ))}
      </Counts>
      <Counts caption="Imports">
        {a.imports.length === 0 && <Empty text="No imports yet" />}
        {a.imports.map((i) => (
          <tr key={i.id}>
            <th scope="row">
              <a href={importsApi.reportUrl(i.id)} download>
                Import of {i.created_at.slice(0, 10)}
              </a>
            </th>
            <td className="number">
              {num(i.added)} added of {num(i.url_lines)}
            </td>
          </tr>
        ))}
      </Counts>
    </Section>
  );
}

/** The ranges the Trends section offers, in days; the first is the default. */
const RANGES = [30, 7, 90, 365] as const;

/** A counter's value of each day, null before the record began. */
function values(days: HistoryDay[], pick: (d: HistoryDay) => number | null): (number | null)[] {
  return days.map(pick);
}

/** The sum of several counters of a day, or null when the day was not recorded. */
function sum(d: HistoryDay, keys: ('removed' | 'expired' | 'deleted')[]): number | null {
  if (d[keys[0]!] === null) return null;
  return keys.reduce((n, k) => n + (d[k] ?? 0), 0);
}

/** The range's AI usage by purpose and model: calls, input and output tokens. */
function usageTotals(days: HistoryDay[]) {
  const totals = new Map<
    string,
    { purpose: string; model: string; calls: number; input: number; output: number }
  >();
  for (const d of days) {
    for (const u of d.ai) {
      const key = `${u.purpose}\u0000${u.model}`;
      const t = totals.get(key) ?? {
        purpose: u.purpose,
        model: u.model,
        calls: 0,
        input: 0,
        output: 0,
      };
      t.calls += u.calls;
      t.input += u.input_tokens;
      t.output += u.output_tokens;
      totals.set(key, t);
    }
  }
  return [...totals.values()].sort(
    (a, b) => a.purpose.localeCompare(b.purpose) || a.model.localeCompare(b.model),
  );
}

/** The range's AI usage by purpose and model, as a table. */
function UsageTable({ days }: { days: HistoryDay[] }) {
  const totals = usageTotals(days);
  return (
    <table className="data-table stats-counts" aria-label="AI usage by purpose and model">
      <caption>AI usage by purpose and model</caption>
      <thead>
        <tr>
          <th scope="col">Purpose</th>
          <th scope="col">Model</th>
          <th scope="col" className="number">
            Calls
          </th>
          <th scope="col" className="number">
            Input tokens
          </th>
          <th scope="col" className="number">
            Output tokens
          </th>
        </tr>
      </thead>
      <tbody>
        {totals.length === 0 && <Empty text="No AI calls recorded" />}
        {totals.map((t) => (
          <tr key={`${t.purpose}-${t.model}`}>
            <td>{t.purpose}</td>
            <td>{t.model}</td>
            <td className="number">{num(t.calls)}</td>
            <td className="number">{num(t.input)}</td>
            <td className="number">{num(t.output)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The charts of the daily record. */
function TrendCharts({ h }: { h: StatsHistory }) {
  const days = h.days.map((d) => d.day);
  const unrecorded = h.recorded_since
    ? h.days.filter((d) => d.day < h.recorded_since!).length
    : h.days.length;
  const tokens = (d: HistoryDay, key: 'input_tokens' | 'output_tokens') =>
    d.added === null ? null : d.ai.reduce((n, u) => n + u[key], 0);
  const size = (state: keyof NonNullable<HistoryDay['size']>) =>
    values(h.days, (d) => d.size?.[state] ?? null);
  return (
    <>
      <TrendChart
        title="Added, and removed, expired or deleted, per day"
        days={days}
        unrecorded={unrecorded}
        series={[
          { name: 'added', values: values(h.days, (d) => d.added) },
          {
            name: 'removed, expired or deleted',
            values: values(h.days, (d) => sum(d, ['removed', 'expired', 'deleted'])),
          },
        ]}
      />
      <TrendChart
        title="Uses recorded per day"
        days={days}
        unrecorded={unrecorded}
        series={[{ name: 'uses', values: values(h.days, (d) => d.used) }]}
      />
      <TrendChart
        title="Fetch success rate per day"
        days={days}
        unrecorded={unrecorded}
        unit="%"
        series={[
          {
            name: 'succeeded',
            values: values(h.days, (d) => {
              const all = (d.fetch_ok ?? 0) + (d.fetch_failed ?? 0);
              return all === 0 ? null : Math.round(((d.fetch_ok ?? 0) / all) * 100);
            }),
          },
        ]}
      />
      <TrendChart
        title="Enrichments and questions per day"
        days={days}
        unrecorded={unrecorded}
        series={[
          { name: 'enriched', values: values(h.days, (d) => d.enriched) },
          { name: 'questions', values: values(h.days, (d) => d.asks) },
        ]}
      />
      <TrendChart
        title="Library size per day"
        days={days}
        unrecorded={unrecorded}
        kind="lines"
        series={[
          { name: 'all', values: size('total') },
          { name: 'active', values: size('active') },
          { name: 'pending', values: size('pending') },
          { name: 'unreachable', values: size('unreachable') },
          { name: 'expired', values: size('expired') },
          { name: 'archived', values: size('archived') },
        ]}
      />
      <TrendChart
        title="AI tokens per day"
        days={days}
        unrecorded={unrecorded}
        kind="stacked"
        series={[
          { name: 'input', values: values(h.days, (d) => tokens(d, 'input_tokens')) },
          { name: 'output', values: values(h.days, (d) => tokens(d, 'output_tokens')) },
        ]}
      />
      <UsageTable days={h.days} />
    </>
  );
}

/**
 * The Trends section: the daily record of a range of days, loaded on its own,
 * again when the owner picks another range, and when `reload` changes.
 */
function TrendsSection({ reload }: { reload: number }) {
  const [range, setRange] = useState<number>(RANGES[0]);
  const [history, setHistory] = useState<StatsHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    statsApi
      .history(range)
      .then((h) => {
        if (!live) return;
        setHistory(h);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [range, reload, attempt]);

  return (
    <Section id="trends" title="Trends">
      <p className="muted stats-range">
        <Label htmlFor="trends-range">Range</Label>{' '}
        <NativeSelect
          id="trends-range"
          value={range}
          onChange={(e) => setRange(Number(e.target.value))}
        >
          {[...RANGES]
            .sort((a, b) => a - b)
            .map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
        </NativeSelect>
      </p>
      {failed && (
        <Alert variant="destructive" className="notice-box">
          <p>Couldn&apos;t load trends</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </Alert>
      )}
      {history && !failed && <TrendCharts h={history} />}
      <p className="muted text-xs">includes links that have since been removed</p>
    </Section>
  );
}

/**
 * The Stats page: the owner's library statistics, loaded once when the page
 * opens and again only when the owner presses Refresh.
 */
export function Stats() {
  const [data, setData] = useState<StatsAnswer | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  /** Requests the statistics; `isLive` says whether the page still wants the answer. */
  const fetchStats = useCallback((isLive: () => boolean = () => true) => {
    statsApi
      .get()
      .then((s) => {
        if (!isLive()) return;
        setData(s);
        setFailed(false);
      })
      .catch(() => isLive() && setFailed(true))
      .finally(() => isLive() && setLoading(false));
  }, []);

  useEffect(() => {
    let live = true;
    fetchStats(() => live);
    return () => {
      live = false;
    };
  }, [fetchStats]);

  /** Loads the statistics again, as Refresh and Try again do. */
  const load = () => {
    setLoading(true);
    setFailed(false);
    setReload((n) => n + 1);
    fetchStats();
  };

  return (
    <section className="stats">
      <div className="stats-head">
        <h1 className="visually-hidden">Stats</h1>
        <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>
      {loading && !data && (
        <p className="muted" role="status">
          <Spinner className="inline" aria-hidden="true" /> Loading statistics…
        </p>
      )}
      {failed && (
        <Alert variant="destructive" className="notice-box">
          <p>Couldn&apos;t load statistics</p>
          <Button type="button" variant="outline" size="sm" onClick={load}>
            Try again
          </Button>
        </Alert>
      )}
      {data && !failed && (
        <>
          <LibrarySection s={data} />
          <ExpirySection s={data} />
          <BacklogSection s={data} />
          <HealthSection s={data} />
          <ActivitySection s={data} />
          <TrendsSection reload={reload} />
        </>
      )}
    </section>
  );
}

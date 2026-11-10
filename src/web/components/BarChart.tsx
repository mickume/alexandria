/** One bar: what it stands for (a day or a range) and its count. */
export interface Bar {
  label: string;
  count: number;
}

const WIDTH = 300;
const HEIGHT = 80;

/**
 * A bar chart drawn as inline SVG, one bar per entry, each with a tooltip of
 * its label and count; beside it, a table of the same numbers for screen
 * readers, and an optional caption below.
 */
export function BarChart({
  title,
  bars,
  caption,
}: {
  title: string;
  bars: Bar[];
  caption?: string;
}) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  const slot = WIDTH / Math.max(1, bars.length);
  const gap = Math.min(2, slot * 0.2);
  return (
    <figure className="bar-chart">
      <figcaption>{title}</figcaption>
      <svg
        role="img"
        aria-label={title}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
      >
        {bars.map((b, i) => {
          const h = (b.count / max) * HEIGHT;
          return (
            <rect key={b.label} x={i * slot + gap / 2} y={HEIGHT - h} width={slot - gap} height={h}>
              <title>{`${b.label}: ${b.count}`}</title>
            </rect>
          );
        })}
      </svg>
      <table className="visually-hidden">
        <thead>
          <tr>
            <th scope="col">{title}</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((b) => (
            <tr key={b.label}>
              <td>{b.label}</td>
              <td>{b.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {caption && <p className="muted q-text-small">{caption}</p>}
    </figure>
  );
}

/** One series of a trend chart: its name and one value per day, null where there is none. */
export interface Series {
  name: string;
  values: (number | null)[];
}

/**
 * A chart of daily series drawn as inline SVG: one group per day (bars side by
 * side, stacked bars, or a point of each line), its tooltip naming the day and
 * every series' value; the days before the record began (`unrecorded`, the
 * first days) shaded and titled "not recorded yet". A table of the same numbers
 * for screen readers is beside it.
 */
export function TrendChart({
  title,
  days,
  series,
  kind = 'bars',
  unrecorded = 0,
  unit = '',
}: {
  title: string;
  days: string[];
  series: Series[];
  kind?: 'bars' | 'stacked' | 'lines';
  unrecorded?: number;
  /** Written after each value in the tooltips and the table, such as '%'. */
  unit?: string;
}) {
  const totals = days.map((_, i) =>
    kind === 'stacked'
      ? series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)
      : Math.max(0, ...series.map((s) => s.values[i] ?? 0)),
  );
  const max = Math.max(1, ...totals);
  const slot = WIDTH / Math.max(1, days.length);
  const gap = Math.min(2, slot * 0.2);
  const y = (v: number) => HEIGHT - (v / max) * HEIGHT;
  const shown = (v: number | null) => (v === null ? '–' : `${v.toLocaleString('en-US')}${unit}`);
  return (
    <figure className="bar-chart trend-chart">
      <figcaption>{title}</figcaption>
      <svg
        role="img"
        aria-label={title}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
      >
        {unrecorded > 0 && (
          <rect
            className="not-recorded"
            data-days={unrecorded}
            x={0}
            y={0}
            width={unrecorded * slot}
            height={HEIGHT}
          >
            <title>not recorded yet</title>
          </rect>
        )}
        {kind === 'lines' &&
          series.map((s, k) => (
            <polyline
              key={s.name}
              className={`series-${k}`}
              fill="none"
              points={s.values
                .map((v, i) => (v === null ? null : `${i * slot + slot / 2},${y(v)}`))
                .filter((p) => p !== null)
                .join(' ')}
            />
          ))}
        {days.map((day, i) => {
          let base = HEIGHT;
          const width = (slot - gap) / (kind === 'bars' ? series.length : 1);
          return (
            <g key={day} className="day">
              <title>{`${day}: ${series.map((s) => `${s.name} ${shown(s.values[i] ?? null)}`).join(', ')}`}</title>
              {kind === 'lines' ? (
                <rect x={i * slot} y={0} width={slot} height={HEIGHT} className="hover-slot" />
              ) : (
                series.map((s, k) => {
                  const v = s.values[i] ?? 0;
                  const h = (v / max) * HEIGHT;
                  const x = i * slot + gap / 2 + (kind === 'bars' ? k * width : 0);
                  if (kind === 'stacked') base -= h;
                  return (
                    <rect
                      key={s.name}
                      className={`series-${k}`}
                      x={x}
                      y={kind === 'stacked' ? base : HEIGHT - h}
                      width={width}
                      height={h}
                    />
                  );
                })
              )}
            </g>
          );
        })}
      </svg>
      <table className="visually-hidden">
        <thead>
          <tr>
            <th scope="col">Day</th>
            {series.map((s) => (
              <th key={s.name} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((day, i) => (
            <tr key={day}>
              <td>{day}</td>
              {series.map((s) => (
                <td key={s.name}>{shown(s.values[i] ?? null)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {series.length > 1 && (
        <p className="legend muted q-text-small">
          {series.map((s, k) => (
            <span key={s.name} className={`legend-item series-${k}`}>
              {s.name}
            </span>
          ))}
        </p>
      )}
    </figure>
  );
}

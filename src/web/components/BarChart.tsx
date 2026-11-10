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

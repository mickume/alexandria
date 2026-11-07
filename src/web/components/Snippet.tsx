import type { Segment } from '../api';

/** A search result's snippet: its matched words marked, every segment shown as text. */
export function Snippet({ segments }: { segments: Segment[] }) {
  if (segments.length === 0) return null;
  return (
    <p className="snippet">
      {segments.map((s, i) =>
        s.match ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>,
      )}
    </p>
  );
}

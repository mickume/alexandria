/**
 * The line icons of the website, drawn as Quire asks (see src/design/README.md):
 * 24-unit paths stroked in the text colour, shown at 16 px.
 */
const PATHS = {
  stream: ['M4 6h16', 'M4 12h16', 'M4 18h10'],
  workspaces: ['M12 3 3 8l9 5 9-5-9-5Z', 'm3 13 9 5 9-5', 'm3 17.5 9 5 9-5'],
  topics: ['M9 4 7 20', 'M17 4l-2 16', 'M4 9h16', 'M3 15h16'],
  tags: ['M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z', 'M8 7.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0Z'],
  ask: [
    'M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.7-.8L3 20l1.1-5.2A8.4 8.4 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5Z',
  ],
  archive: ['M3 4h18v4H3z', 'M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8', 'M10 12h4'],
  settings: ['M4 7h10', 'M18 7h2', 'M4 17h4', 'M12 17h8', 'M16 5v4', 'M10 15v4'],
  import: ['M12 15V4', 'm7 9 5-5 5 5', 'M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4'],
  signout: ['M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4', 'M10 16l-4-4 4-4', 'M6 12h10'],
  search: ['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z', 'm20 20-4.5-4.5'],
  home: ['M4 11 12 4l8 7', 'M6 9.5V20h12V9.5'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 11v5', 'M12 8h.01'],
  alert: [
    'M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z',
    'M12 9.5v4',
    'M12 17h.01',
  ],
  pin: ['M9 4h6', 'M10 4v5l-3 4h10l-3-4V4', 'M12 13v7'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
  pulse: ['M3 12h4l3-7 4 14 3-7h4'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  link: [
    'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1',
    'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  ],
} as const;

export type IconName = keyof typeof PATHS;

/** A decorative icon: hidden from assistive technology, which reads the label beside it. */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="q-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 3.5 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Alexandria's mark: an open book cut out of a disc in the text colour. */
export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="var(--q-fg-default)" />
      <path
        d="M8 10.5c3-1.2 5.7-1 8 .8 2.3-1.8 5-2 8-.8v11c-3-1.2-5.7-1-8 .8-2.3-1.8-5-2-8-.8v-11Z"
        fill="none"
        stroke="var(--q-bg-default)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M16 11.3v11" stroke="var(--q-bg-default)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The application's clock. Every time the Worker stores or compares goes
 * through now(), so that tests can fix the time with setNow().
 */
let fixed: number | null = null;

/** The current time, or the time a test fixed with setNow(). */
export function now(): Date {
  return new Date(fixed ?? Date.now());
}

/** Fixes the clock at `t`, or lets it run again when `t` is null. */
export function setNow(t: Date | number | null): void {
  fixed = t === null ? null : typeof t === 'number' ? t : t.getTime();
}

/** Moves a fixed clock forward by `ms` milliseconds. */
export function advance(ms: number): void {
  fixed = now().getTime() + ms;
}

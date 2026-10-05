/**
 * Day arithmetic for transition planning.
 *
 * Every date is a UTC calendar day, and every "now" is
 * `dataset.metadata.planningNow` — never the machine clock — so the same
 * dataset produces the same stockout dates on every machine and every day.
 */

export const dayMs = 86_400_000;

/** Milliseconds for the UTC midnight of an ISO date or datetime. */
export function parseDay(iso: string): number {
  const day = iso.slice(0, 10);
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : NaN;
}

/** `YYYY-MM-DD` for an ISO date or datetime. */
export function toDay(iso: string): string {
  return iso.slice(0, 10);
}

export function addDaysTo(iso: string, days: number): string {
  const base = parseDay(iso);
  if (!Number.isFinite(base)) return toDay(iso);
  return new Date(base + Math.round(days) * dayMs).toISOString().slice(0, 10);
}

export function addWeeksTo(iso: string, weeks: number): string {
  return addDaysTo(iso, weeks * 7);
}

/** Whole and fractional weeks from `from` to `to`. Negative when `to` is earlier. */
export function weeksFrom(from: string, to: string): number {
  return (parseDay(to) - parseDay(from)) / (7 * dayMs);
}

export function daysFrom(from: string, to: string): number {
  return Math.round((parseDay(to) - parseDay(from)) / dayMs);
}

/** `YYYY-MM` of a date. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** First day of a `YYYY-MM` month shifted by `delta` months. */
export function monthStart(month: string, delta = 0): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + delta;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
}

/** Last day of a `YYYY-MM` month. */
export function monthEnd(month: string): string {
  return addDaysTo(monthStart(month, 1), -1);
}

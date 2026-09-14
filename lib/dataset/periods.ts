/**
 * Period and month arithmetic.
 *
 * The only place allowed to interpret a `PeriodKey`. Two shapes are legal:
 * a calendar month (`2027-06`) and a program key (`2027-Halloween`).
 */

import type { MonthKey, PeriodKey } from "@/types/dataset";
import type { DateRange } from "@/types/shared";

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const PROGRAM_KEY = /^(\d{4})-(.+)$/;

export function isMonthKey(period: PeriodKey): period is MonthKey {
  return MONTH_KEY.test(period);
}

/** The year a period belongs to, or undefined when it carries none. */
export function periodYear(period: PeriodKey): number | undefined {
  const m = PROGRAM_KEY.exec(period);
  return m?.[1] ? Number(m[1]) : undefined;
}

/**
 * The part of a period key that identifies the program rather than the year —
 * `2027-Halloween` and `2026-Halloween` share the label "halloween". This is
 * how a prior season is recognised as comparable to the current one.
 */
export function programLabel(period: PeriodKey): string | undefined {
  if (isMonthKey(period)) return undefined;
  const m = PROGRAM_KEY.exec(period);
  if (!m?.[2]) return undefined;
  return m[2].trim().toLowerCase();
}

/**
 * Normalises an event name to a comparable label by dropping the year:
 * "Halloween 2026" -> "halloween".
 */
export function eventLabel(eventOrProgram: string): string {
  return eventOrProgram
    .replace(/\b(19|20)\d{2}\b/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Whether two periods describe the same program in different years. */
export function isComparablePeriod(a: PeriodKey, b: PeriodKey): boolean {
  const la = programLabel(a);
  const lb = programLabel(b);
  if (la !== undefined && lb !== undefined) return la === lb;
  return false;
}

export function monthKeyOf(isoDate: string): MonthKey {
  return isoDate.slice(0, 7);
}

export function addMonths(month: MonthKey, delta: number): MonthKey {
  const m = MONTH_KEY.exec(month);
  if (!m?.[1] || !m[2]) return month;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  const year = Math.floor(total / 12);
  const idx = total % 12;
  return `${year}-${String(idx + 1).padStart(2, "0")}`;
}

/** Inclusive list of months a date range covers. */
export function monthsBetween(range: DateRange): MonthKey[] {
  const out: MonthKey[] = [];
  let cursor = monthKeyOf(range.start);
  const end = monthKeyOf(range.end);
  // Guard against a malformed range spinning forever.
  for (let i = 0; i < 240 && cursor <= end; i += 1) {
    out.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return out;
}

/**
 * Splits a date range into per-month weights proportional to the number of
 * days the range occupies in each month, so load lands where production
 * actually happens rather than being smeared evenly.
 */
export function monthWeights(range: DateRange): Map<MonthKey, number> {
  const weights = new Map<MonthKey, number>();
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Date.parse(`${range.end}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return weights;

  let total = 0;
  for (const month of monthsBetween(range)) {
    const days = overlapDays(month, start, end);
    if (days > 0) {
      weights.set(month, days);
      total += days;
    }
  }
  if (total === 0) return weights;
  for (const [month, days] of weights) weights.set(month, days / total);
  return weights;
}

function overlapDays(month: MonthKey, startMs: number, endMs: number): number {
  const m = MONTH_KEY.exec(month);
  if (!m?.[1] || !m[2]) return 0;
  const year = Number(m[1]);
  const idx = Number(m[2]) - 1;
  const monthStart = Date.UTC(year, idx, 1);
  const monthEnd = Date.UTC(year, idx + 1, 0);
  const from = Math.max(monthStart, startMs);
  const to = Math.min(monthEnd, endMs);
  if (to < from) return 0;
  return (to - from) / 86_400_000 + 1;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso.length > 10 ? fromIso : `${fromIso}T00:00:00Z`);
  const to = Date.parse(toIso.length > 10 ? toIso : `${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

export function weeksBetween(fromIso: string, toIso: string): number {
  return Math.floor(daysBetween(fromIso, toIso) / 7);
}

export function addDays(isoDate: string, days: number): string {
  const base = Date.parse(isoDate.length > 10 ? isoDate : `${isoDate}T00:00:00Z`);
  if (!Number.isFinite(base)) return isoDate;
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/** The union of a set of ranges, or undefined when there are none. */
export function unionRange(ranges: readonly (DateRange | undefined)[]): DateRange | undefined {
  const present = ranges.filter((r): r is DateRange => r !== undefined);
  if (present.length === 0) return undefined;
  let start = present[0]!.start;
  let end = present[0]!.end;
  for (const r of present) {
    if (r.start < start) start = r.start;
    if (r.end > end) end = r.end;
  }
  return { start, end };
}

/** Shifts a range forward by whole years — how a prior season maps to this one. */
export function shiftYears(range: DateRange, years: number): DateRange {
  return { start: shiftYear(range.start, years), end: shiftYear(range.end, years) };
}

function shiftYear(isoDate: string, years: number): string {
  const year = Number(isoDate.slice(0, 4));
  if (!Number.isFinite(year)) return isoDate;
  const target = year + years;
  // 29 February has no counterpart in a common year. It maps to the 28th —
  // still the last day of February, and still inside the same month, so the
  // season's month weights do not shift.
  if (isoDate.slice(4, 10) === "-02-29" && !isLeapYear(target)) {
    return `${target}-02-28${isoDate.slice(10)}`;
  }
  return `${target}${isoDate.slice(4)}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function formatMonthLabel(month: MonthKey): string {
  const m = MONTH_KEY.exec(month);
  if (!m?.[1] || !m[2]) return month;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m[2]) - 1] ?? month} ${m[1].slice(2)}`;
}

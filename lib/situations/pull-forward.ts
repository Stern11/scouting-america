/**
 * Pulling production forward (V2 §46, PRD §14.4, §7.9).
 *
 * The lever a capacity planner reaches for first: "if a line is overloaded,
 * build some of that production in an earlier month with room." One number per
 * line — how many weeks a build may move earlier. Never later: building later
 * lands production in (or after) the sales window, which is not a capacity
 * fix. This is a pure levelling pass over one line's monthly load — it never
 * touches a dataset or a scenario override, and is recomputed on every read
 * (V2 §53).
 *
 * Cascading levelling. Months are processed latest first. A month's overflow
 * moves into the nearest earlier month within reach. When that month has no
 * room, its own movable load first shifts further back to make room — a chain.
 * So a July overflow can be freed by building May's items in April, June's in
 * May and July's in June, even though no single build moves more than the
 * window allows.
 *
 * Invariants:
 * - Only movable (carry-forward) lots move; fixed (formal) load never does.
 * - A lot never lands more than `reach` months before the month it came from.
 * - Nothing lands before the first month in the series, nor before
 *   `earliestPeriod` (today's month).
 * - Hours are only moved, never created or lost.
 * - Headroom is measured against available hours (100%), not the target: the
 *   target is a planning buffer, and building into it is a legitimate choice.
 */

import type { MonthKey } from "@/types/dataset";
import { addMonths } from "@/lib/dataset/periods";

const AVG_WEEKS_PER_MONTH = 4.345;
const EPS = 1e-9;

/** The furthest a build can be pulled forward, in weeks. */
export const MAX_MOVE_WEEKS = 8;

export type MoveDirection = "earlier" | "none";

/** A movable piece of a month's load — one SKU's carry-forward hours. */
export interface LevelLot {
  key: string;
  hours: number;
}

export interface LevelMonthInput {
  period: MonthKey;
  /** Load that never moves (the formal plan). */
  fixedHours: number;
  /** Load that may be pulled forward, by SKU. */
  lots: readonly LevelLot[];
  availableHours: number;
}

export interface LevelMonth {
  period: MonthKey;
  loadBeforeHours: number;
  availableHours: number;
  /** Hours whose build moved out of this month into an earlier one. */
  movedOutHours: number;
  /** Hours pulled into this month from later months. */
  movedInHours: number;
  /** loadBeforeHours − movedOutHours + movedInHours. */
  loadAfterHours: number;
  overflowBeforeHours: number;
  /** What is still over capacity after moving — "additional hours needed". */
  overflowAfterHours: number;
}

/** One lot's net move: from the month it was planned in to where it is built. */
export interface LoadMove {
  key: string;
  from: MonthKey;
  to: MonthKey;
  hours: number;
}

export interface LevelResult {
  weeks: number;
  direction: MoveDirection;
  months: LevelMonth[];
  moves: LoadMove[];
  totalMovedHours: number;
  totalOverflowBeforeHours: number;
  totalOverflowAfterHours: number;
}

/** Weeks converted to whole months, since load is monthly. Zero stays zero. */
export function monthsFor(weeks: number): number {
  if (weeks <= 0) return 0;
  return Math.max(1, Math.round(weeks / AVG_WEEKS_PER_MONTH));
}

interface Holding {
  key: string;
  origin: number;
  hours: number;
}

export function levelLoad(
  input: readonly LevelMonthInput[],
  weeks: number,
  options: { earliestPeriod?: MonthKey } = {}
): LevelResult {
  const ordered = [...input].sort((a, b) => a.period.localeCompare(b.period));
  const reach = monthsFor(weeks);
  const n = ordered.length;
  const periods = ordered.map((m) => m.period);
  const indexOf = new Map(periods.map((p, i) => [p, i]));

  const loadBefore = ordered.map((m) => m.fixedHours + m.lots.reduce((s, l) => s + l.hours, 0));
  const load = [...loadBefore];
  // What each month currently builds, by lot and the month it was planned in.
  const holdings: Holding[][] = ordered.map((m, i) =>
    m.lots.filter((l) => l.hours > EPS).map((l) => ({ key: l.key, origin: i, hours: l.hours }))
  );

  // The earliest index anything may land in.
  const earliest = options.earliestPeriod;
  const firstAllowed = earliest === undefined ? 0 : periods.findIndex((p) => p >= earliest);
  const floorIndex = firstAllowed < 0 ? n : firstAllowed;

  // Months that could not free what was asked. What a month can free never
  // grows as the pass runs — moves only use up earlier headroom — so a month
  // exhausted once stays exhausted.
  const exhausted = new Set<number>();

  /** Moves up to `need` hours of month i's movable load earlier. Returns hours moved. */
  const pushBack = (i: number, need: number): number => {
    if (need <= EPS || reach === 0 || exhausted.has(i)) return 0;
    let moved = 0;
    for (let k = 1; k <= reach && need - moved > EPS; k++) {
      const targetPeriod = addMonths(periods[i]!, -k);
      const j = indexOf.get(targetPeriod);
      if (j === undefined) {
        if (targetPeriod < periods[0]!) break;
        continue; // a gap in the series — try the next month out
      }
      if (j < floorIndex) break;

      const eligible = holdings[i]!.filter((h) => h.origin - j <= reach && h.hours > EPS);
      const eligibleHours = eligible.reduce((s, h) => s + h.hours, 0);
      const want = Math.min(need - moved, eligibleHours);
      if (want <= EPS) continue;

      // Room is never negative: an earlier month that is itself over keeps its
      // own overflow for its own turn, so later months get first claim.
      let room = Math.max(0, ordered[j]!.availableHours - load[j]!);
      if (room < want - EPS) room += pushBack(j, want - room);
      const take = Math.min(want, room);
      if (take <= EPS) continue;

      // Largest builds first: fewer, whole SKUs are easier to act on than
      // slivers of many.
      let left = take;
      for (const h of [...eligible].sort((a, b) => b.hours - a.hours || a.key.localeCompare(b.key))) {
        if (left <= EPS) break;
        const part = Math.min(h.hours, left);
        h.hours -= part;
        left -= part;
        const into = holdings[j]!.find((x) => x.key === h.key && x.origin === h.origin);
        if (into) into.hours += part;
        else holdings[j]!.push({ key: h.key, origin: h.origin, hours: part });
      }
      load[i] = load[i]! - take;
      load[j] = load[j]! + take;
      moved += take;
    }
    if (need - moved > EPS) exhausted.add(i);
    return moved;
  };

  for (let i = n - 1; i >= 0; i--) {
    const overflow = load[i]! - ordered[i]!.availableHours;
    if (overflow > EPS) pushBack(i, overflow);
  }

  // Net moves: each lot, from the month it was planned in to where it is built.
  const moves: LoadMove[] = [];
  const movedOut = new Array<number>(n).fill(0);
  const movedIn = new Array<number>(n).fill(0);
  for (let j = 0; j < n; j++) {
    for (const h of holdings[j]!) {
      if (h.origin === j || h.hours <= EPS) continue;
      moves.push({ key: h.key, from: periods[h.origin]!, to: periods[j]!, hours: h.hours });
      movedOut[h.origin] = movedOut[h.origin]! + h.hours;
      movedIn[j] = movedIn[j]! + h.hours;
    }
  }
  moves.sort((a, b) => b.from.localeCompare(a.from) || b.to.localeCompare(a.to) || b.hours - a.hours);

  const months: LevelMonth[] = ordered.map((m, i) => {
    const after = loadBefore[i]! - movedOut[i]! + movedIn[i]!;
    return {
      period: m.period,
      loadBeforeHours: loadBefore[i]!,
      availableHours: m.availableHours,
      movedOutHours: movedOut[i]!,
      movedInHours: movedIn[i]!,
      loadAfterHours: after,
      overflowBeforeHours: Math.max(0, loadBefore[i]! - m.availableHours),
      overflowAfterHours: Math.max(0, after - m.availableHours),
    };
  });

  const totalMovedHours = moves.reduce((s, x) => s + x.hours, 0);
  return {
    weeks,
    direction: totalMovedHours > EPS ? "earlier" : "none",
    months,
    moves,
    totalMovedHours,
    totalOverflowBeforeHours: months.reduce((s, m) => s + m.overflowBeforeHours, 0),
    totalOverflowAfterHours: months.reduce((s, m) => s + m.overflowAfterHours, 0),
  };
}

/**
 * The per-programme readiness curve (V2 §39, feedback: "for every season,
 * show where we were last year, where we are this year, how long is left, and
 * how far behind that puts us in revenue").
 *
 * Measured as the share of the season's expected business *value* already in
 * the formal plan — not a count of items. A missing seasonal hero and a
 * missing filler SKU are one item each, but not the same risk.
 *
 * Never fabricated:
 *
 * - "Today" is `bridge.representedPct` — formal value over expected value, the
 *   same figure every other page reads.
 * - "Last year" and this year's earlier checkpoints come from
 *   `Readiness_History`. When it is absent, the curve is unavailable, exactly
 *   like `capacityUnavailable`/`materialsUnavailable` elsewhere. Last year is
 *   only read between checkpoints that exist — never extrapolated past them.
 * - The lateness gap is arithmetic on those two, and says nothing when either
 *   side is missing.
 * - The "one thing that could keep this from running" reuses the same BOM
 *   explosion and lead-time statistics `build.ts` computes for settled items,
 *   applied to the candidates that are *not yet* represented.
 */

import { addDays, isComparablePeriod, weeksBetween } from "@/lib/dataset/periods";
import { blendAnalogueBoms } from "./analogues";
import { leadTimeStats } from "./build";
import type { BomRow, PlanningDataset } from "@/types/dataset";
import type { PlanningSituation } from "@/types/situation";

export interface ReadinessPoint {
  weeksBeforeProductionStart: number;
  /** Share of expected value in the formal plan, 0-1. */
  representedPct: number;
}

export interface ConstrainingMaterial {
  materialId: string;
  materialName: string;
  leadTimeDays: number;
  decisionDate: string;
  weeksToDecision: number;
  /** How many of the situation's unrepresented items need this component. */
  itemCount: number;
}

/**
 * How far behind last year's pace this season is, in points of expected value
 * (fractions: 0.12 is 12 points). Each field is undefined when the history it
 * needs does not exist.
 */
export interface ReadinessLateness {
  /** This year minus last year at the same week. Negative is behind. */
  gapPts?: number;
  /** Points still to add by the deadline to stand where last year stood then. */
  neededPts?: number;
  /** `neededPts` of this season's expected value. Zero when nothing is needed. */
  neededValue?: number;
  /** Points last year actually added over the same weeks. */
  lastYearGainedPts?: number;
  /** Weeks from today to the deadline. */
  weeksLeft?: number;
  currency: string;
}

export interface ReadinessCurve {
  situationId: string;
  situationTitle: string;

  /** planningNow — for the chart to position "today" without recomputing it. */
  today: string;
  productionStart?: string;

  /** `bridge.representedPct` — never estimated for this chart. */
  todayPct?: number;
  todayWeeksBeforeProduction?: number;

  /** From Readiness_History, filtered to this situation's own period. */
  currentSeasonHistory: ReadinessPoint[];
  /** This season's checkpoints before today, joined to today's live figure. */
  currentSeasonPace: ReadinessPoint[];
  /** From Readiness_History, filtered to the most recent comparable prior period. */
  priorSeasonPace: ReadinessPoint[];
  historyAvailable: boolean;
  historyUnavailableReason?: string;

  dropDeadDate?: string;
  dropDeadLabel?: string;
  runwayWeeks?: number;
  /** Where the deadline sits on the axis. */
  dropDeadWeeksBeforeProduction?: number;
  /** Today to the deadline — the green zone. Undefined once the deadline has passed. */
  weeksLeft?: number;
  /** Deadline to production start — the red zone. */
  leadTimeWeeks?: number;

  /** Last year's share at today's week, and at the deadline's. */
  lastYearAtToday?: number;
  lastYearAtDeadline?: number;
  lateness?: ReadinessLateness;

  /** The widest span worth drawing the axis over, in weeks before production. */
  horizonWeeks: number;

  constrainingMaterial?: ConstrainingMaterial;
}

function sortByWeeksDescending(points: ReadinessPoint[]): ReadinessPoint[] {
  return [...points].sort((a, b) => b.weeksBeforeProductionStart - a.weeksBeforeProductionStart);
}

/**
 * Linear interpolation along a curve sorted by descending weeks-before.
 * Undefined outside the checkpoints that exist — a value before the first
 * snapshot or after the last is not something history measured.
 */
export function interpolateReadiness(points: readonly ReadinessPoint[], weeks: number): number | undefined {
  if (points.length === 0) return undefined;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (weeks > first.weeksBeforeProductionStart || weeks < last.weeksBeforeProductionStart) return undefined;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (weeks <= a.weeksBeforeProductionStart && weeks >= b.weeksBeforeProductionStart) {
      const span = a.weeksBeforeProductionStart - b.weeksBeforeProductionStart;
      const t = span > 0 ? (a.weeksBeforeProductionStart - weeks) / span : 0;
      return a.representedPct + (b.representedPct - a.representedPct) * t;
    }
  }
  return first.representedPct;
}

/** The lateness arithmetic, on its own so it can be checked with plain numbers. */
export function computeReadinessLateness(input: {
  todayPct?: number;
  lastYearAtToday?: number;
  lastYearAtDeadline?: number;
  weeksLeft?: number;
  expectedValue: number;
  currency: string;
}): ReadinessLateness | undefined {
  const { todayPct, lastYearAtToday, lastYearAtDeadline, weeksLeft, expectedValue, currency } = input;
  if (todayPct === undefined) return undefined;

  const gapPts = lastYearAtToday !== undefined ? todayPct - lastYearAtToday : undefined;
  const deadlineAhead = weeksLeft !== undefined && weeksLeft >= 0;
  const neededPts = deadlineAhead && lastYearAtDeadline !== undefined ? lastYearAtDeadline - todayPct : undefined;
  const lastYearGainedPts =
    neededPts !== undefined && lastYearAtToday !== undefined ? lastYearAtDeadline! - lastYearAtToday : undefined;

  if (gapPts === undefined && neededPts === undefined) return undefined;
  return {
    gapPts,
    neededPts,
    neededValue: neededPts !== undefined ? Math.max(0, neededPts) * expectedValue : undefined,
    lastYearGainedPts,
    weeksLeft: deadlineAhead ? weeksLeft : undefined,
    currency,
  };
}

/** The most recent comparable prior period among this situation's own candidates. */
function priorSeasonPeriod(situation: PlanningSituation): string | undefined {
  let best: string | undefined;
  for (const candidate of situation.candidateItems) {
    const period = candidate.historicalPeriod;
    if (!isComparablePeriod(period, situation.planningPeriod)) continue;
    if (!best || period > best) best = period;
  }
  return best;
}

/**
 * The single tightest material deadline among the situation's *unrepresented*
 * candidates — the thing that could stop one of them from being ready even if
 * the planner commits to it today. Deliberately not scoped to carry-forward
 * items only: those already have a material picture on Reconcile and
 * Materials. This is about what is still missing.
 */
function findConstrainingMaterial(
  situation: PlanningSituation,
  dataset: PlanningDataset
): ConstrainingMaterial | undefined {
  const unrepresented = situation.candidateItems.filter((c) => c.match.matchedItemId === undefined);
  if (unrepresented.length === 0) return undefined;

  const productionStart = situation.productionWindow?.start;
  if (!productionStart) return undefined;

  const bomByParent = new Map<string, BomRow[]>();
  for (const row of dataset.boms) {
    const list = bomByParent.get(row.parentItemId);
    if (list) list.push(row);
    else bomByParent.set(row.parentItemId, [row]);
  }

  const leadTimes = leadTimeStats(dataset);
  const itemCountByMaterial = new Map<string, { name: string; leadTimeDays: number; count: number }>();

  for (const candidate of unrepresented) {
    const own = bomByParent.get(candidate.itemId);
    const lines = own ?? blendAnalogueBoms(candidate.analogues, bomByParent);
    for (const line of lines) {
      const lead = leadTimes.get(line.componentId);
      if (!lead) continue;
      const existing = itemCountByMaterial.get(line.componentId);
      if (existing) existing.count += 1;
      else itemCountByMaterial.set(line.componentId, { name: line.componentName, leadTimeDays: lead.days, count: 1 });
    }
  }

  let worst: ConstrainingMaterial | undefined;
  for (const [materialId, entry] of itemCountByMaterial) {
    const decisionDate = addDays(productionStart, -entry.leadTimeDays);
    if (!worst || decisionDate < worst.decisionDate) {
      worst = {
        materialId,
        materialName: entry.name,
        leadTimeDays: entry.leadTimeDays,
        decisionDate,
        weeksToDecision: weeksBetween(dataset.metadata.planningNow, decisionDate),
        itemCount: entry.count,
      };
    }
  }
  return worst;
}

export function buildReadinessCurve(situation: PlanningSituation, dataset: PlanningDataset): ReadinessCurve {
  const now = dataset.metadata.planningNow;
  const productionStart = situation.productionWindow?.start;

  const todayPct = situation.bridge.expectedValue > 0 ? situation.bridge.representedPct : undefined;
  const todayWeeksBeforeProduction = productionStart ? weeksBetween(now, productionStart) : undefined;

  const historyAvailable = dataset.metadata.capabilities.readinessHistory;
  const currentSeasonHistory = historyAvailable
    ? sortByWeeksDescending(
        dataset.readinessHistory
          .filter((r) => r.seasonPeriod === situation.planningPeriod)
          .map((r) => ({ weeksBeforeProductionStart: r.weeksBeforeProductionStart, representedPct: r.representedPct }))
      )
    : [];

  const priorPeriod = priorSeasonPeriod(situation);
  const priorSeasonPace =
    historyAvailable && priorPeriod
      ? sortByWeeksDescending(
          dataset.readinessHistory
            .filter((r) => r.seasonPeriod === priorPeriod)
            .map((r) => ({ weeksBeforeProductionStart: r.weeksBeforeProductionStart, representedPct: r.representedPct }))
        )
      : [];

  // This year's line: only checkpoints before today — a snapshot dated after
  // today is not a snapshot — ending on the live figure.
  const currentSeasonPace =
    todayPct !== undefined && todayWeeksBeforeProduction !== undefined && currentSeasonHistory.length > 0
      ? [
          ...currentSeasonHistory.filter((p) => p.weeksBeforeProductionStart > todayWeeksBeforeProduction),
          { weeksBeforeProductionStart: todayWeeksBeforeProduction, representedPct: todayPct },
        ]
      : [];

  const horizonWeeks = Math.max(
    1,
    todayWeeksBeforeProduction ?? 0,
    ...currentSeasonHistory.map((p) => p.weeksBeforeProductionStart),
    ...priorSeasonPace.map((p) => p.weeksBeforeProductionStart)
  );

  const earliest = situation.runway.earliest;
  const dropDeadWeeksBeforeProduction =
    earliest && productionStart ? weeksBetween(earliest.date, productionStart) : undefined;
  const weeksLeft =
    todayWeeksBeforeProduction !== undefined &&
    dropDeadWeeksBeforeProduction !== undefined &&
    todayWeeksBeforeProduction >= dropDeadWeeksBeforeProduction
      ? todayWeeksBeforeProduction - dropDeadWeeksBeforeProduction
      : undefined;
  const leadTimeWeeks =
    dropDeadWeeksBeforeProduction !== undefined && dropDeadWeeksBeforeProduction >= 0
      ? dropDeadWeeksBeforeProduction
      : undefined;

  const lastYearAtToday =
    todayWeeksBeforeProduction !== undefined ? interpolateReadiness(priorSeasonPace, todayWeeksBeforeProduction) : undefined;
  const lastYearAtDeadline =
    dropDeadWeeksBeforeProduction !== undefined
      ? interpolateReadiness(priorSeasonPace, dropDeadWeeksBeforeProduction)
      : undefined;

  return {
    situationId: situation.id,
    situationTitle: situation.title,
    today: now,
    productionStart,
    todayPct,
    todayWeeksBeforeProduction,
    currentSeasonHistory,
    currentSeasonPace,
    priorSeasonPace,
    historyAvailable,
    historyUnavailableReason: historyAvailable
      ? undefined
      : "Add weekly readiness history to see this season's pace against last year's.",
    dropDeadDate: earliest?.date,
    dropDeadLabel: earliest?.label,
    runwayWeeks: situation.runway.weeksOfRunway,
    dropDeadWeeksBeforeProduction,
    weeksLeft,
    leadTimeWeeks,
    lastYearAtToday,
    lastYearAtDeadline,
    lateness: computeReadinessLateness({
      todayPct,
      lastYearAtToday,
      lastYearAtDeadline,
      weeksLeft,
      expectedValue: situation.bridge.expectedValue,
      currency: situation.bridge.currency,
    }),
    horizonWeeks,
    constrainingMaterial: findConstrainingMaterial(situation, dataset),
  };
}

/**
 * Demand continuity: the demand did not begin when the SKU number changed.
 *
 * The method, in the order it is shown to a planner:
 *
 *   legacy units, last 52 weeks      × share of demand that transfers
 * + successor units, last 52 weeks
 * = continuity baseline (annual)
 * × year-over-year trend of the combined lineage
 * × (1 + planner / scenario adjustment)
 * = expected annual demand
 * × seasonality of the coming horizon (from last year's same weeks)
 * = expected demand over the replenishment horizon
 *
 * Why this does not double count: a customer who bought the legacy shirt in
 * March and one who bought the successor in September are two purchases of
 * the same business requirement, and each is counted once — in the week it
 * happened. What double counting looks like is carrying the legacy SKU's full
 * annual history forward *and* adding a successor forecast on top as if it
 * were incremental. Successor sales here are never projected separately; they
 * are simply the part of the one stream that has already moved.
 *
 * Many-to-one sums the predecessors: they were separate purchases that now
 * converge on one SKU. One-to-many divides the stream across successors by
 * share — the shares sum to one, so the predecessor's demand is split, never
 * copied into each successor.
 */

import type { DemandContinuity, MonthlyLineagePoint, YearlySales } from "@/types/transition";
import { RECENT_WEEKS, clamp } from "./assumptions";
import type { SalesIndex } from "./sales";
import { addDaysTo, monthEnd, monthOf, monthStart, parseDay } from "./time";

export interface ContinuityInput {
  predecessorSkuIds: readonly string[];
  successorSkuIds: readonly string[];
  sales: SalesIndex;
  planningNow: string;
  horizonWeeks: number;
  transferredDemandPct: number;
  demandAdjustmentPct: number;
  demandOverrideUnits?: number;
  /** ONE_TO_MANY shares, by successor. Normalised here. */
  successorSplit?: Record<string, number>;
}

const TREND_FLOOR = 0.8;
const TREND_CEILING = 1.25;

function sumUnits(sales: SalesIndex, skuIds: readonly string[], from: string, to: string): number {
  let total = 0;
  for (const id of skuIds) total += sales.networkUnits(id, from, to);
  return total;
}

export function calculateContinuityDemand(input: ContinuityInput): DemandContinuity {
  const { sales, planningNow: now, predecessorSkuIds: pred, successorSkuIds: succ } = input;
  const horizonWeeks = Math.max(1, input.horizonWeeks);

  const l52Start = addDaysTo(now, -364);
  const p52Start = addDaysTo(now, -728);
  const legacyL52 = sumUnits(sales, pred, l52Start, now);
  const successorL52 = sumUnits(sales, succ, l52Start, now);
  const legacyP52 = sumUnits(sales, pred, p52Start, l52Start);
  const successorP52 = sumUnits(sales, succ, p52Start, l52Start);

  const transfer = clamp(input.transferredDemandPct, 0, 1);
  const baselineAnnual = legacyL52 * transfer + successorL52;
  const priorAnnual = legacyP52 * transfer + successorP52;
  const trendFactor = priorAnnual > 0 ? clamp(baselineAnnual / priorAnnual, TREND_FLOOR, TREND_CEILING) : 1;
  const expectedAnnual = baselineAnnual * trendFactor * (1 + input.demandAdjustmentPct);

  // Seasonality: what share of last year's lineage units fell in the same
  // weeks the horizon covers this year. Needs a full year of history;
  // without it, a flat run rate is assumed and the page says so.
  const all = [...pred, ...succ];
  const firstDays = all.map((id) => sales.firstSaleDay(id)).filter((d): d is string => d !== undefined);
  const earliest = firstDays.length > 0 ? firstDays.reduce((a, b) => (a < b ? a : b)) : undefined;
  const hasYear = earliest !== undefined && parseDay(earliest) <= parseDay(l52Start);
  const flatShare = horizonWeeks / 52;
  let seasonalityFactor = 1;
  let seasonalityBasis: DemandContinuity["seasonalityBasis"] = "flat";
  if (hasYear) {
    const yearAgoHorizon = sumUnits(sales, all, l52Start, addDaysTo(l52Start, horizonWeeks * 7));
    const lastYear = sumUnits(sales, all, l52Start, now);
    if (lastYear > 0) {
      seasonalityFactor = clamp(yearAgoHorizon / lastYear / flatShare, 0.4, 2.5);
      seasonalityBasis = "history";
    }
  }

  const calculatedHorizonUnits = Math.round(expectedAnnual * flatShare * seasonalityFactor);
  const overridden = input.demandOverrideUnits !== undefined;
  const horizonUnits = overridden ? Math.round(input.demandOverrideUnits ?? 0) : calculatedHorizonUnits;

  // Recent mix — how far the stream has already moved to the successor.
  const recentStart = addDaysTo(now, -RECENT_WEEKS * 7);
  const recentLegacy = sumUnits(sales, pred, recentStart, now);
  const recentSuccessor = sumUnits(sales, succ, recentStart, now);
  const recentTotal = recentLegacy + recentSuccessor;
  const transitionProgress =
    succ.length === 0 ? 0 : pred.length === 0 ? 1 : recentTotal > 0 ? recentSuccessor / recentTotal : 0;

  return {
    available: legacyL52 + successorL52 > 0 || overridden,
    legacyUnitsL52: Math.round(legacyL52),
    successorUnitsL52: Math.round(successorL52),
    transferredDemandPct: transfer,
    baselineAnnualUnits: Math.round(baselineAnnual),
    trendFactor,
    demandAdjustmentPct: input.demandAdjustmentPct,
    expectedAnnualUnits: Math.round(expectedAnnual),
    horizonWeeks,
    seasonalityFactor,
    seasonalityBasis,
    horizonUnits,
    calculatedHorizonUnits,
    overridden,
    weeklyUnits: horizonUnits / horizonWeeks,
    bySuccessor: splitAcrossSuccessors(succ, horizonUnits, input.successorSplit, sales, recentStart, now),
    yearly: yearlySales(sales, pred, succ, now),
    monthly: monthlySeries(sales, pred, succ, now, 24),
    transitionProgress,
  };
}

/**
 * Divides horizon demand across successors. Explicit shares win; otherwise
 * each successor's recent share of successor sales; otherwise equal. Always
 * normalised, so the parts add back to the whole.
 */
export function splitAcrossSuccessors(
  successorIds: readonly string[],
  horizonUnits: number,
  explicit: Record<string, number> | undefined,
  sales: SalesIndex,
  from: string,
  to: string
): DemandContinuity["bySuccessor"] {
  if (successorIds.length === 0) return [];
  let weights = successorIds.map((id) => Math.max(0, explicit?.[id] ?? 0));
  if (weights.every((w) => w === 0)) weights = successorIds.map((id) => sales.networkUnits(id, from, to));
  if (weights.every((w) => w === 0)) weights = successorIds.map(() => 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => w / total);

  // Largest-remainder rounding, so the integer parts sum to the whole.
  const raw = shares.map((s) => s * horizonUnits);
  const floors = raw.map(Math.floor);
  let remainder = horizonUnits - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    remainder -= 1;
  }
  return successorIds.map((skuId, i) => ({ skuId, share: shares[i] ?? 0, horizonUnits: floors[i] ?? 0 }));
}

function yearlySales(
  sales: SalesIndex,
  pred: readonly string[],
  succ: readonly string[],
  now: string
): YearlySales[] {
  const year = Number(now.slice(0, 4));
  const out: YearlySales[] = [];
  for (let y = year - 2; y <= year; y++) {
    const from = `${y}-01-01`;
    const to = y === year ? now.slice(0, 10) : `${y + 1}-01-01`;
    out.push({
      year: y,
      ytd: y === year,
      legacyUnits: Math.round(sumUnits(sales, pred, from, to)),
      successorUnits: Math.round(sumUnits(sales, succ, from, to)),
    });
  }
  return out;
}

function monthlySeries(
  sales: SalesIndex,
  pred: readonly string[],
  succ: readonly string[],
  now: string,
  months: number
): MonthlyLineagePoint[] {
  const current = monthOf(now);
  const out: MonthlyLineagePoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = monthStart(current, -i);
    const month = monthOf(start);
    // The current month runs only to today — it is shown as month-to-date.
    const endExclusive = i === 0 ? now.slice(0, 10) : addDaysTo(monthEnd(month), 1);
    out.push({
      month,
      legacyUnits: Math.round(sumUnits(sales, pred, start, endExclusive)),
      successorUnits: Math.round(sumUnits(sales, succ, start, endExclusive)),
    });
  }
  return out;
}

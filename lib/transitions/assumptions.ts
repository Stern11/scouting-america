/**
 * Resolving the assumptions a transition is planned on.
 *
 * Layered, lowest to highest precedence:
 *   engine default  ←  dataset row  ←  planner override  ←  scenario adjustment
 *
 * A planner override is a decision about the baseline plan. A scenario
 * adjustment is a what-if laid over it and is never written back.
 */

import type { TransitionRow } from "@/types/dataset";
import type {
  CoverageThresholds,
  ScenarioAdjustments,
  TransitionAssumptions,
  TransitionOverrides,
} from "@/types/transition";
import { weeksFrom } from "./time";

export const DEFAULT_THRESHOLDS: CoverageThresholds = {
  shortageWeeks: 2,
  targetWeeks: 4,
  excessWeeks: 8,
  donorFloorWeeks: 4,
  dcToStoreWeeks: 1,
  minTransferUnits: 3,
};

/** Weeks between order reviews — added to vendor lead time to set the horizon. */
export const REVIEW_CYCLE_WEEKS = 4;
/** Horizon when a SKU has no vendor lead time on file. */
export const DEFAULT_HORIZON_WEEKS = 12;
/** The window "recent" sales are read over. */
export const RECENT_WEEKS = 8;
export const DEFAULT_SAFETY_STOCK_WEEKS = 2;

/** Legacy sell-through defaults to the time left until target completion. */
function defaultSellThroughWeeks(row: TransitionRow, planningNow: string): number {
  if (!row.targetCompletionDate) return 8;
  const weeks = Math.round(weeksFrom(planningNow, row.targetCompletionDate));
  return Math.max(1, weeks);
}

/** Substitutability defaults by why the SKU changed: a rebrand is the same garment. */
function defaultSubstitutability(row: TransitionRow): number {
  switch (row.reason) {
    case "REBRAND":
      return 1;
    case "CONSOLIDATION":
      return 0.9;
    case "SPLIT":
      return 0.8;
    case "REPLACEMENT":
      return 0.85;
    default:
      return row.transitionType === "NO_SUCCESSOR" || row.transitionType === "NEW_PRODUCT" ? 0 : 0.85;
  }
}

function defaultTransferredDemand(row: TransitionRow): number {
  if (row.transitionType === "NO_SUCCESSOR") return 0;
  return 1;
}

export function resolveAssumptions(
  row: TransitionRow,
  planningNow: string,
  overrides?: TransitionOverrides,
  scenario?: ScenarioAdjustments
): TransitionAssumptions {
  const base: TransitionAssumptions = {
    substitutabilityPct: row.substitutabilityPct ?? defaultSubstitutability(row),
    transferredDemandPct: row.transferredDemandPct ?? defaultTransferredDemand(row),
    demandAdjustmentPct: 0,
    safetyStockWeeks: row.safetyStockWeeks ?? DEFAULT_SAFETY_STOCK_WEEKS,
    sellThroughWeeks: defaultSellThroughWeeks(row, planningNow),
    inboundDelayWeeks: 0,
  };

  const withOverrides: TransitionAssumptions = {
    ...base,
    ...defined({
      substitutabilityPct: overrides?.substitutabilityPct,
      transferredDemandPct: overrides?.transferredDemandPct,
      demandAdjustmentPct: overrides?.demandAdjustmentPct,
      demandOverrideUnits: overrides?.demandOverrideUnits,
      safetyStockWeeks: overrides?.safetyStockWeeks,
      sellThroughWeeks: overrides?.sellThroughWeeks,
      orderOverrideUnits: overrides?.orderOverrideUnits,
    }),
  };

  const resolved: TransitionAssumptions = { ...withOverrides, ...defined(scenario ?? {}) };
  // A scenario that moves demand invalidates a hand-typed horizon figure:
  // the planner asked "what if demand were different", not "keep my number".
  if (scenario?.demandAdjustmentPct !== undefined || scenario?.transferredDemandPct !== undefined) {
    delete resolved.demandOverrideUnits;
  }
  return clampAssumptions(resolved);
}

function clampAssumptions(a: TransitionAssumptions): TransitionAssumptions {
  return {
    ...a,
    substitutabilityPct: clamp(a.substitutabilityPct, 0, 1),
    transferredDemandPct: clamp(a.transferredDemandPct, 0, 1),
    demandAdjustmentPct: clamp(a.demandAdjustmentPct, -0.5, 0.5),
    safetyStockWeeks: clamp(a.safetyStockWeeks, 0, 26),
    sellThroughWeeks: clamp(a.sellThroughWeeks, 0, 52),
    inboundDelayWeeks: clamp(a.inboundDelayWeeks, 0, 26),
    demandOverrideUnits: a.demandOverrideUnits === undefined ? undefined : Math.max(0, a.demandOverrideUnits),
    orderOverrideUnits: a.orderOverrideUnits === undefined ? undefined : Math.max(0, a.orderOverrideUnits),
  };
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function defined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

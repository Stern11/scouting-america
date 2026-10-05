/**
 * Planning Simulator: one transition, baseline against a what-if.
 *
 * The scenario is a set of lever values laid over the planner's baseline. The
 * dataset is never touched and the result is never stored — both views are
 * rebuilt from (dataset + overrides [+ levers]) every time.
 */

import type { PlanningDataset } from "@/types/dataset";
import type { ScenarioAdjustments, TransitionOverrides, TransitionView } from "@/types/transition";
import { buildTransition } from "./build";
import { weeksFrom } from "./time";
import { fmtNum } from "@/lib/utils/format";

export interface ScenarioMetrics {
  storesAtRisk: number;
  storesAtRiskAfterPlan: number;
  legacyRemaining: number;
  successorOrder: number;
  excessUnits: number;
  /** When legacy stock runs out — the transition is complete. */
  completionDate: string | null;
  /** Successor order at cost plus stranded legacy at cost. */
  workingCapital: number | null;
  transferUnits: number;
  transferCount: number;
  networkWeeksOfCover: number | null;
  horizonDemand: number;
}

export function metricsOf(view: TransitionView): ScenarioMetrics {
  const cost = view.replenishment.unitCost;
  const orderValue = cost === undefined ? undefined : view.replenishment.finalOrderUnits * cost;
  const stranded = view.sellThrough.remainingUnits > 0 ? view.sellThrough.remainingValue : 0;
  return {
    storesAtRisk: view.coverage.atRiskCount,
    storesAtRiskAfterPlan: view.coverage.atRiskAfterPlanCount,
    legacyRemaining: view.sellThrough.remainingUnits,
    successorOrder: view.replenishment.finalOrderUnits,
    excessUnits: view.replenishment.excessUnits,
    completionDate: view.sellThrough.projectedSellThroughDate,
    workingCapital:
      orderValue === undefined || stranded === undefined ? null : Math.round(orderValue + stranded),
    transferUnits: view.coverage.transferUnits,
    transferCount: view.coverage.transfers.length,
    networkWeeksOfCover: view.inventory.networkWeeksOfCover,
    horizonDemand: view.demand.horizonUnits,
  };
}

export interface ScenarioComparison {
  baseline: TransitionView;
  scenario: TransitionView;
  baselineMetrics: ScenarioMetrics;
  scenarioMetrics: ScenarioMetrics;
  /** Days the completion date moves; negative is faster. */
  completionShiftDays: number | null;
}

export function compareScenario(
  dataset: PlanningDataset,
  transitionId: string,
  overridesByTransition: Readonly<Record<string, TransitionOverrides>>,
  adjustments: ScenarioAdjustments
): ScenarioComparison | undefined {
  const baseline = buildTransition(dataset, transitionId, { overridesByTransition });
  const scenario = buildTransition(dataset, transitionId, {
    overridesByTransition,
    scenario: { transitionId, adjustments },
  });
  if (!baseline || !scenario) return undefined;
  const b = metricsOf(baseline);
  const s = metricsOf(scenario);
  return {
    baseline,
    scenario,
    baselineMetrics: b,
    scenarioMetrics: s,
    completionShiftDays:
      b.completionDate && s.completionDate ? Math.round(weeksFrom(b.completionDate, s.completionDate) * 7) : null,
  };
}

/** True when no lever differs from the baseline value. */
export function isEmptyAdjustment(adjustments: ScenarioAdjustments): boolean {
  return Object.values(adjustments).every((v) => v === undefined);
}

/**
 * The levers that become planner overrides when a scenario is adopted. The
 * inbound delay is a what-if about the world, not a planning decision, so it
 * is never written to the baseline.
 */
export function adoptableOverrides(adjustments: ScenarioAdjustments): TransitionOverrides {
  const out: TransitionOverrides = {};
  if (adjustments.substitutabilityPct !== undefined) out.substitutabilityPct = adjustments.substitutabilityPct;
  if (adjustments.transferredDemandPct !== undefined) out.transferredDemandPct = adjustments.transferredDemandPct;
  if (adjustments.demandAdjustmentPct !== undefined) out.demandAdjustmentPct = adjustments.demandAdjustmentPct;
  if (adjustments.safetyStockWeeks !== undefined) out.safetyStockWeeks = adjustments.safetyStockWeeks;
  if (adjustments.sellThroughWeeks !== undefined) out.sellThroughWeeks = adjustments.sellThroughWeeks;
  return out;
}

/** The scenario's consequences in three or four plain lines. */
export function scenarioImpactLines(comparison: ScenarioComparison): string[] {
  const b = comparison.baselineMetrics;
  const s = comparison.scenarioMetrics;
  const lines: string[] = [];
  const diff = (a: number, z: number) => z - a;
  const atRisk = diff(b.storesAtRisk, s.storesAtRisk);
  if (atRisk !== 0) lines.push(`${atRisk > 0 ? "+" : "−"}${Math.abs(atRisk)} stores at stockout risk`);
  const order = diff(b.successorOrder, s.successorOrder);
  if (order !== 0) lines.push(`${order > 0 ? "+" : "−"}${fmtNum(Math.abs(order))} successor units to order`);
  const legacy = diff(b.legacyRemaining, s.legacyRemaining);
  if (legacy !== 0) lines.push(`${legacy > 0 ? "+" : "−"}${fmtNum(Math.abs(legacy))} legacy units left stranded`);
  if (comparison.completionShiftDays) {
    lines.push(`${Math.abs(comparison.completionShiftDays)} days ${comparison.completionShiftDays < 0 ? "faster" : "slower"} transition`);
  }
  return lines;
}

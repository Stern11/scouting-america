/**
 * The portfolio: every transition at once, for the Overview and the action
 * queue.
 *
 * Every figure is a sum or count over `TransitionView`s — nothing is computed
 * here that a transition page could not show the parts of.
 *
 * Value is described with care. Purchasing that legacy stock makes
 * unnecessary is *deferred or avoided*, not saved: some of it is simply
 * bought later. The 150-transition extrapolation is labelled illustrative
 * everywhere it appears, and planner hours rest on a stated assumption.
 */

import type { PlannerAction, TransitionStatus, TransitionView } from "@/types/transition";
import { compareActions } from "./actions";

/** Assumed manual reconciliation effort per active transition per weekly cycle. */
export const PLANNER_HOURS_PER_TRANSITION_CYCLE = 0.75;

export interface PortfolioSummary {
  total: number;
  active: number;
  byStatus: Record<TransitionStatus, number>;
  attention: number;
  inventoryInTransitionValue: number | null;
  legacyUnitsInNetwork: number;
  openActions: number;
  storesMonitored: number;
  /** Store × transition pairs projected to run out before resupply. */
  storeStockouts: number;
  storeStockoutTransitions: number;
  strandedLegacyUnits: number;
  strandedLegacyValue: number | null;
  unconfirmedRelationships: number;
  imbalancedTransitions: number;
  imbalanceStores: number;
  transferUnits: number;
}

const STATUSES: TransitionStatus[] = ["ACTION_NEEDED", "MONITOR", "TRANSITIONING", "HEALTHY", "COMPLETE"];

export function summarizePortfolio(views: readonly TransitionView[], storeCount: number): PortfolioSummary {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<TransitionStatus, number>;
  for (const v of views) byStatus[v.status] += 1;
  const active = views.filter((v) => v.status !== "COMPLETE");

  let value: number | null = 0;
  let stranded: number | null = 0;
  for (const v of active) {
    if (v.inventory.onHandValue === undefined) value = null;
    else if (value !== null) value += v.inventory.onHandValue;
    if (v.sellThrough.remainingUnits > 0) {
      if (v.sellThrough.remainingValue === undefined) stranded = null;
      else if (stranded !== null) stranded += v.sellThrough.remainingValue;
    }
  }

  const withTransfers = active.filter((v) => v.coverage.transfers.length > 0);
  return {
    total: views.length,
    active: active.length,
    byStatus,
    attention: byStatus.ACTION_NEEDED,
    inventoryInTransitionValue: value,
    legacyUnitsInNetwork: active.reduce((n, v) => n + v.inventory.legacyOnHand, 0),
    openActions: openActions(views).filter((a) => a.priority !== "MONITOR").length,
    storesMonitored: storeCount,
    storeStockouts: active.reduce((n, v) => n + v.coverage.atRiskCount, 0),
    storeStockoutTransitions: active.filter((v) => v.coverage.atRiskCount > 0).length,
    strandedLegacyUnits: active.reduce((n, v) => n + v.sellThrough.remainingUnits, 0),
    strandedLegacyValue: stranded,
    unconfirmedRelationships: active.filter((v) => !v.lineage.confirmed && v.lineage.successors.length > 0 && v.lineage.predecessors.length > 0).length,
    imbalancedTransitions: withTransfers.length,
    imbalanceStores: withTransfers.reduce(
      (n, v) => n + new Set(v.coverage.transfers.flatMap((t) => [t.fromStoreId, t.toStoreId])).size,
      0
    ),
    transferUnits: withTransfers.reduce((n, v) => n + v.coverage.transferUnits, 0),
  };
}

/** Every open action across the portfolio, most urgent first. */
export function openActions(
  views: readonly TransitionView[],
  dispositions?: Readonly<Record<string, unknown>>
): PlannerAction[] {
  return views
    .flatMap((v) => v.actions)
    .filter((a) => !dispositions || dispositions[a.id] === undefined)
    .sort(compareActions);
}

/* ------------------------------------------------------------------ */
/* Impact                                                              */
/* ------------------------------------------------------------------ */

export interface ImpactFigures {
  transitions: number;
  legacyUnitsSurfaced: number;
  purchasingAvoidedUnits: number;
  purchasingAvoidedValue: number | null;
  stockoutsPrevented: number;
  transferUnits: number;
  strandedLegacyUnits: number;
  strandedLegacyValue: number | null;
  plannerHoursPerCycle: number;
}

export function impactOf(views: readonly TransitionView[]): ImpactFigures {
  let avoidedValue: number | null = 0;
  let strandedValue: number | null = 0;
  for (const v of views) {
    const cost = v.replenishment.unitCost;
    if (v.replenishment.avoidedUnits > 0) {
      if (cost === undefined) avoidedValue = null;
      else if (avoidedValue !== null) avoidedValue += v.replenishment.avoidedUnits * cost;
    }
    if (v.sellThrough.remainingUnits > 0) {
      if (v.sellThrough.remainingValue === undefined) strandedValue = null;
      else if (strandedValue !== null) strandedValue += v.sellThrough.remainingValue;
    }
  }
  return {
    transitions: views.length,
    legacyUnitsSurfaced: views.reduce((n, v) => n + v.inventory.usableLegacy, 0),
    purchasingAvoidedUnits: views.reduce((n, v) => n + v.replenishment.avoidedUnits, 0),
    purchasingAvoidedValue: avoidedValue,
    stockoutsPrevented: views.reduce((n, v) => n + (v.coverage.atRiskCount - v.coverage.atRiskAfterPlanCount), 0),
    transferUnits: views.reduce((n, v) => n + v.coverage.transferUnits, 0),
    strandedLegacyUnits: views.reduce((n, v) => n + v.sellThrough.remainingUnits, 0),
    strandedLegacyValue: strandedValue,
    plannerHoursPerCycle: views.length * PLANNER_HOURS_PER_TRANSITION_CYCLE,
  };
}

export interface NetworkImpact {
  /** The transitions the figures are measured on. */
  measured: ImpactFigures;
  /** The portfolio size the extrapolation scales to. */
  portfolioSize: number;
  /** Illustrative: measured per-transition averages × portfolio size. Never realized value. */
  extrapolated: ImpactFigures;
}

/**
 * Measured on the active transitions, then scaled to the whole portfolio at
 * the same per-transition rate — the "prove it on a few SKUs, multiply across
 * the rest" business case. The scaled figure is illustrative and is always
 * labelled so.
 */
export function networkImpact(views: readonly TransitionView[]): NetworkImpact {
  const active = views.filter((v) => v.status !== "COMPLETE");
  const measured = impactOf(active);
  const n = Math.max(1, measured.transitions);
  const scale = views.length / n;
  const s = (x: number) => Math.round(x * scale);
  const sv = (x: number | null) => (x === null ? null : Math.round(x * scale));
  return {
    measured,
    portfolioSize: views.length,
    extrapolated: {
      transitions: views.length,
      legacyUnitsSurfaced: s(measured.legacyUnitsSurfaced),
      purchasingAvoidedUnits: s(measured.purchasingAvoidedUnits),
      purchasingAvoidedValue: sv(measured.purchasingAvoidedValue),
      stockoutsPrevented: s(measured.stockoutsPrevented),
      transferUnits: s(measured.transferUnits),
      strandedLegacyUnits: s(measured.strandedLegacyUnits),
      strandedLegacyValue: sv(measured.strandedLegacyValue),
      plannerHoursPerCycle: views.length * PLANNER_HOURS_PER_TRANSITION_CYCLE,
    },
  };
}

/** Status sort for lists: what needs a planner first. */
export const STATUS_ORDER: Record<TransitionStatus, number> = {
  ACTION_NEEDED: 0,
  MONITOR: 1,
  TRANSITIONING: 2,
  HEALTHY: 3,
  COMPLETE: 4,
};

export function sortForAttention(views: readonly TransitionView[]): TransitionView[] {
  return [...views].sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    // Among transitions needing action, the most inventory at stake leads.
    if (a.status === "ACTION_NEEDED") {
      const v = (b.inventory.onHandValue ?? 0) - (a.inventory.onHandValue ?? 0);
      if (v !== 0) return v;
    }
    const ra = a.actions[0];
    const rb = b.actions[0];
    if (ra && rb) {
      const c = compareActions(ra, rb);
      if (c !== 0) return c;
    }
    return b.coverage.atRiskCount - a.coverage.atRiskCount || a.name.localeCompare(b.name);
  });
}

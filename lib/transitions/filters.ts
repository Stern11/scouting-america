/**
 * List filtering for SKU Transitions. Pure, so the list, the Overview's
 * deep links and Ask Heizen all agree on what "excess risk" means.
 */

import type { TransitionRiskKind, TransitionStatus, TransitionView } from "@/types/transition";
import type { TransitionType } from "@/types/dataset";

export type RiskFilter = "stockout" | "excess" | "imbalance" | "inbound" | "unconfirmed" | "forecast";

export interface TransitionFilters {
  query?: string;
  status?: TransitionStatus | "ACTIVE";
  category?: string;
  program?: string;
  type?: TransitionType;
  risk?: RiskFilter;
}

export const RISK_FILTER_LABEL: Record<RiskFilter, string> = {
  stockout: "Store stockout risk",
  excess: "Excess legacy inventory",
  imbalance: "Store imbalance",
  inbound: "Inbound delay",
  unconfirmed: "Unconfirmed relationship",
  forecast: "JDA forecast gap",
};

export const RISK_KIND_LABEL: Record<TransitionRiskKind, string> = {
  STOCKOUT: "Stockout risk",
  EXCESS: "Excess risk",
  IMBALANCE: "Store imbalance",
  INBOUND_DELAY: "Inbound delay",
  UNCONFIRMED: "Needs confirmation",
  FORECAST_GAP: "Forecast gap",
  NONE: "On track",
};

export const TYPE_LABEL: Record<TransitionType, string> = {
  ONE_TO_ONE: "One to one",
  MANY_TO_ONE: "Consolidation",
  ONE_TO_MANY: "Split",
  NO_SUCCESSOR: "Discontinued",
  NEW_PRODUCT: "New product",
};

/**
 * A risk filter matches what the transition actually carries, not only its
 * headline: a transition whose top issue is a stockout can also hold excess
 * legacy stock, and both lists should show it.
 */
export function matchesRisk(view: TransitionView, risk: RiskFilter): boolean {
  switch (risk) {
    case "stockout":
      return view.coverage.atRiskCount > 0;
    case "excess":
      return view.sellThrough.remainingUnits > 0 && view.actions.some((a) => a.type === "REVIEW_TRANSITION" || a.type === "HOLD_REPLENISHMENT");
    case "imbalance":
      return view.coverage.transfers.length > 0;
    case "inbound":
      return view.coverage.atRiskAfterPlanCount > 0;
    case "unconfirmed":
      return !view.lineage.confirmed && view.lineage.predecessors.length > 0 && view.lineage.successors.length > 0;
    case "forecast":
      return view.actions.some((a) => a.type === "UPDATE_DEMAND_ASSUMPTION");
  }
}

export function filterTransitions(views: readonly TransitionView[], f: TransitionFilters): TransitionView[] {
  const q = f.query?.trim().toLowerCase() ?? "";
  return views.filter((v) => {
    if (f.status === "ACTIVE" && v.status === "COMPLETE") return false;
    if (f.status && f.status !== "ACTIVE" && v.status !== f.status) return false;
    if (f.category && v.category !== f.category) return false;
    if (f.program && v.program !== f.program) return false;
    if (f.type && v.lineage.type !== f.type) return false;
    if (f.risk && !matchesRisk(v, f.risk)) return false;
    if (q) {
      const haystack = [
        v.name,
        v.category,
        v.program ?? "",
        ...v.lineage.predecessors.flatMap((s) => [s.skuId, s.skuName]),
        ...v.lineage.successors.flatMap((s) => [s.skuId, s.skuName]),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function distinctValues(views: readonly TransitionView[], pick: (v: TransitionView) => string | undefined): string[] {
  return [...new Set(views.map(pick).filter((x): x is string => Boolean(x)))].sort();
}

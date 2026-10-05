/**
 * The arithmetic behind each number, as lines a planner can read top to
 * bottom. Pure — the panels render these and compute nothing themselves.
 */

import type { CalculationLine, TransitionView } from "@/types/transition";
import { fmtNum, fmtNum1, fmtPct } from "@/lib/utils/format";
import { replenishmentLines } from "./actions";

const signedPct = (factor: number) => `${factor >= 1 ? "+" : "−"}${fmtPct(Math.abs(factor - 1))}`;

/** Legacy history → continuity baseline → expected demand over the horizon. */
export function demandLines(view: TransitionView): CalculationLine[] {
  const d = view.demand;
  const lines: CalculationLine[] = [];
  if (view.lineage.predecessors.length > 0) {
    lines.push({ label: "Legacy sales, last 52 weeks", value: fmtNum(d.legacyUnitsL52) });
    if (d.transferredDemandPct < 1) {
      lines.push({ label: "Share of legacy demand that transfers", value: fmtPct(d.transferredDemandPct), op: "×" });
    }
  }
  if (view.lineage.successors.length > 0) {
    lines.push({
      label: "Successor sales, last 52 weeks",
      value: fmtNum(d.successorUnitsL52),
      op: view.lineage.predecessors.length > 0 ? "+" : undefined,
    });
  }
  lines.push({ label: "Continuity baseline, annual", value: fmtNum(d.baselineAnnualUnits), op: "=" });
  lines.push({ label: "Year-over-year trend", value: signedPct(d.trendFactor), op: "×" });
  if (d.demandAdjustmentPct !== 0) {
    lines.push({ label: "Planner adjustment", value: signedPct(1 + d.demandAdjustmentPct), op: "×" });
  }
  lines.push({ label: "Expected annual demand", value: fmtNum(d.expectedAnnualUnits), op: "=" });
  lines.push({
    label:
      d.seasonalityBasis === "history"
        ? `Seasonality, next ${d.horizonWeeks} weeks vs. a flat year`
        : "Seasonality — under a year of history, flat rate assumed",
    value: d.seasonalityBasis === "history" ? signedPct(d.seasonalityFactor) : "flat",
    op: "×",
  });
  lines.push({
    label: `Expected demand, next ${d.horizonWeeks} weeks`,
    value: fmtNum(d.calculatedHorizonUnits),
    op: "=",
    emphasis: !d.overridden,
  });
  if (d.overridden) {
    lines.push({ label: "Planner override", value: fmtNum(d.horizonUnits), emphasis: true });
  }
  return lines;
}

export interface InventoryTableRow {
  location: string;
  legacy: number;
  successor: number;
  /** Raw sum — shown, and deliberately not what supply is built on. */
  combined: number;
  usable: number;
  note?: string;
}

/** DC / stores / inbound × legacy / successor / combined / usable. */
export function inventoryTable(view: TransitionView): InventoryTableRow[] {
  const inv = view.inventory;
  const s = inv.legacyBlocked ? 0 : inv.substitutabilityPct;
  const usable = (legacy: number, successor: number) => Math.floor(legacy * s) + successor;
  const rows: InventoryTableRow[] = [
    {
      location: "DC",
      legacy: inv.dc.legacy,
      successor: inv.dc.successor,
      combined: inv.dc.legacy + inv.dc.successor,
      usable: usable(inv.dc.legacy, inv.dc.successor),
      note:
        inv.dcAllocated.legacy + inv.dcAllocated.successor > 0
          ? `${fmtNum(inv.dcAllocated.legacy + inv.dcAllocated.successor)} allocated to open orders excluded`
          : undefined,
    },
    {
      location: "Stores",
      legacy: inv.stores.legacy,
      successor: inv.stores.successor,
      combined: inv.stores.legacy + inv.stores.successor,
      usable: usable(inv.stores.legacy, inv.stores.successor),
    },
    {
      location: "Inbound, inside horizon",
      legacy: 0,
      successor: inv.eligibleInbound,
      combined: inv.eligibleInbound,
      usable: inv.eligibleInbound,
      note: inv.laterInbound > 0 ? `${fmtNum(inv.laterInbound)} more lands after the horizon` : undefined,
    },
  ];
  const total = rows.reduce(
    (t, r) => ({
      location: "Total",
      legacy: t.legacy + r.legacy,
      successor: t.successor + r.successor,
      combined: t.combined + r.combined,
      usable: t.usable + r.usable,
    }),
    { location: "Total", legacy: 0, successor: 0, combined: 0, usable: 0 } as InventoryTableRow
  );
  return [...rows, total];
}

export interface ExplanationStep {
  title: string;
  body: string;
}

/** "How this was calculated" — the seven steps from relationship to order. */
export function explanationSteps(view: TransitionView): ExplanationStep[] {
  const { lineage, demand: d, inventory: inv, replenishment: r, assumptions: a } = view;
  const legacy = lineage.predecessors.map((s) => s.skuId).join(" + ") || "no legacy SKU";
  const successor = lineage.successors.map((s) => s.skuId).join(" + ") || "no successor";
  return [
    {
      title: "Successor relationship",
      body: `${legacy} → ${successor}, ${lineage.confirmed ? "confirmed" : "not yet confirmed"}. ${lineage.matchedCount} attributes match and ${lineage.changedCount} changed.`,
    },
    {
      title: "Demand history considered",
      body: `${fmtNum(d.legacyUnitsL52)} legacy and ${fmtNum(d.successorUnitsL52)} successor units sold in the last 52 weeks — one stream, each sale counted once. ${fmtPct(d.transferredDemandPct)} of legacy demand is carried to the successor.`,
    },
    {
      title: "Substitutability",
      body: inv.legacyBlocked
        ? "The legacy SKU is blocked from sale, so none of its stock counts."
        : `${fmtPct(a.substitutabilityPct)} of legacy units can satisfy successor demand, so ${fmtNum(inv.legacyOnHand)} legacy units count as ${fmtNum(inv.usableLegacy)}.`,
    },
    {
      title: "Available inventory",
      body: `${fmtNum(inv.successorOnHand)} successor units on hand across the DC and stores, after excluding stock allocated to open orders.`,
    },
    {
      title: "Inbound supply",
      body:
        inv.receipts.length === 0
          ? "No inbound supply is on order."
          : `${fmtNum(inv.eligibleInbound)} units land inside the ${r.horizonWeeks}-week horizon${a.inboundDelayWeeks > 0 ? ` (with a ${a.inboundDelayWeeks}-week delay applied)` : ""}${inv.laterInbound > 0 ? `; ${fmtNum(inv.laterInbound)} more land after it and are not counted` : ""}.`,
    },
    {
      title: "Safety stock",
      body: `${fmtNum1(r.safetyStockWeeks)} weeks of demand — ${fmtNum(r.safetyStockUnits)} units.`,
    },
    {
      title: "Replenishment",
      body:
        lineage.successors.length === 0
          ? "Nothing is reordered for a product discontinued without a successor."
          : `Requirement ${fmtNum(r.requirement)} − usable supply ${fmtNum(inv.effectiveSupply)} = ${fmtNum(r.recommendedUnits)}, never below zero.${r.avoidedUnits > 0 ? ` Ignoring legacy stock would order ${fmtNum(r.ignoringLegacyUnits)}.` : ""}`,
    },
  ];
}

export { replenishmentLines };

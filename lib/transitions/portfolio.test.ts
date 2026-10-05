import { describe, expect, it } from "vitest";
import { deriveStatus } from "./actions";
import { buildTransitions } from "./build";
import { impactOf, networkImpact, openActions, summarizePortfolio } from "./portfolio";
import type { PlannerAction } from "@/types/transition";
import { NOW, dataset, inv, sku, transition, yearSale } from "./__fixtures";

const action = (priority: PlannerAction["priority"], type: PlannerAction["type"] = "REVIEW_TRANSITION"): PlannerAction => ({
  id: `x:${priority}:${type}`,
  transitionId: "x",
  transitionName: "x",
  type,
  priority,
  title: "",
  summary: "",
  reasons: [],
  calculation: [],
  rank: 0,
});

describe("status", () => {
  const base = { progress: 0.5, legacyOnHand: 10, closed: false, hasPredecessor: true };
  it("CRITICAL or HIGH → ACTION_NEEDED; MEDIUM → MONITOR", () => {
    expect(deriveStatus({ ...base, actions: [action("CRITICAL")] })).toBe("ACTION_NEEDED");
    expect(deriveStatus({ ...base, actions: [action("HIGH")] })).toBe("ACTION_NEEDED");
    expect(deriveStatus({ ...base, actions: [action("MEDIUM")] })).toBe("MONITOR");
  });
  it("otherwise by progress, and closed or depleted is COMPLETE", () => {
    expect(deriveStatus({ ...base, actions: [] })).toBe("TRANSITIONING");
    expect(deriveStatus({ ...base, progress: 0.9, actions: [] })).toBe("HEALTHY");
    expect(deriveStatus({ ...base, closed: true, actions: [action("CRITICAL")] })).toBe("COMPLETE");
    expect(deriveStatus({ ...base, progress: 1, legacyOnHand: 0, actions: [action("MONITOR", "MARK_LEGACY_DEPLETION")] })).toBe("COMPLETE");
  });
});

describe("portfolio", () => {
  const ds = dataset({
    capabilities: { storeLevelDemand: false },
    skus: [sku("L1", { status: "DISCONTINUED" }), sku("S1", { unitCost: undefined })],
    transitions: [transition()],
    sales: [yearSale("L1", 5200)],
    inventory: [inv("L1", "DC", 400, "DC"), inv("S1", "DC", 50, "DC")],
  });
  const views = buildTransitions(ds);

  it("reports unknown money as null, never zero", () => {
    const s = summarizePortfolio(views, 0);
    expect(s.inventoryInTransitionValue).toBeNull();
    expect(impactOf(views).purchasingAvoidedValue).toBeNull();
  });

  it("extrapolation scales measured per-transition figures to the portfolio", () => {
    const n = networkImpact(views);
    expect(n.portfolioSize).toBe(1);
    expect(n.extrapolated.purchasingAvoidedUnits).toBe(n.measured.purchasingAvoidedUnits);
  });

  it("open actions exclude ones the planner has dealt with", () => {
    const all = openActions(views);
    const first = all[0];
    expect(first).toBeDefined();
    expect(openActions(views, { [first!.id]: { disposition: "DONE", at: NOW } })).toHaveLength(all.length - 1);
  });
});

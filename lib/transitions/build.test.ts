import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTransition, buildTransitions } from "./build";
import { compareScenario, adoptableOverrides, isEmptyAdjustment } from "./scenario";
import { resolveAssumptions } from "./assumptions";
import { collectTransitions, compareSkus, relationshipConfidence } from "./lineage";
import { compareActions } from "./actions";
import { NOW, dataset, deepFreeze, inbound, inv, sku, store, transition, yearSale } from "./__fixtures";
import type { PlanningDataset, SalesRow } from "@/types/dataset";
import type { TransitionOverrides } from "@/types/transition";

const RECENT_START = "2026-08-10";
const RECENT_END = "2026-10-04";

function storeSale(skuId: string, storeId: string, units: number): SalesRow {
  return { skuId, storeId, periodStart: RECENT_START, periodEnd: RECENT_END, units };
}

/** One rebrand, three stores: A short, B overstocked with legacy, C fine. */
function fixture(extra: Partial<PlanningDataset> = {}): PlanningDataset {
  return dataset({
    stores: [store("A", "R1"), store("B", "R1"), store("C", "R2")],
    skus: [sku("L1", { status: "DISCONTINUED", skuName: "Cub Scout Uniform Shirt — Legacy Branding", brand: "BSA legacy" }), sku("S1", { status: "NEW", skuName: "Cub Scout Uniform Shirt — Scouting America Branding", brand: "Scouting America" })],
    transitions: [transition()],
    sales: [yearSale("L1", 3120), yearSale("S1", 2080), storeSale("S1", "A", 80), storeSale("L1", "B", 40), storeSale("S1", "C", 80)],
    inventory: [inv("S1", "A", 10), inv("L1", "B", 300), inv("S1", "C", 120), inv("S1", "DC", 100, "DC")],
    inbound: [inbound("S1", 400, "2026-10-26")],
    ...extra,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("lineage", () => {
  it("explains a match attribute by attribute", () => {
    const evidence = compareSkus(
      sku("L1", { skuName: "Cub Scout Uniform Shirt — Legacy Branding", brand: "BSA legacy" }),
      sku("S1", { skuName: "Cub Scout Uniform Shirt — Scouting America Branding", brand: "Scouting America" })
    );
    const v = (a: string) => evidence.find((e) => e.attribute === a)?.verdict;
    expect(v("Product family")).toBe("match");
    expect(v("Description")).toBe("strong");
    expect(v("Brand")).toBe("changed");
    expect(v("SKU ID")).toBe("changed");
    expect(evidence.at(-1)?.attribute).toBe("SKU ID");
    expect(relationshipConfidence(evidence)).toBe("HIGH");
  });

  it("collects JDA replacements and suggests unmapped matches one-to-one", () => {
    const ds = dataset({
      skus: [
        sku("L1", { status: "DISCONTINUED", replacementSkuId: "S1" }),
        sku("S1", { status: "NEW" }),
        sku("L2", { status: "DISCONTINUED", skuName: "Scouts BSA Hat — Legacy" }),
        sku("L3", { status: "DISCONTINUED", skuName: "Scouts BSA Hat — Old" }),
        sku("S2", { status: "NEW", skuName: "Scouts BSA Hat — Scouting America" }),
      ],
    });
    const rows = collectTransitions(ds);
    expect(rows.find((r) => r.transitionId === "sys-L1")).toMatchObject({ source: "SYSTEM", plannerConfirmed: true, successorSkuIds: ["S1"] });
    const suggested = rows.filter((r) => r.source === "SUGGESTED");
    expect(suggested).toHaveLength(1);
    expect(suggested[0]).toMatchObject({ predecessorSkuIds: ["L2"], successorSkuIds: ["S2"], plannerConfirmed: false });
  });

  it("planner decisions change what the math treats as one stream", () => {
    const ds = fixture();
    const disc = buildTransition(ds, "T1", { overridesByTransition: { T1: { relationshipDecision: "DISCONTINUED" } } })!;
    expect(disc.lineage.type).toBe("NO_SUCCESSOR");
    expect(disc.replenishment.finalOrderUnits).toBe(0);
    const fresh = buildTransition(ds, "T1", { overridesByTransition: { T1: { relationshipDecision: "NEW_PRODUCT" } } })!;
    expect(fresh.lineage.type).toBe("NEW_PRODUCT");
    expect(fresh.demand.legacyUnitsL52).toBe(0);
    const partial = buildTransition(ds, "T1", { overridesByTransition: { T1: { relationshipDecision: "PARTIAL_REPLACEMENT" } } })!;
    expect(partial.assumptions.substitutabilityPct).toBe(0.6);
    expect(partial.assumptions.transferredDemandPct).toBe(0.7);
  });
});

describe("assumption layering", () => {
  it("dataset < planner override < scenario", () => {
    const row = transition({ substitutabilityPct: 0.9, safetyStockWeeks: 3 });
    expect(resolveAssumptions(row, NOW).substitutabilityPct).toBe(0.9);
    expect(resolveAssumptions(row, NOW, { substitutabilityPct: 0.7 }).substitutabilityPct).toBe(0.7);
    const s = resolveAssumptions(row, NOW, { substitutabilityPct: 0.7 }, { substitutabilityPct: 0.4 });
    expect(s.substitutabilityPct).toBe(0.4);
    expect(s.safetyStockWeeks).toBe(3);
    // Sell-through defaults to the weeks left until target completion.
    expect(resolveAssumptions(row, NOW).sellThroughWeeks).toBe(8);
  });

  it("a demand scenario drops a typed horizon override; values are clamped", () => {
    const row = transition();
    expect(resolveAssumptions(row, NOW, { demandOverrideUnits: 500 }, { demandAdjustmentPct: 0.1 }).demandOverrideUnits).toBeUndefined();
    expect(resolveAssumptions(row, NOW, { substitutabilityPct: 3 }).substitutabilityPct).toBe(1);
  });
});

describe("build", () => {
  it("assembles one continuous requirement", () => {
    const v = buildTransition(fixture(), "T1")!;
    expect(v.demand.baselineAnnualUnits).toBe(5200);
    expect(v.inventory.legacyOnHand).toBe(300);
    expect(v.inventory.successorOnHand).toBe(230);
    expect(v.coverage.available).toBe(true);
    expect(v.coverage.storeCount).toBe(3);
    expect(v.coverage.atRiskCount).toBeGreaterThan(0);
    expect(v.coverage.transfers[0]?.fromStoreId).toBe("B");
    expect(v.status).toBe("ACTION_NEEDED");
    expect(v.actions.some((a) => a.type === "TRANSFER_INVENTORY")).toBe(true);
  });

  it("says why store coverage is unavailable instead of inventing it", () => {
    const v = buildTransition(fixture({ sales: [yearSale("L1", 3120)] }), "T1")!;
    expect(v.coverage.available).toBe(false);
    expect(v.coverage.unavailableReason).toMatch(/store-level sales/);
  });

  it("orders actions deterministically: priority, then rank, then id", () => {
    const v = buildTransition(fixture(), "T1")!;
    const sorted = [...v.actions].sort(compareActions);
    expect(v.actions.map((a) => a.id)).toEqual(sorted.map((a) => a.id));
    expect(buildTransition(fixture(), "T1")!.actions).toEqual(v.actions);
  });

  it("a closed transition is complete with no actions", () => {
    const v = buildTransition(fixture({ transitions: [transition({ closed: true })] }), "T1")!;
    expect(v.status).toBe("COMPLETE");
    expect(v.actions).toEqual([]);
    const byOverride = buildTransition(fixture(), "T1", { overridesByTransition: { T1: { closed: true } } })!;
    expect(byOverride.status).toBe("COMPLETE");
  });

  it("only raises HOLD against a planned JDA order", () => {
    const without = buildTransition(fixture(), "T1")!;
    expect(without.actions.some((a) => a.type === "HOLD_REPLENISHMENT")).toBe(false);
    const withPlan = buildTransition(
      fixture({ currentPlan: [{ skuId: "S1", horizonStart: NOW, horizonEnd: "2026-12-27", forecastUnits: 1000, plannedReplenishmentUnits: 2000 }] }),
      "T1"
    )!;
    const hold = withPlan.actions.find((a) => a.type === "HOLD_REPLENISHMENT");
    expect(hold).toBeDefined();
    expect(hold!.quantity).toBe(2000 - withPlan.replenishment.finalOrderUnits);
  });

  it("an unconfirmed relationship raises a confirmation", () => {
    const v = buildTransition(fixture({ transitions: [transition({ plannerConfirmed: false })] }), "T1")!;
    expect(v.actions.find((a) => a.type === "CONFIRM_SUCCESSOR")).toBeDefined();
    const confirmed = buildTransition(fixture({ transitions: [transition({ plannerConfirmed: false })] }), "T1", {
      overridesByTransition: { T1: { relationshipDecision: "CONFIRMED" } },
    })!;
    expect(confirmed.actions.find((a) => a.type === "CONFIRM_SUCCESSOR")).toBeUndefined();
  });

  it("does not read the machine clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    const a = buildTransitions(fixture());
    vi.setSystemTime(new Date("2031-06-15T12:00:00Z"));
    const b = buildTransitions(fixture());
    expect(b).toEqual(a);
  });
});

describe("scenarios", () => {
  it("never mutate the dataset or the overrides", () => {
    const ds = deepFreeze(fixture());
    const overrides: Record<string, TransitionOverrides> = deepFreeze({ T1: { safetyStockWeeks: 3 } });
    const snapshot = JSON.stringify([ds, overrides]);
    const cmp = compareScenario(ds, "T1", overrides, { inboundDelayWeeks: 3, substitutabilityPct: 0.5, demandAdjustmentPct: 0.2 })!;
    expect(JSON.stringify([ds, overrides])).toBe(snapshot);
    expect(cmp.baseline).toEqual(buildTransition(ds, "T1", { overridesByTransition: overrides }));
    expect(cmp.scenario.assumptions.inboundDelayWeeks).toBe(3);
    expect(cmp.scenario.demand.horizonUnits).toBeGreaterThan(cmp.baseline.demand.horizonUnits);
  });

  it("a later inbound puts more stores at risk", () => {
    const cmp = compareScenario(fixture(), "T1", {}, { inboundDelayWeeks: 4 })!;
    expect(cmp.scenarioMetrics.storesAtRisk).toBeGreaterThanOrEqual(cmp.baselineMetrics.storesAtRisk);
  });

  it("only touches the transition it names", () => {
    const ds = fixture({ transitions: [transition(), transition({ transitionId: "T2", transitionName: "Other" })] });
    const plain = buildTransitions(ds);
    const scen = buildTransitions(ds, { scenario: { transitionId: "T1", adjustments: { inboundDelayWeeks: 5 } } });
    expect(scen.find((v) => v.id === "T2")).toEqual(plain.find((v) => v.id === "T2"));
  });

  it("adopting keeps decisions, never the inbound what-if", () => {
    expect(adoptableOverrides({ inboundDelayWeeks: 2, safetyStockWeeks: 3 })).toEqual({ safetyStockWeeks: 3 });
    expect(isEmptyAdjustment({})).toBe(true);
    expect(isEmptyAdjustment({ inboundDelayWeeks: undefined })).toBe(true);
    expect(isEmptyAdjustment({ inboundDelayWeeks: 0 })).toBe(false);
  });
});

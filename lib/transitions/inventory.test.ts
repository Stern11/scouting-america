import { describe, expect, it } from "vitest";
import {
  calculateEffectiveInventory,
  calculateNetworkInventory,
  calculateUsableLegacyInventory,
  latestPositions,
} from "./inventory";
import { calculateReplenishmentRequirement, type ReplenishmentInput } from "./replenishment";
import { NOW, inbound, inv, sku } from "./__fixtures";
import type { SkuRow } from "@/types/dataset";

describe("usable legacy inventory", () => {
  it("substitutability 0 excludes legacy, 1 includes all", () => {
    expect(calculateUsableLegacyInventory(500, 0)).toBe(0);
    expect(calculateUsableLegacyInventory(500, 1)).toBe(500);
    expect(calculateUsableLegacyInventory(500, 0.6)).toBe(300);
  });
  it("blocked legacy contributes nothing", () => {
    expect(calculateUsableLegacyInventory(500, 1, true)).toBe(0);
  });
  it("effective supply ignores negatives", () => {
    expect(calculateEffectiveInventory({ usableLegacy: 10, successorOnHand: -5, eligibleInbound: 3 })).toBe(13);
  });
});

function network(skus: SkuRow[], extra: Partial<Parameters<typeof calculateNetworkInventory>[0]> = {}) {
  return calculateNetworkInventory({
    predecessorSkuIds: ["L1"],
    successorSkuIds: ["S1"],
    positions: [inv("L1", "ST1", 100), inv("L1", "DC", 50, "DC"), inv("S1", "ST1", 40), inv("S1", "DC", 200, "DC", 150)],
    inbound: [inbound("S1", 300, "2026-10-26"), inbound("S1", 500, "2027-03-01")],
    skuById: new Map(skus.map((s) => [s.skuId, s])),
    planningNow: NOW,
    horizonWeeks: 12,
    substitutabilityPct: 1,
    inboundDelayWeeks: 0,
    weeklyDemand: 50,
    ...extra,
  });
}

describe("network inventory", () => {
  it("counts available (on hand − allocated) and sums usable supply", () => {
    const n = network([sku("L1", { status: "DISCONTINUED" }), sku("S1")]);
    expect(n.dc.successor).toBe(50);
    expect(n.dcAllocated.successor).toBe(150);
    expect(n.legacyOnHand).toBe(150);
    expect(n.successorOnHand).toBe(90);
    expect(n.usableLegacy).toBe(150);
    expect(n.eligibleInbound).toBe(300);
    expect(n.laterInbound).toBe(500);
    expect(n.effectiveSupply).toBe(540);
    expect(n.networkWeeksOfCover).toBeCloseTo(240 / 50);
    expect(n.onHandValue).toBe((150 + 240) * 10);
  });

  it("substitutability 0 drops legacy from supply", () => {
    const n = network([sku("L1"), sku("S1")], { substitutabilityPct: 0 });
    expect(n.usableLegacy).toBe(0);
    expect(n.effectiveSupply).toBe(390);
  });

  it("blocked predecessors contribute nothing", () => {
    const n = network([sku("L1", { status: "BLOCKED" }), sku("S1")]);
    expect(n.legacyBlocked).toBe(true);
    expect(n.usableLegacy).toBe(0);
  });

  it("an inbound delay pushes receipts, and can push them out of the horizon", () => {
    const n = network([sku("L1"), sku("S1")], { inboundDelayWeeks: 10 });
    const r = n.receipts[0]!;
    expect(r.plannedDate).toBe("2026-10-26");
    expect(r.expectedDate).toBe("2027-01-04");
    expect(r.eligible).toBe(false);
    expect(n.eligibleInbound).toBe(0);
  });

  it("an overdue receipt is expected from today, not the past", () => {
    const n = network([sku("L1"), sku("S1")], { inbound: [inbound("S1", 10, "2026-09-01")] });
    expect(n.receipts[0]!.expectedDate).toBe(NOW);
    expect(n.receipts[0]!.weeksAway).toBe(0);
  });

  it("unknown cost makes value unknown, not zero", () => {
    expect(network([sku("L1", { unitCost: undefined }), sku("S1")]).onHandValue).toBeUndefined();
  });

  it("keeps only the latest snapshot per SKU and location", () => {
    const old = { ...inv("L1", "ST1", 999), snapshotDate: "2026-09-01" };
    expect(latestPositions([old, inv("L1", "ST1", 5)])).toEqual([inv("L1", "ST1", 5)]);
  });
});

function rep(extra: Partial<ReplenishmentInput> = {}) {
  return calculateReplenishmentRequirement({
    available: true,
    planningNow: NOW,
    horizonWeeks: 12,
    leadTimeWeeks: 8,
    horizonDemand: 1200,
    weeklyDemand: 100,
    safetyStockWeeks: 2,
    usableLegacy: 300,
    successorOnHand: 400,
    eligibleInbound: 200,
    receipts: [{ weeksAway: 3, usableUnits: 200, eligible: true }],
    noSuccessor: false,
    ...extra,
  });
}

describe("replenishment", () => {
  it("requirement − usable supply, with legacy counted", () => {
    const r = rep();
    expect(r.requirement).toBe(1400);
    expect(r.recommendedUnits).toBe(500);
    expect(r.ignoringLegacyUnits).toBe(800);
    expect(r.avoidedUnits).toBe(300);
    expect(r.finalOrderUnits).toBe(500);
  });

  it("is never negative", () => {
    const r = rep({ usableLegacy: 5000 });
    expect(r.recommendedUnits).toBe(0);
    expect(r.excessUnits).toBeGreaterThan(0);
    expect(r.ignoringLegacyUnits).toBeGreaterThanOrEqual(r.recommendedUnits);
  });

  it("respects a planner order", () => {
    const r = rep({ orderOverrideUnits: 50 });
    expect(r.finalOrderUnits).toBe(50);
    expect(r.recommendedUnits).toBe(500);
  });

  it("orders nothing without a successor", () => {
    const r = rep({ noSuccessor: true, orderOverrideUnits: 50 });
    expect(r.recommendedUnits).toBe(0);
    expect(r.finalOrderUnits).toBe(0);
    expect(r.ignoringLegacyUnits).toBe(0);
  });

  it("dates when stock falls below safety, and when to order by", () => {
    const r = rep();
    // 700 usable, −100/wk, +200 in week 3: ends week 6 at exactly 200, below it in week 7.
    expect(r.neededByDate).toBe("2026-11-23");
    expect(r.orderByDate).toBe("2026-09-28");
    expect(r.projection).toHaveLength(12);
  });
});

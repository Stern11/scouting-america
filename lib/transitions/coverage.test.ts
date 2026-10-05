import { describe, expect, it } from "vitest";
import {
  calculateProjectedStockout,
  calculateStoreCoverage,
  calculateWeeksOfCover,
  type StoreCoverageInput,
  type StorePositionInput,
} from "./coverage";
import { DEFAULT_THRESHOLDS } from "./assumptions";
import { NOW, store } from "./__fixtures";

function pos(id: string, region: string, recent: number, legacy: number, successor: number, extra: Partial<StorePositionInput> = {}): StorePositionInput {
  return {
    store: store(id, region),
    legacyUnits: legacy,
    successorUnits: successor,
    storeInbound: 0,
    recentUnits: recent,
    recentLegacyUnits: legacy > 0 ? recent / 2 : 0,
    onSuccessorProfile: null,
    ...extra,
  };
}

function coverage(stores: StorePositionInput[], extra: Partial<StoreCoverageInput> = {}) {
  return calculateStoreCoverage({
    stores,
    planningNow: NOW,
    networkWeeklyDemand: 100,
    recentWeeks: 8,
    substitutabilityPct: 1,
    legacyBlocked: false,
    nextReceiptWeeks: 3,
    leadTimeWeeks: 8,
    horizonWeeks: 12,
    dcAvailableUsable: 0,
    sellThroughWeeks: 8,
    demandAdjustmentPct: 0,
    thresholds: DEFAULT_THRESHOLDS,
    legacySkuId: "L1",
    successorSkuId: "S1",
    ...extra,
  });
}

const row = (c: ReturnType<typeof coverage>, id: string) => c.rows.find((r) => r.store.storeId === id)!;

describe("weeks of cover and stockout date", () => {
  it("never divides by zero", () => {
    expect(calculateWeeksOfCover(10, 0)).toBeNull();
    expect(calculateWeeksOfCover(10, -1)).toBeNull();
    expect(calculateWeeksOfCover(0, 5)).toBe(0);
    expect(calculateProjectedStockout(NOW, null)).toBeNull();
  });
  it("stockout = planning date + cover", () => {
    expect(calculateProjectedStockout(NOW, 2)).toBe("2026-10-19");
    expect(calculateProjectedStockout(NOW, 0.5)).toBe("2026-10-08");
  });
});

describe("store coverage", () => {
  it("store demand is a share of network demand and sums back to it", () => {
    const c = coverage([pos("A", "R1", 30, 0, 300), pos("B", "R1", 70, 0, 700)]);
    expect(c.rows.reduce((n, r) => n + r.weeklyDemand, 0)).toBeCloseTo(100);
    expect(row(c, "A").weeksOfCover).toBeCloseTo(10);
  });

  it("a store with no demand has no cover and is never at risk", () => {
    const c = coverage([pos("A", "R1", 0, 0, 30), pos("B", "R1", 10, 0, 200)]);
    expect(row(c, "A").weeksOfCover).toBeNull();
    expect(row(c, "A").stockoutDate).toBeNull();
    expect(row(c, "A").atRisk).toBe(false);
  });

  it("at risk = runs out before the next receipt plus transit", () => {
    // resupply = 3 + 1 = 4 weeks. Cover 3.5 is at risk, 4.5 is not.
    const c = coverage([pos("A", "R1", 50, 0, 175), pos("B", "R1", 50, 0, 225)]);
    expect(c.resupplyWeeks).toBe(4);
    expect(row(c, "A").atRisk).toBe(true);
    expect(row(c, "A").stockoutDays).toBe(4);
    expect(row(c, "B").atRisk).toBe(false);
  });

  it("with nothing on order, the window is lead time plus transit", () => {
    const c = coverage([pos("A", "R1", 50, 0, 400), pos("B", "R1", 50, 0, 500)], { nextReceiptWeeks: null });
    expect(c.resupplyWeeks).toBe(9);
    expect(row(c, "A").atRisk).toBe(true); // 8 weeks
    expect(row(c, "B").atRisk).toBe(false); // 10 weeks
  });

  it("substitutability scales legacy stock in usable units", () => {
    const c = coverage([pos("A", "R1", 100, 100, 0)], { substitutabilityPct: 0.5 });
    expect(row(c, "A").usableUnits).toBe(50);
    expect(coverage([pos("A", "R1", 100, 100, 0)], { legacyBlocked: true }).rows[0]!.usableUnits).toBe(0);
  });

  it("classifies stock state", () => {
    const c = coverage([pos("A", "R1", 10, 5, 0), pos("B", "R1", 10, 5, 5), pos("C", "R1", 10, 0, 5), pos("D", "R1", 10, 0, 0)]);
    expect(c.stateCounts).toEqual({ LEGACY_ONLY: 1, MIXED: 1, NEW_ONLY: 1, NO_STOCK: 1 });
  });

  it("projects stranded legacy at the store's legacy sell rate", () => {
    // 8 legacy sold over 8 weeks = 1/wk; 8-week window sells 8 of 30.
    const c = coverage([pos("A", "R1", 16, 30, 0, { recentLegacyUnits: 8 })]);
    expect(row(c, "A").strandedLegacyUnits).toBe(22);
  });
});

describe("transfers", () => {
  it("moves legacy from a same-region donor to the at-risk store, only as much as needed", () => {
    const c = coverage([
      pos("A", "R1", 10, 0, 5), // weekly 10, 0.5 wks — at risk
      pos("B", "R1", 10, 200, 0), // 20 wks — donor
      pos("C", "R2", 10, 400, 0), // 40 wks — bigger donor, other region
      pos("E", "R1", 70, 0, 400),
    ]);
    expect(c.transfers).toHaveLength(1);
    const t = c.transfers[0]!;
    expect(t.fromStoreId).toBe("B");
    expect(t.sameRegion).toBe(true);
    expect(t.skuRole).toBe("legacy");
    expect(t.skuId).toBe("L1");
    // Target = max(4 target weeks, 4 weeks to resupply) → 40 usable; has 5.
    expect(t.units).toBe(35);
    expect(t.toCoverAfter).toBeCloseTo(4);
    expect(row(c, "A").atRiskAfterPlan).toBe(false);
    expect(row(c, "A").recommendation).toBe("TRANSFER_IN");
    expect(row(c, "B").recommendation).toBe("TRANSFER_OUT");
    expect(c.atRiskAfterPlanCount).toBe(0);
  });

  it("never takes a donor below its floor", () => {
    const c = coverage([pos("A", "R1", 10, 0, 0), pos("B", "R1", 10, 90, 0), pos("E", "R1", 80, 0, 900)]);
    const out = c.transfers.filter((t) => t.fromStoreId === "B").reduce((n, t) => n + t.units, 0);
    // Donor B: 90 units at 10/wk, floor 4 weeks → may give at most 50.
    expect(out).toBeLessThanOrEqual(50);
    expect(row(c, "B").weeksOfCoverAfterPlan!).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.donorFloorWeeks - 1e-9);
    for (const t of c.transfers) expect(t.fromCoverAfter).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.donorFloorWeeks - 1e-9);
  });

  it("moves successor stock when legacy cannot stand in for it", () => {
    const c = coverage([pos("A", "R1", 10, 0, 0), pos("B", "R1", 10, 100, 200), pos("E", "R1", 80, 0, 900)], {
      substitutabilityPct: 0,
    });
    expect(c.transfers.length).toBeGreaterThan(0);
    expect(c.transfers.every((t) => t.skuRole === "successor" && t.skuId === "S1")).toBe(true);
  });

  it("skips transfers below the minimum", () => {
    // Donor surplus is 2 units: 42 usable at 10/wk over a 4-week floor.
    const c = coverage([pos("A", "R1", 10, 0, 0), pos("B", "R1", 10, 0, 0), pos("C", "R1", 1, 9, 0), pos("E", "R1", 79, 0, 900)]);
    expect(c.transfers.filter((t) => t.units < DEFAULT_THRESHOLDS.minTransferUnits)).toEqual([]);
  });

  it("uses DC stock for what transfers do not cover, and flags the rest", () => {
    // E holds 7.5 weeks — under the excess line, so nobody can donate.
    const stores = [pos("A", "R1", 10, 0, 0), pos("B", "R1", 10, 0, 0), pos("E", "R1", 80, 0, 600)];
    const withDc = coverage(stores, { dcAvailableUsable: 45 });
    expect(withDc.transfers).toEqual([]);
    expect(withDc.replenishFromDcUnits).toBe(45);
    expect(withDc.atRiskCount).toBe(2);
    expect(withDc.atRiskAfterPlanCount).toBe(1);
    expect(withDc.rows.filter((r) => r.recommendation === "EXPEDITE")).toHaveLength(1);
  });
});

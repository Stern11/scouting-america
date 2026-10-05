import { describe, expect, it } from "vitest";
import { SalesIndex, sumInWindow } from "./sales";
import { calculateContinuityDemand, splitAcrossSuccessors } from "./demand";
import { NOW, yearSale } from "./__fixtures";
import type { SalesRow } from "@/types/dataset";

function demand(rows: SalesRow[], pred: string[], succ: string[], extra: Partial<Parameters<typeof calculateContinuityDemand>[0]> = {}) {
  return calculateContinuityDemand({
    predecessorSkuIds: pred,
    successorSkuIds: succ,
    sales: new SalesIndex(rows),
    planningNow: NOW,
    horizonWeeks: 13,
    transferredDemandPct: 1,
    demandAdjustmentPct: 0,
    ...extra,
  });
}

describe("SalesIndex", () => {
  it("prorates a row by overlapping days", () => {
    const row: SalesRow = { skuId: "A", periodStart: "2026-09-01", periodEnd: "2026-09-30", units: 300 };
    expect(sumInWindow([row], "2026-09-01", "2026-09-11")).toBeCloseTo(100);
    expect(sumInWindow([row], "2026-10-01", "2026-10-05")).toBe(0);
  });

  it("totals a SKU from network rows only when both network and store rows exist", () => {
    const rows: SalesRow[] = [
      { skuId: "A", periodStart: "2026-09-01", periodEnd: "2026-09-30", units: 300 },
      { skuId: "A", storeId: "S1", periodStart: "2026-09-01", periodEnd: "2026-09-30", units: 200 },
      { skuId: "A", storeId: "S2", periodStart: "2026-09-01", periodEnd: "2026-09-30", units: 100 },
    ];
    const index = new SalesIndex(rows);
    expect(index.networkUnits("A", "2026-09-01", "2026-10-01")).toBeCloseTo(300);
    expect(index.storeUnits("A", "S1", "2026-09-01", "2026-10-01")).toBeCloseTo(200);
    expect(index.allStoreUnits("A", "2026-09-01", "2026-10-01")).toBeCloseTo(300);
  });

  it("totals a SKU from store rows when it has no network rows", () => {
    const index = new SalesIndex([
      { skuId: "A", storeId: "S1", periodStart: "2026-09-01", periodEnd: "2026-09-30", units: 200 },
      { skuId: "A", storeId: "S2", periodStart: "2026-09-01", periodEnd: "2026-09-30", units: 100 },
    ]);
    expect(index.networkUnits("A", "2026-09-01", "2026-10-01")).toBeCloseTo(300);
  });
});

describe("continuity demand", () => {
  it("one-to-one: carries legacy sales into the stream with successor sales counted once", () => {
    const d = demand([yearSale("L1", 10400), yearSale("S1", 2600)], ["L1"], ["S1"]);
    expect(d.legacyUnitsL52).toBe(10400);
    expect(d.successorUnitsL52).toBe(2600);
    // legacy × transfer + successor — never legacy history + a successor forecast
    expect(d.baselineAnnualUnits).toBe(13000);
    // A full, even year of history: seasonality is read from it and is flat.
    expect(d.seasonalityBasis).toBe("history");
    expect(d.seasonalityFactor).toBeCloseTo(1, 6);
    expect(d.horizonUnits).toBe(Math.round((13000 * 13) / 52));
    expect(d.weeklyUnits).toBeCloseTo(d.horizonUnits / 13);
  });

  it("applies transferred demand only to the legacy part", () => {
    const d = demand([yearSale("L1", 10000), yearSale("S1", 2000)], ["L1"], ["S1"], { transferredDemandPct: 0.5 });
    expect(d.baselineAnnualUnits).toBe(7000);
  });

  it("many-to-one sums predecessors, each sale counted once", () => {
    const d = demand([yearSale("L1", 6000), yearSale("L2", 4000), yearSale("S1", 1000)], ["L1", "L2"], ["S1"]);
    expect(d.baselineAnnualUnits).toBe(11000);
  });

  it("one-to-many divides demand across successors and the parts sum to the whole", () => {
    const d = demand([yearSale("L1", 10007)], ["L1"], ["S1", "S2", "S3"], { successorSplit: { S1: 0.5, S2: 0.3, S3: 0.2 } });
    const total = d.bySuccessor.reduce((n, s) => n + s.horizonUnits, 0);
    expect(total).toBe(d.horizonUnits);
    expect(d.baselineAnnualUnits).toBe(10007);
    expect(d.bySuccessor.map((s) => s.share)).toEqual([0.5, 0.3, 0.2].map((x) => expect.closeTo(x, 9)));
  });

  it("splitAcrossSuccessors falls back to equal shares and stays exact", () => {
    const parts = splitAcrossSuccessors(["A", "B", "C"], 100, undefined, new SalesIndex([]), "2026-01-01", NOW);
    expect(parts.reduce((n, p) => n + p.horizonUnits, 0)).toBe(100);
  });

  it("an override replaces the horizon figure but keeps the calculated one", () => {
    const d = demand([yearSale("L1", 5200)], ["L1"], ["S1"], { demandOverrideUnits: 999 });
    expect(d.horizonUnits).toBe(999);
    expect(d.overridden).toBe(true);
    expect(d.calculatedHorizonUnits).toBe(1300);
  });

  it("less than a year of history falls back to a flat rate", () => {
    const d = demand([{ skuId: "S1", periodStart: "2026-07-01", periodEnd: "2026-10-04", units: 1000 }], [], ["S1"]);
    expect(d.seasonalityBasis).toBe("flat");
    expect(d.transitionProgress).toBe(1);
  });

  it("no sales means continuity is not available", () => {
    expect(demand([], ["L1"], ["S1"]).available).toBe(false);
  });

  it("trend is clamped", () => {
    const prior = yearSale("L1", 1000, "2025-10-06");
    const d = demand([prior, yearSale("L1", 10000)], ["L1"], ["S1"]);
    expect(d.trendFactor).toBe(1.25);
  });
});

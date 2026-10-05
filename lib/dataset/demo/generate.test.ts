import { describe, expect, it } from "vitest";
import { DEMO_PLANNING_NOW, DEFAULT_DEMO_SEED, generateDemoDataset, generateDemoRawInput, largestRemainder } from "./generate";
import { buildTransitions } from "@/lib/transitions/build";
import { summarizePortfolio, networkImpact } from "@/lib/transitions/portfolio";
import { salesIndexFor } from "@/lib/transitions/sales";
import { RECENT_WEEKS } from "@/lib/transitions/assumptions";
import { addDaysTo } from "@/lib/transitions/time";

const ds = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
const views = buildTransitions(ds);
const byId = (id: string) => {
  const v = views.find((x) => x.id === id);
  if (!v) throw new Error(`missing ${id}`);
  return v;
};

describe("determinism", () => {
  it("same seed, same anchor → identical raw input", () => {
    const a = generateDemoRawInput({ planningNow: DEMO_PLANNING_NOW });
    const b = generateDemoRawInput({ planningNow: DEMO_PLANNING_NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("a different seed produces a different dataset", () => {
    const a = generateDemoRawInput({ planningNow: DEMO_PLANNING_NOW });
    const b = generateDemoRawInput({ seed: "another-seed", planningNow: DEMO_PLANNING_NOW });
    expect(JSON.stringify(b.sales)).not.toBe(JSON.stringify(a.sales));
    expect(b.metadata.seed).toBe("another-seed");
    expect(a.metadata.seed).toBe(DEFAULT_DEMO_SEED);
  });

  it("anchors every date to the planning date it is given", () => {
    const raw = generateDemoRawInput({ planningNow: "2027-02-01T09:00:00.000Z" });
    expect(raw.metadata.planningNow).toBe("2027-02-01");
    expect(raw.inventory?.every((r) => r.snapshot_date === "2027-02-01")).toBe(true);
  });

  it("largestRemainder is exact", () => {
    expect(largestRemainder(10, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(10);
    expect(largestRemainder(0, [1, 2])).toEqual([0, 0]);
    expect(largestRemainder(5, [0, 0])).toEqual([0, 0]);
  });
});

describe("the dataset is internally consistent", () => {
  it("has 120 stores, all capabilities, and only known stores in store-level sales", () => {
    expect(ds.stores).toHaveLength(120);
    expect(Object.values(ds.metadata.capabilities).every(Boolean)).toBe(true);
    const stores = new Set(ds.stores.map((s) => s.storeId));
    const skus = new Set(ds.skus.map((s) => s.skuId));
    for (const r of ds.sales) {
      if (r.storeId) expect(stores.has(r.storeId)).toBe(true);
      expect(skus.has(r.skuId)).toBe(true);
    }
    for (const r of ds.inventory) if (r.locationType === "STORE") expect(stores.has(r.locationId)).toBe(true);
  });

  it("store sales over the recent window reconcile to network sales for that window", () => {
    const index = salesIndexFor(ds);
    const from = addDaysTo(ds.metadata.planningNow, -RECENT_WEEKS * 7);
    const now = ds.metadata.planningNow;
    const withStores = [...new Set(ds.sales.filter((r) => r.storeId).map((r) => r.skuId))];
    expect(withStores.length).toBeGreaterThan(50);
    for (const skuId of withStores) {
      const network = index.networkUnits(skuId, from, now);
      const stores = index.allStoreUnits(skuId, from, now);
      expect(Math.abs(stores - network)).toBeLessThanOrEqual(1);
    }
  });
});

describe("the showcase story holds", () => {
  it("portfolio shape", () => {
    const s = summarizePortfolio(views, ds.stores.length);
    expect(s.total).toBeGreaterThanOrEqual(145);
    expect(s.total).toBeLessThanOrEqual(155);
    expect(s.active).toBeGreaterThanOrEqual(40);
    expect(s.active).toBeLessThanOrEqual(45);
    expect(s.attention).toBeGreaterThanOrEqual(5);
    expect(s.attention).toBeLessThanOrEqual(8);
    expect(s.storesMonitored).toBe(120);
    expect(s.unconfirmedRelationships).toBe(3);
    const impact = networkImpact(views);
    expect(impact.portfolioSize).toBe(s.total);
    expect(impact.extrapolated.purchasingAvoidedUnits).toBeGreaterThanOrEqual(impact.measured.purchasingAvoidedUnits);
  });

  it("A + C — Cub Scout Shirt: stores run out while the network looks covered", () => {
    const v = byId("TR-1001");
    expect(v.lineage.predecessors.map((s) => s.skuId)).toEqual(["CS-1048"]);
    expect(v.lineage.successors.map((s) => s.skuId)).toEqual(["CS-2841"]);
    expect(v.status).toBe("ACTION_NEEDED");
    expect(v.coverage.atRiskCount).toBe(17);
    expect(v.coverage.storeCount).toBe(120);
    expect(v.inventory.stores.legacy).toBe(2140);
    expect(v.inventory.dc.legacy).toBe(0);
    expect(v.coverage.transfers.length).toBeGreaterThan(0);
    expect(v.replenishment.recommendedUnits).toBeLessThan(v.replenishment.ignoringLegacyUnits);
    expect(v.inventory.networkWeeksOfCover!).toBeGreaterThan(4);
    expect(v.replenishment.jda?.plannedOrderUnits).toBe(2900);
  });

  it("B — Webelos Belt: the successor buy can wait", () => {
    expect(byId("TR-1002").actions.some((a) => a.type === "HOLD_REPLENISHMENT")).toBe(true);
  });

  it("E — Wolf Neckerchief: the late shipment needs expediting", () => {
    expect(byId("TR-1003").actions.some((a) => a.type === "ACCELERATE_INBOUND")).toBe(true);
  });

  it("D — Scouts BSA Hat: a high-confidence match waiting for confirmation", () => {
    const v = byId("sug-SB-4412");
    expect(v.lineage.source).toBe("SUGGESTED");
    expect(v.lineage.confirmed).toBe(false);
    expect(v.lineage.confidence).toBe("HIGH");
    expect(v.actions.some((a) => a.type === "CONFIRM_SUCCESSOR")).toBe(true);
  });

  it("covers every relationship shape", () => {
    const types = new Set(views.map((v) => v.lineage.type));
    for (const t of ["ONE_TO_ONE", "MANY_TO_ONE", "ONE_TO_MANY", "NO_SUCCESSOR", "NEW_PRODUCT"]) expect(types.has(t as never)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { normalizePlanningInput, parseSplit, splitSkuList } from "./normalize";
import type { RawPlanningInput, RawRow } from "@/types/dataset";

const META: RawPlanningInput["metadata"] = {
  id: "t",
  name: "t",
  mode: "UPLOADED",
  createdAt: "2026-10-05",
  planningNow: "2026-10-05",
  currency: "USD",
};

const sku = (id: string, extra: RawRow = {}): RawRow => ({
  sku_id: id,
  sku_name: `${id} name`,
  product_family: "Fam",
  category: "Uniforms",
  status: "ACTIVE",
  unit_cost: 5,
  ...extra,
});

function run(input: Partial<RawPlanningInput>) {
  return normalizePlanningInput({ metadata: META, ...input });
}

describe("inventory", () => {
  it("derives available as on_hand − allocated when available is blank", () => {
    const { dataset } = run({
      skus: [sku("A")],
      inventory: [{ sku_id: "A", location_id: "DC-1", location_type: "DC", on_hand: 1400, allocated: 200 }],
    });
    expect(dataset.inventory[0]).toMatchObject({ onHand: 1400, allocated: 200, available: 1200 });
  });

  it("never lets available exceed on hand, nor allocated exceed it either", () => {
    const { dataset } = run({
      skus: [sku("A")],
      inventory: [{ sku_id: "A", location_id: "ST-1", location_type: "store", on_hand: 10, allocated: 50, available: 30 }],
    });
    expect(dataset.inventory[0]).toMatchObject({ locationType: "STORE", allocated: 10, available: 10 });
  });
});

describe("transitions", () => {
  const skus = ["A", "B", "C", "D"].map((id) => sku(id));
  const t = (pred: string, succ: string, extra: RawRow = {}): RawRow => ({
    transition_id: `T-${pred}-${succ}`,
    transition_name: "x",
    predecessor_sku_ids: pred,
    successor_sku_ids: succ,
    ...extra,
  });

  it("infers the transition type from the SKU counts", () => {
    const { dataset } = run({
      skus,
      transitions: [t("A", "B"), t("A, B", "C"), t("A", "B + C"), t("A", ""), t("", "D")],
    });
    expect(dataset.transitions.map((r) => r.transitionType)).toEqual([
      "ONE_TO_ONE",
      "MANY_TO_ONE",
      "ONE_TO_MANY",
      "NO_SUCCESSOR",
      "NEW_PRODUCT",
    ]);
  });

  it("uses the counts over a stated type that contradicts them, and says so", () => {
    const { dataset, collector } = run({ skus, transitions: [t("A, B", "C", { transition_type: "ONE_TO_ONE" })] });
    expect(dataset.transitions[0]!.transitionType).toBe("MANY_TO_ONE");
    expect(collector.all().some((i) => i.code === "type_mismatch" && i.severity === "warning")).toBe(true);
  });

  it("drops unknown SKUs from a transition with a warning, and the whole row only when none are known", () => {
    const { dataset, collector } = run({ skus, transitions: [t("A, ZZ", "B"), t("YY", "XX")] });
    expect(dataset.transitions).toHaveLength(1);
    expect(dataset.transitions[0]!.predecessorSkuIds).toEqual(["A"]);
    const issues = collector.all();
    expect(issues.some((i) => i.code === "unknown_sku_predecessor_sku_ids" && i.severity === "warning")).toBe(true);
    expect(issues.some((i) => i.code === "empty_transition" && i.severity === "error")).toBe(true);
  });

  it("parses a successor split and planner flags", () => {
    const { dataset } = run({
      skus,
      transitions: [t("A", "B, C", { successor_split: "B:60%, C:40%", planner_confirmed: "Y", closed: "n", substitutability_pct: 80 })],
    });
    expect(dataset.transitions[0]).toMatchObject({
      successorSplit: { B: 0.6, C: 0.4 },
      plannerConfirmed: true,
      closed: false,
      substitutabilityPct: 0.8,
      source: "PLANNER",
    });
  });
});

describe("cell helpers", () => {
  it("splits SKU lists on commas, semicolons and plus signs, de-duplicated", () => {
    expect(splitSkuList("CS-1048, CS-1049;CS-1050 + CS-1048")).toEqual(["CS-1048", "CS-1049", "CS-1050"]);
    expect(splitSkuList("")).toEqual([]);
    expect(splitSkuList(null)).toEqual([]);
  });

  it("parses successor splits in percent or fraction form", () => {
    expect(parseSplit("SP-1:60%, SP-2:0.4")).toEqual({ "SP-1": 0.6, "SP-2": 0.4 });
    expect(parseSplit("")).toBeUndefined();
  });
});

describe("sales and unknown references", () => {
  it("drops sales for an unknown SKU or store with a warning", () => {
    const { dataset, collector } = run({
      stores: [{ store_id: "ST-1", store_name: "One" }],
      skus: [sku("A")],
      sales: [
        { sku_id: "A", period_start: "2026-09-01", period_end: "2026-09-30", units_sold: 10 },
        { sku_id: "Q", period_start: "2026-09-01", period_end: "2026-09-30", units_sold: 10 },
        { sku_id: "A", period_start: "2026-09-01", period_end: "2026-09-30", units_sold: 10, store_id: "ST-9" },
      ],
    });
    expect(dataset.sales).toHaveLength(1);
    const codes = collector.all().map((i) => i.code);
    expect(codes).toContain("unknown_sku");
    expect(codes).toContain("unknown_store");
  });

  it("rejects a sales period that ends before it starts", () => {
    const { dataset, collector } = run({
      skus: [sku("A")],
      sales: [{ sku_id: "A", period_start: "2026-09-30", period_end: "2026-09-01", units_sold: 10 }],
    });
    expect(dataset.sales).toHaveLength(0);
    expect(collector.all().some((i) => i.code === "reversed_period")).toBe(true);
  });

  it("ignores a replacement_sku_id that names no known SKU", () => {
    const { dataset } = run({ skus: [sku("A", { replacement_sku_id: "NOPE" })] });
    expect(dataset.skus[0]!.replacementSkuId).toBeUndefined();
  });
});

describe("capabilities", () => {
  it("records exactly which optional data arrived", () => {
    const { dataset } = run({
      stores: [{ store_id: "ST-1", store_name: "One" }],
      skus: [sku("A"), sku("B")],
      sales: [{ sku_id: "A", period_start: "2026-09-01", period_end: "2026-09-30", units_sold: 10, store_id: "ST-1" }],
      inventory: [{ sku_id: "A", location_id: "ST-1", location_type: "STORE", on_hand: 3 }],
    });
    expect(dataset.metadata.capabilities).toEqual({
      salesHistory: true,
      storeLevelDemand: true,
      storeInventory: true,
      dcInventory: false,
      inboundSupply: false,
      currentPlan: false,
      sellingProfiles: false,
      unitCosts: true,
    });
  });

  it("reports unit costs unavailable when a transitioning SKU has none", () => {
    const { dataset } = run({
      skus: [sku("A"), sku("B", { unit_cost: null })],
      transitions: [{ transition_id: "T", transition_name: "x", predecessor_sku_ids: "A", successor_sku_ids: "B" }],
    });
    expect(dataset.metadata.capabilities.unitCosts).toBe(false);
  });
});

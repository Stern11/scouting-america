import { describe, expect, it } from "vitest";
import { generateDemoDataset } from "@/lib/dataset/demo/generate";
import type { BomRow, HistoricalItemRow } from "@/types/dataset";
import {
  RANK_DECAY,
  SIMILARITY_SHARPNESS,
  blendAnalogueBoms,
  blendShares,
  describeAnalogueBasis,
  findAnalogues,
} from "./analogues";
import { buildSituations } from "./build";
import { analogueKey } from "./scenario";

function item(id: string, over: Partial<HistoricalItemRow> = {}): HistoricalItemRow {
  return {
    id,
    itemId: id,
    itemName: id,
    historicalPeriod: "2026-Halloween",
    brand: "Northbay",
    productFamily: "Variety Bags",
    actualUnits: 1000,
    formulaFamily: "Milk",
    packagingType: "Film",
    packFormat: "Bag",
    basePack: "BP-1",
    packSize: 12,
    customer: "Retailer A",
    ...over,
  } as HistoricalItemRow;
}

function bom(parent: string, componentId: string, qty: number): BomRow {
  return {
    parentItemId: parent,
    componentId,
    componentName: componentId,
    componentType: "RAW_MATERIAL",
    quantityPerParent: qty,
    uom: "kg",
  } as BomRow;
}

const TARGET = item("target");

describe("findAnalogues — default blend weighting", () => {
  // Four products identical to the target on every attribute, differing only
  // in when they ran. The old rule split them 25/25/25/25.
  const pool = [
    item("a", { productionWindow: { start: "2024-05-01", end: "2024-07-31" } }),
    item("b", { productionWindow: { start: "2026-05-01", end: "2026-07-31" } }),
    item("c", { productionWindow: { start: "2025-05-01", end: "2025-07-31" } }),
    item("d", { productionWindow: { start: "2023-05-01", end: "2023-07-31" } }),
  ];
  const boms = new Map(pool.map((p) => [p.itemId, [bom(p.itemId, "cocoa", 1)]]));

  it("leads with the closest, breaks similarity ties by recency, and adds to 100%", () => {
    const found = findAnalogues(TARGET, pool, boms);
    expect(found.map((a) => a.candidateId)).toEqual(["b", "c", "a", "d"]);
    expect(found.reduce((s, a) => s + a.weight, 0)).toBeCloseTo(1, 12);

    const raw = [1, RANK_DECAY, RANK_DECAY ** 2, RANK_DECAY ** 3];
    const total = raw.reduce((s, w) => s + w, 0);
    found.forEach((a, i) => expect(a.weight).toBeCloseTo(raw[i]! / total, 12));

    // Skewed enough to name the product the BOM is read from.
    expect(found[0]!.weight).toBeGreaterThan(0.55);
    expect(found[0]!.weight).toBeLessThan(0.7);
    for (let i = 1; i < found.length; i++) expect(found[i]!.weight).toBeLessThan(found[i - 1]!.weight);
  });

  it("a less similar product falls away faster than rank alone", () => {
    const closer = item("close");
    const farther = item("far", { customer: "Retailer B", brand: "Other" });
    const found = findAnalogues(TARGET, [farther, closer], new Map([
      ["close", [bom("close", "cocoa", 1)]],
      ["far", [bom("far", "cocoa", 1)]],
    ]));
    expect(found[0]!.candidateId).toBe("close");
    const far = found[1]!;
    const expectedRaw = far.similarity ** SIMILARITY_SHARPNESS * RANK_DECAY;
    expect(far.weight).toBeCloseTo(expectedRaw / (1 + expectedRaw), 12);
  });

  it("is independent of the order the pool arrives in", () => {
    const forward = findAnalogues(TARGET, pool, boms);
    const reversed = findAnalogues(TARGET, [...pool].reverse(), boms);
    expect(reversed).toEqual(forward);
  });

  it("the blended BOM follows the skew, and confidence still counts every analogue", () => {
    const skewPool = [
      item("new", { productionWindow: { start: "2026-05-01", end: "2026-07-31" } }),
      item("old", { productionWindow: { start: "2025-05-01", end: "2025-07-31" } }),
    ];
    const skewBoms = new Map([
      ["new", [bom("new", "cocoa", 2), bom("new", "tin", 1)]],
      ["old", [bom("old", "cocoa", 1)]],
    ]);
    const found = findAnalogues(TARGET, skewPool, skewBoms);
    const [lead, tail] = found;
    const lines = blendAnalogueBoms(found, skewBoms);
    const cocoa = lines.find((l) => l.componentId === "cocoa")!;
    const tin = lines.find((l) => l.componentId === "tin")!;
    expect(cocoa.quantityPerParent).toBeCloseTo(2 * lead!.weight + 1 * tail!.weight, 12);
    expect(cocoa.confidence).toBeCloseTo(1, 12);
    expect(tin.confidence).toBeCloseTo(lead!.weight, 12);
  });

  it("describes the blend by the share its lead carries, not a similarity score", () => {
    const found = findAnalogues(TARGET, pool, boms);
    const share = Math.round(blendShares(found).get("b")! * 100);
    expect(describeAnalogueBasis(found)).toBe(`Read from 4 comparable products, led by b (${share}% of the blend)`);
    expect(describeAnalogueBasis(found)).not.toMatch(/attributes agree/);
  });
});

describe("analogue blends in the demo", () => {
  const dataset = generateDemoDataset({ planningNow: "2026-09-15T09:00:00Z" });
  const situations = buildSituations(dataset);
  const derived = situations.flatMap((s) =>
    s.candidateItems.filter((c) => c.derivation === "analogue").map((c) => ({ s, c }))
  );

  it("every unspecified item's blend is led by one product at 55–70%", () => {
    expect(derived.length).toBeGreaterThan(0);
    for (const { c } of derived) {
      const shares = [...blendShares(c.analogues).values()].sort((a, b) => b - a);
      expect(shares[0]).toBeGreaterThan(0.55);
      expect(shares[0]).toBeLessThan(0.7);
      expect(new Set(shares.map((x) => x.toFixed(6))).size).toBe(shares.length);
    }
  });

  it("a planner's weight still wins over the default", () => {
    const { s, c } = derived[0]!;
    const lead = c.analogues[0]!;
    const tail = c.analogues[c.analogues.length - 1]!;
    const rebuilt = buildSituations(dataset, {
      analogueWeightsBySituation: {
        [s.id]: { [analogueKey(c.id, lead.candidateId)]: 0, [analogueKey(c.id, tail.candidateId)]: 1 },
      },
    })
      .find((x) => x.id === s.id)!
      .candidateItems.find((x) => x.id === c.id)!;

    const shares = blendShares(rebuilt.analogues);
    expect(shares.has(lead.candidateId)).toBe(false);
    const top = [...shares.entries()].sort((a, b) => b[1] - a[1])[0]!;
    expect(top[0]).toBe(tail.candidateId);
  });
});

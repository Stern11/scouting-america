import { describe, it, expect } from "vitest";
import { buildSituations, median, percentile, type BuildSituationsOptions } from "./build";
import { addDays, weeksBetween } from "@/lib/dataset/periods";
import type {
  BomRow,
  BusinessPlanRow,
  CurrentPlanRow,
  DatasetMetadata,
  HistoricalItemRow,
  InventorySupplyRow,
  ItemLineMappingRow,
  LeadTimeHistoryRow,
  LineCapacityRow,
  PlanningDataset,
} from "@/types/dataset";
import type { PlanningSituation } from "@/types/situation";
import { generateDemoDataset } from "@/lib/dataset/demo/generate";

/* ------------------------------------------------------------------ */
/* Fixture helpers                                                     */
/* ------------------------------------------------------------------ */

function meta(planningNow: string, currency = "USD"): DatasetMetadata {
  return {
    id: "ds_test",
    name: "Test dataset",
    mode: "UPLOADED",
    createdAt: "2027-01-01T00:00:00.000Z",
    planningNow,
    currency,
    capabilities: {
      reconciliation: true,
      capacity: true,
      materials: true,
      leadTimeAnalysis: true,
      netRequirements: true,
      readinessHistory: false, lineHistory: false,
    },
  };
}

function makeDataset(partial: {
  metadata: DatasetMetadata;
  businessPlans?: BusinessPlanRow[];
  currentPlanItems?: CurrentPlanRow[];
  historicalItems?: HistoricalItemRow[];
  boms?: BomRow[];
  lineCapacity?: LineCapacityRow[];
  itemLineMappings?: ItemLineMappingRow[];
  leadTimeHistory?: LeadTimeHistoryRow[];
  inventorySupply?: InventorySupplyRow[];
}): PlanningDataset {
  return {
    metadata: partial.metadata,
    businessPlans: partial.businessPlans ?? [],
    currentPlanItems: partial.currentPlanItems ?? [],
    historicalItems: partial.historicalItems ?? [],
    boms: partial.boms ?? [],
    lineCapacity: partial.lineCapacity ?? [],
    itemLineMappings: partial.itemLineMappings ?? [],
    leadTimeHistory: partial.leadTimeHistory ?? [],
    inventorySupply: partial.inventorySupply ?? [],
    readinessHistory: [], lineHistory: [],
  };
}

function firstSituation(ds: PlanningDataset, options?: BuildSituationsOptions): PlanningSituation {
  const situations = buildSituations(ds, options);
  expect(situations.length).toBe(1);
  return situations[0]!;
}

/**
 * A single coherent "Halloween 2027" scenario reused across the bridge,
 * candidate-disposition, capacity and mapping-precedence tests:
 *
 *  - Business plan: 100,000 target value / 10,000 target units.
 *  - Formal plan: one item, 6,000 units / 60,000 value (price = $10/unit).
 *  - Prior season (2026): four historical items —
 *      hi_carry    (3,000 u / $30,000) — unmatched -> proposes carry_forward
 *      hi_carry2   (1,000 u / $8,000)  — unmatched -> proposes carry_forward
 *      hi_matched  (1,000 u / $10,000) — attributes match the formal item exactly
 *                                        -> proposes already_represented
 *      hi_exit     (500 u / $5,000)    — status "Discontinued" -> intentional_exit
 *  - An older 2025 season item that must NOT become a candidate.
 *  - BOM lines hung off hi_carry's and hi_carry2's item ids (the analogue basis).
 *  - Capacity: LINE_A carries the formal item AND hi_carry (ITEM-level mapping);
 *    hi_carry2 splits across LINE_D/LINE_D2 (BASE_PACK-level, two allocations).
 *    "Wrong" lines exist at BASE_PACK/PRODUCT_FAMILY level for the same keys,
 *    purely to prove ITEM-level mapping wins over them.
 */
function buildCoreDataset(): PlanningDataset {
  const businessPlans: BusinessPlanRow[] = [
    {
      id: "bp1",
      planningPeriod: "2027-Halloween",
      eventOrProgram: "Halloween",
      businessUnit: "US Retail",
      brand: "Ridgeline",
      targetValue: 100_000,
      targetUnits: 10_000,
      productFamily: "Variety Bags",
      currency: "USD",
    },
  ];

  const currentPlanItems: CurrentPlanRow[] = [
    {
      id: "cp1",
      planningPeriod: "2027-Halloween",
      itemId: "item_2027_a",
      itemName: "Ridgeline Variety Bag 2027",
      brand: "Ridgeline",
      productFamily: "Variety Bags",
      plannedUnits: 6000,
      plannedValue: 60_000,
      eventOrProgram: "Halloween",
      customer: "Walmart",
      channel: "Mass",
      productionWindow: { start: "2027-07-01", end: "2027-07-31" },
      salesWindow: { start: "2027-09-15", end: "2027-10-31" },
    },
  ];

  const historicalItems: HistoricalItemRow[] = [
    {
      id: "hi_2025",
      historicalPeriod: "2025-Halloween",
      itemId: "item_2025_a",
      itemName: "Old bag",
      brand: "Ridgeline",
      productFamily: "Variety Bags",
      actualUnits: 2000,
      actualValue: 20_000,
    },
    {
      id: "hi_carry",
      historicalPeriod: "2026-Halloween",
      itemId: "item_2026_a",
      itemName: "Ridgeline Variety Bag 2026",
      brand: "Zzz Other Brand",
      productFamily: "Zzz Other Family",
      actualUnits: 3000,
      actualValue: 30_000,
      basePack: "POUCH_A",
    },
    {
      id: "hi_matched",
      historicalPeriod: "2026-Halloween",
      itemId: "item_2026_b",
      itemName: "Matched bag",
      brand: "Ridgeline",
      productFamily: "Variety Bags",
      actualUnits: 1000,
      actualValue: 10_000,
      customer: "Walmart",
      channel: "Mass",
      eventOrProgram: "Halloween",
    },
    {
      id: "hi_exit",
      historicalPeriod: "2026-Halloween",
      itemId: "item_2026_c",
      itemName: "Exited bag",
      brand: "Ridgeline",
      productFamily: "Variety Bags",
      actualUnits: 500,
      actualValue: 5000,
      status: "Discontinued",
    },
    {
      id: "hi_carry2",
      historicalPeriod: "2026-Halloween",
      itemId: "item_2026_d",
      itemName: "Second carry bag",
      brand: "Yyy Brand",
      productFamily: "Yyy Family",
      actualUnits: 1000,
      actualValue: 8000,
      basePack: "POUCH_D",
    },
  ];

  const boms: BomRow[] = [
    {
      id: "bom1",
      parentItemId: "item_2026_a",
      componentId: "cocoa",
      componentName: "Cocoa",
      componentType: "RAW_MATERIAL",
      quantityPerParent: 2,
      uom: "KG",
      scrapPct: 0.1,
      planningStatus: "Approved",
    },
    {
      id: "bom2",
      parentItemId: "item_2026_d",
      componentId: "cocoa",
      componentName: "Cocoa",
      componentType: "RAW_MATERIAL",
      quantityPerParent: 2,
      uom: "KG",
      scrapPct: 0.1,
      planningStatus: "Approved",
    },
    {
      id: "bom3",
      parentItemId: "item_2026_a",
      componentId: "wrapper",
      componentName: "Printed Wrapper",
      componentType: "PACKAGING",
      quantityPerParent: 1,
      uom: "EA",
      planningStatus: "Approved",
    },
    {
      id: "bom4",
      parentItemId: "item_2026_d",
      componentId: "tin",
      componentName: "Gift Tin",
      componentType: "PACKAGING",
      quantityPerParent: 1,
      uom: "EA",
      planningStatus: "Approved",
    },
    {
      id: "bom5",
      parentItemId: "item_2026_a",
      componentId: "artwork_design",
      componentName: "Artwork",
      componentType: "ARTWORK",
      quantityPerParent: 1,
      uom: "EA",
    },
    {
      id: "bom6",
      parentItemId: "item_2026_a",
      componentId: "sugar",
      componentName: "Sugar",
      componentType: "RAW_MATERIAL",
      quantityPerParent: 1,
      uom: "KG",
      planningStatus: "Pending release",
    },
  ];

  const lineCapacity: LineCapacityRow[] = (
    [
      ["LINE_A", 40, 0.85],
      ["LINE_D", 100, 0.9],
      ["LINE_D2", 100, 0.9],
      ["LINE_WRONG_BASEPACK", 20, 0.9],
      ["LINE_WRONG_FAMILY", 20, 0.9],
      ["LINE_WRONG_FAMILY_D", 20, 0.9],
    ] as const
  ).map(([lineId, hours, target], i) => ({
    id: `lc_${i}`,
    period: "2027-07",
    plant: "P1",
    lineId,
    lineName: lineId,
    baseCalendarHours: hours,
    plannedMaintenanceHours: 0,
    projectDowntimeHours: 0,
    laborConstraintHours: 0,
    otherConstraintHours: 0,
    customAdjustmentHours: 0,
    targetUtilizationPct: target,
    availableHours: hours,
  }));

  const itemLineMappings: ItemLineMappingRow[] = [
    {
      id: "ilm_cp_a",
      itemOrFamilyId: "item_2027_a",
      mappingLevel: "ITEM",
      lineId: "LINE_A",
      runRateUnitsPerHour: 150,
      allocationPct: 1,
    },
    {
      id: "ilm_item_a",
      itemOrFamilyId: "item_2026_a",
      mappingLevel: "ITEM",
      lineId: "LINE_A",
      runRateUnitsPerHour: 100,
      allocationPct: 1,
    },
    {
      id: "ilm_basepack_a_wrong",
      itemOrFamilyId: "POUCH_A",
      mappingLevel: "BASE_PACK",
      lineId: "LINE_WRONG_BASEPACK",
      runRateUnitsPerHour: 50,
      allocationPct: 1,
    },
    {
      id: "ilm_family_a_wrong",
      itemOrFamilyId: "Zzz Other Family",
      mappingLevel: "PRODUCT_FAMILY",
      lineId: "LINE_WRONG_FAMILY",
      runRateUnitsPerHour: 10,
      allocationPct: 1,
    },
    {
      id: "ilm_basepack_d_1",
      itemOrFamilyId: "POUCH_D",
      mappingLevel: "BASE_PACK",
      lineId: "LINE_D",
      runRateUnitsPerHour: 200,
      allocationPct: 0.6,
    },
    {
      id: "ilm_basepack_d_2",
      itemOrFamilyId: "POUCH_D",
      mappingLevel: "BASE_PACK",
      lineId: "LINE_D2",
      runRateUnitsPerHour: 100,
      allocationPct: 0.4,
    },
    {
      id: "ilm_family_d_wrong",
      itemOrFamilyId: "Yyy Family",
      mappingLevel: "PRODUCT_FAMILY",
      lineId: "LINE_WRONG_FAMILY_D",
      runRateUnitsPerHour: 5,
      allocationPct: 1,
    },
  ];

  return makeDataset({
    metadata: meta("2027-06-01"),
    businessPlans,
    currentPlanItems,
    historicalItems,
    boms,
    lineCapacity,
    itemLineMappings,
  });
}

/* ------------------------------------------------------------------ */
/* percentile / median                                                 */
/* ------------------------------------------------------------------ */

describe("percentile", () => {
  it("returns 0 for an empty array", () => {
    expect(percentile([], 0.8)).toBe(0);
  });

  it("computes P80 over an odd-length array", () => {
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
  });

  it("computes P50 over an even-length array (no interpolation — picks the ceiling index)", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
  });

  it("computes P80 over five values", () => {
    expect(percentile([10, 20, 30, 40, 50], 0.8)).toBe(40);
  });
});

describe("median", () => {
  it("returns 0 for an empty array", () => {
    expect(median([])).toBe(0);
  });

  it("returns the middle value for an odd-length array", () => {
    expect(median([1, 3, 2])).toBe(2);
  });

  it("averages the two middle values for an even-length array", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

/* ------------------------------------------------------------------ */
/* Bridge arithmetic                                                   */
/* ------------------------------------------------------------------ */

describe("bridge arithmetic", () => {
  it("computes expected - formal = unresolved and representedPct, on the core scenario", () => {
    const situation = firstSituation(buildCoreDataset());
    expect(situation.bridge.expectedValue).toBe(100_000);
    expect(situation.bridge.formalValue).toBe(60_000);
    expect(situation.bridge.unresolvedValue).toBe(40_000);
    expect(situation.bridge.expectedValue - situation.bridge.formalValue).toBe(
      situation.bridge.unresolvedValue
    );
    expect(situation.bridge.representedPct).toBeCloseTo(0.6, 10);
    expect(situation.bridge.expectedUnits).toBe(10_000);
    expect(situation.bridge.formalUnits).toBe(6000);
    expect(situation.bridge.unresolvedUnits).toBe(4000);
  });

  it("clamps unresolved value and units to 0 when the formal plan exceeds the target (never negative)", () => {
    const ds = makeDataset({
      metadata: meta("2027-01-01"),
      businessPlans: [
        {
          id: "bp1",
          planningPeriod: "2027-Clamp",
          eventOrProgram: "Clamp",
          businessUnit: "US",
          brand: "B",
          targetValue: 10_000,
          targetUnits: 1000,
        },
      ],
      currentPlanItems: [
        {
          id: "cp1",
          planningPeriod: "2027-Clamp",
          itemId: "item1",
          itemName: "Item 1",
          brand: "B",
          productFamily: "F",
          plannedUnits: 1500,
          plannedValue: 20_000,
          eventOrProgram: "Clamp",
        },
      ],
    });
    const situation = firstSituation(ds);
    expect(situation.bridge.unresolvedValue).toBe(0);
    expect(situation.bridge.unresolvedUnits).toBe(0);
    expect(situation.bridge.representedPct).toBe(1);
  });

  it("leaves expectedUnits undefined when any Business_Plan row lacks target_units, and falls back to value/price for unresolved units", () => {
    const ds = makeDataset({
      metadata: meta("2027-01-01"),
      businessPlans: [
        {
          id: "bpA",
          planningPeriod: "2027-Test2",
          eventOrProgram: "Test2",
          businessUnit: "US",
          brand: "B",
          targetValue: 40_000,
          targetUnits: 4000,
        },
        {
          id: "bpB",
          planningPeriod: "2027-Test2",
          eventOrProgram: "Test2",
          businessUnit: "US",
          brand: "B",
          targetValue: 20_000,
          // targetUnits intentionally omitted.
        },
      ],
      currentPlanItems: [
        {
          id: "cp1",
          planningPeriod: "2027-Test2",
          itemId: "item1",
          itemName: "Item 1",
          brand: "B",
          productFamily: "F",
          plannedUnits: 1000,
          eventOrProgram: "Test2",
        },
      ],
    });
    const situation = firstSituation(ds);
    expect(situation.bridge.expectedUnits).toBeUndefined();
    // Price per unit is derived from the one business-plan row that does carry
    // both a value and units: 40,000 / 4,000 = 10.
    expect(situation.bridge.expectedValue).toBe(60_000);
    expect(situation.bridge.formalValue).toBe(10_000); // 1000 units * $10
    expect(situation.bridge.unresolvedValue).toBe(50_000);
    expect(situation.bridge.unresolvedUnits).toBe(5000); // 50,000 / 10
  });
});

/* ------------------------------------------------------------------ */
/* The central reconciliation test: only carry_forward bears load      */
/* ------------------------------------------------------------------ */

describe("only carry_forward bears load", () => {
  it("counts carry_forward-only units in validatedUnits", () => {
    const situation = firstSituation(buildCoreDataset());
    // hi_carry (3000) + hi_carry2 (1000); hi_matched (already_represented) and
    // hi_exit (intentional_exit) must NOT contribute.
    expect(situation.bridge.validatedUnits).toBe(4000);
    expect(situation.bridge.validatedValue).toBe(38_000);
  });

  it("flipping one candidate to intentional_exit reduces validatedUnits, the material requirement, and the unresolved line hours together", () => {
    const ds = buildCoreDataset();
    const baseline = firstSituation(ds);
    const cocoaBaseline = baseline.materialExposure.rows.find((r) => r.materialId === "cocoa")!;
    const lineABaseline = baseline.capacityExposure.cells.find(
      (c) => c.lineId === "LINE_A" && c.period === "2027-07"
    )!;

    expect(baseline.bridge.validatedUnits).toBe(4000);
    expect(cocoaBaseline.requirementBase).toBeCloseTo(8800, 6); // 3000*2*1.1 + 1000*2*1.1
    expect(lineABaseline.unresolvedHours).toBeCloseTo(30, 6); // 3000 units / 100 units-per-hour
    expect(lineABaseline.effectiveHours).toBeCloseTo(70, 6); // 40 formal + 30 unresolved

    // Candidate ids are stable across a change of season basis, so they are
    // derived from the SKU rather than from the historical row. Look the id up
    // the way the UI does instead of assuming the row id.
    const carryId = baseline.candidateItems.find((c) => c.itemId === "item_2026_a")!.id;
    const overridden = firstSituation(ds, {
      overridesBySituation: { [baseline.id]: { dispositions: { [carryId]: "intentional_exit" } } },
    });

    // 1. validatedUnits drops — only hi_carry2 (1000) remains carry_forward.
    expect(overridden.bridge.validatedUnits).toBe(1000);
    expect(overridden.bridge.validatedUnits).toBeLessThan(baseline.bridge.validatedUnits);

    // 2. Material requirement drops — cocoa now only reflects hi_carry2's 1000 units.
    const cocoaOverridden = overridden.materialExposure.rows.find((r) => r.materialId === "cocoa")!;
    expect(cocoaOverridden.requirementBase).toBeCloseTo(2200, 6); // 1000*2*1.1
    expect(cocoaOverridden.requirementBase).toBeLessThan(cocoaBaseline.requirementBase);

    // Components that only existed on hi_carry's BOM (wrapper, artwork, sugar)
    // disappear entirely once hi_carry stops being load-bearing.
    expect(overridden.materialExposure.rows.some((r) => r.materialId === "wrapper")).toBe(false);
    expect(overridden.materialExposure.rows.some((r) => r.materialId === "artwork_design")).toBe(false);
    expect(overridden.materialExposure.rows.some((r) => r.materialId === "sugar")).toBe(false);

    // 3. Unresolved line hours on LINE_A drop to 0 — hi_carry was the only
    // contributor of unresolved load to that line.
    const lineAOverridden = overridden.capacityExposure.cells.find(
      (c) => c.lineId === "LINE_A" && c.period === "2027-07"
    )!;
    expect(lineAOverridden.unresolvedHours).toBe(0);
    expect(lineAOverridden.effectiveHours).toBe(40); // formal only
    expect(lineAOverridden.unresolvedHours).toBeLessThan(lineABaseline.unresolvedHours);
  });
});

describe("already_represented is excluded from explainedValue", () => {
  it("does not count the matched item's value toward explainedValue", () => {
    const situation = firstSituation(buildCoreDataset());
    // explaining = hi_carry (30,000) + hi_carry2 (8,000) = 38,000; hi_matched's
    // 10,000 must be excluded (it is already_represented, not an explanation
    // for the gap) and hi_exit's 5,000 must be excluded (intentional_exit).
    expect(situation.bridge.explainedValue).toBe(38_000);
    expect(situation.bridge.explainedValue).not.toBe(48_000);
    expect(situation.bridge.unexplainedValue).toBe(2000); // 40,000 - 38,000
  });
});

/* ------------------------------------------------------------------ */
/* Capacity                                                             */
/* ------------------------------------------------------------------ */

describe("capacity", () => {
  it("uses availableHours as the denominator for formal and effective utilisation", () => {
    const situation = firstSituation(buildCoreDataset());
    const lineA = situation.capacityExposure.cells.find(
      (c) => c.lineId === "LINE_A" && c.period === "2027-07"
    )!;
    expect(lineA.availableHours).toBe(40);
    expect(lineA.formalHours).toBe(40); // 6000 units / 150 units-per-hour
    expect(lineA.unresolvedHours).toBeCloseTo(30, 6); // 3000 units / 100 units-per-hour
    expect(lineA.effectiveHours).toBe(lineA.formalHours + lineA.unresolvedHours);
    expect(lineA.formalUtilization).toBeCloseTo(40 / 40, 10);
    expect(lineA.effectiveUtilization).toBeCloseTo(70 / 40, 10);
  });

  it("flags a line whose effective utilisation exceeds its target as exposed, and picks the worst cell as peak", () => {
    const situation = firstSituation(buildCoreDataset());
    expect(situation.capacityExposure.exposedLineIds).toContain("LINE_A");
    expect(situation.capacityExposure.exposedLineIds).not.toContain("LINE_D");
    expect(situation.capacityExposure.exposedLineIds).not.toContain("LINE_D2");
    expect(situation.capacityExposure.peak?.lineId).toBe("LINE_A");
    expect(situation.capacityExposure.peak?.period).toBe("2027-07");
  });

  it("splits volume across two lines according to allocationPct", () => {
    const situation = firstSituation(buildCoreDataset());
    const lineD = situation.capacityExposure.cells.find(
      (c) => c.lineId === "LINE_D" && c.period === "2027-07"
    )!;
    const lineD2 = situation.capacityExposure.cells.find(
      (c) => c.lineId === "LINE_D2" && c.period === "2027-07"
    )!;
    // hi_carry2: 1000 units, 60% to LINE_D @ 200/hr, 40% to LINE_D2 @ 100/hr.
    expect(lineD.unresolvedHours).toBeCloseTo((1000 * 0.6) / 200, 10); // 3
    expect(lineD2.unresolvedHours).toBeCloseTo((1000 * 0.4) / 100, 10); // 4
  });

  it("splits hours across production months proportional to monthWeights", () => {
    const ds = makeDataset({
      metadata: meta("2027-01-01"),
      businessPlans: [
        {
          id: "bp1",
          planningPeriod: "2027-SplitTest",
          eventOrProgram: "SplitTest",
          businessUnit: "US",
          brand: "AnyBrand",
          targetValue: 1000,
          targetUnits: 100,
        },
      ],
      currentPlanItems: [
        {
          id: "cp1",
          planningPeriod: "2027-SplitTest",
          itemId: "item_current_split",
          itemName: "Current split item",
          brand: "XBrand",
          productFamily: "XFam",
          plannedUnits: 0,
          eventOrProgram: "SplitTest",
          productionWindow: { start: "2027-05-20", end: "2027-06-10" },
        },
      ],
      historicalItems: [
        {
          id: "hi_split",
          historicalPeriod: "2026-SplitTest",
          itemId: "item_split",
          itemName: "Split item",
          brand: "YBrand",
          productFamily: "YFam",
          actualUnits: 2200,
        },
      ],
      lineCapacity: [
        {
          id: "lc_may",
          period: "2027-05",
          plant: "P1",
          lineId: "LINE_S",
          lineName: "Line S",
          baseCalendarHours: 50,
          plannedMaintenanceHours: 0,
          projectDowntimeHours: 0,
          laborConstraintHours: 0,
          otherConstraintHours: 0,
          customAdjustmentHours: 0,
          availableHours: 50,
        },
        {
          id: "lc_june",
          period: "2027-06",
          plant: "P1",
          lineId: "LINE_S",
          lineName: "Line S",
          baseCalendarHours: 50,
          plannedMaintenanceHours: 0,
          projectDowntimeHours: 0,
          laborConstraintHours: 0,
          otherConstraintHours: 0,
          customAdjustmentHours: 0,
          availableHours: 50,
        },
      ],
      itemLineMappings: [
        {
          id: "ilm_split",
          itemOrFamilyId: "item_split",
          mappingLevel: "ITEM",
          lineId: "LINE_S",
          runRateUnitsPerHour: 100,
          allocationPct: 1,
        },
      ],
    });

    const situation = firstSituation(ds);
    // Total hours = 2200 / 100 = 22. Window 2027-05-20..2027-06-10 gives May 12
    // days, June 10 days (22 total) -> weights 12/22 and 10/22.
    const may = situation.capacityExposure.cells.find((c) => c.period === "2027-05")!;
    const june = situation.capacityExposure.cells.find((c) => c.period === "2027-06")!;
    expect(may.unresolvedHours).toBeCloseTo(22 * (12 / 22), 10); // 12
    expect(june.unresolvedHours).toBeCloseTo(22 * (10 / 22), 10); // 10
    expect(may.unresolvedHours + june.unresolvedHours).toBeCloseTo(22, 10);
  });
});

describe("mapping level precedence: ITEM > BASE_PACK > PRODUCT_FAMILY", () => {
  it("routes hours to the ITEM-level line and leaves BASE_PACK/PRODUCT_FAMILY-level lines at zero for the same item", () => {
    const situation = firstSituation(buildCoreDataset());
    const cells = situation.capacityExposure.cells;
    const lineA = cells.find((c) => c.lineId === "LINE_A" && c.period === "2027-07")!;
    const wrongBasePack = cells.find((c) => c.lineId === "LINE_WRONG_BASEPACK" && c.period === "2027-07")!;
    const wrongFamily = cells.find((c) => c.lineId === "LINE_WRONG_FAMILY" && c.period === "2027-07")!;

    // hi_carry has an ITEM-level mapping (-> LINE_A) even though BASE_PACK and
    // PRODUCT_FAMILY mappings also exist for its base pack/family — those must
    // receive none of its load.
    expect(lineA.unresolvedHours).toBeCloseTo(30, 6);
    expect(wrongBasePack.unresolvedHours).toBe(0);
    expect(wrongFamily.unresolvedHours).toBe(0);
  });

  it("falls back to BASE_PACK over PRODUCT_FAMILY when no ITEM-level mapping exists", () => {
    const situation = firstSituation(buildCoreDataset());
    const cells = situation.capacityExposure.cells;
    const lineD = cells.find((c) => c.lineId === "LINE_D" && c.period === "2027-07")!;
    const wrongFamilyD = cells.find((c) => c.lineId === "LINE_WRONG_FAMILY_D" && c.period === "2027-07")!;

    // hi_carry2 has no ITEM-level mapping; a BASE_PACK mapping exists (-> LINE_D)
    // as does a PRODUCT_FAMILY mapping (-> LINE_WRONG_FAMILY_D), which must be
    // ignored because BASE_PACK is more specific.
    expect(lineD.unresolvedHours).toBeGreaterThan(0);
    expect(wrongFamilyD.unresolvedHours).toBe(0);
  });
});

describe("capacity unavailable paths", () => {
  function scopeRows(): Pick<PlanningDataset, "businessPlans" | "currentPlanItems" | "historicalItems"> {
    return {
      businessPlans: [
        {
          id: "bp1",
          planningPeriod: "2027-Unavail",
          eventOrProgram: "Unavail",
          businessUnit: "US",
          brand: "B",
          targetValue: 1000,
          targetUnits: 100,
        },
      ],
      currentPlanItems: [
        {
          id: "cp1",
          planningPeriod: "2027-Unavail",
          itemId: "item1",
          itemName: "Item 1",
          brand: "B",
          productFamily: "F",
          plannedUnits: 10,
          eventOrProgram: "Unavail",
          productionWindow: { start: "2027-07-01", end: "2027-07-31" },
        },
      ],
      historicalItems: [
        {
          id: "hi1",
          historicalPeriod: "2026-Unavail",
          itemId: "item_h1",
          itemName: "Hist 1",
          brand: "OtherBrand",
          productFamily: "OtherFam",
          actualUnits: 50,
        },
      ],
    };
  }

  it("is unavailable with no Line_Capacity data", () => {
    const ds = makeDataset({
      metadata: meta("2027-01-01"),
      ...scopeRows(),
      itemLineMappings: [
        {
          id: "ilm1",
          itemOrFamilyId: "item_h1",
          mappingLevel: "ITEM",
          lineId: "LINE_X",
          runRateUnitsPerHour: 10,
        },
      ],
    });
    expect(() => buildSituations(ds)).not.toThrow();
    const situation = firstSituation(ds);
    expect(situation.capacityExposure.available).toBe(false);
    expect(situation.capacityExposure.unavailableReason).toBe("Capacity data not provided.");
  });

  it("is unavailable with no Item_Line_Mapping data", () => {
    const ds = makeDataset({
      metadata: meta("2027-01-01"),
      ...scopeRows(),
      lineCapacity: [
        {
          id: "lc1",
          period: "2027-07",
          plant: "P1",
          lineId: "LINE_X",
          lineName: "Line X",
          baseCalendarHours: 100,
          plannedMaintenanceHours: 0,
          projectDowntimeHours: 0,
          laborConstraintHours: 0,
          otherConstraintHours: 0,
          customAdjustmentHours: 0,
          availableHours: 100,
        },
      ],
    });
    expect(() => buildSituations(ds)).not.toThrow();
    const situation = firstSituation(ds);
    expect(situation.capacityExposure.available).toBe(false);
    expect(situation.capacityExposure.unavailableReason).toBe(
      "Add Item_Line_Mapping data to convert units into line hours."
    );
  });

  it("is unavailable with no production window", () => {
    const rows = scopeRows();
    const ds = makeDataset({
      metadata: meta("2027-01-01"),
      businessPlans: rows.businessPlans,
      // Strip the production window from the current item and keep history windowless too.
      currentPlanItems: rows.currentPlanItems.map((r) => ({ ...r, productionWindow: undefined })),
      historicalItems: rows.historicalItems,
      lineCapacity: [
        {
          id: "lc1",
          period: "2027-07",
          plant: "P1",
          lineId: "LINE_X",
          lineName: "Line X",
          baseCalendarHours: 100,
          plannedMaintenanceHours: 0,
          projectDowntimeHours: 0,
          laborConstraintHours: 0,
          otherConstraintHours: 0,
          customAdjustmentHours: 0,
          availableHours: 100,
        },
      ],
      itemLineMappings: [
        {
          id: "ilm1",
          itemOrFamilyId: "item_h1",
          mappingLevel: "ITEM",
          lineId: "LINE_X",
          runRateUnitsPerHour: 10,
        },
      ],
    });
    expect(() => buildSituations(ds)).not.toThrow();
    const situation = firstSituation(ds);
    expect(situation.capacityExposure.available).toBe(false);
    expect(situation.capacityExposure.unavailableReason).toBe(
      "No production window on these items, so hours cannot be placed in a month."
    );
  });
});

/* ------------------------------------------------------------------ */
/* Materials                                                            */
/* ------------------------------------------------------------------ */

describe("materials", () => {
  it("classifies readiness, sums scrap-adjusted requirements across carry-forward candidates, and counts add up to rows.length", () => {
    const situation = firstSituation(buildCoreDataset());
    const rows = situation.materialExposure.rows;

    const cocoa = rows.find((r) => r.materialId === "cocoa")!;
    const wrapper = rows.find((r) => r.materialId === "wrapper")!;
    const tin = rows.find((r) => r.materialId === "tin")!;
    const artwork = rows.find((r) => r.materialId === "artwork_design")!;
    const sugar = rows.find((r) => r.materialId === "sugar")!;

    // cocoa: on every carry-forward candidate's BOM -> PLAN_NOW.
    expect(cocoa.status).toBe("PLAN_NOW");
    expect(cocoa.requirementBase).toBeCloseTo(3000 * 2 * 1.1 + 1000 * 2 * 1.1, 6); // 8800
    expect(cocoa.analogueCoverage).toBeCloseTo(1, 10);

    // wrapper: settled packaging, well covered (on the 3000-of-4000-unit candidate) -> REVIEW.
    expect(wrapper.status).toBe("REVIEW");
    expect(wrapper.analogueCoverage).toBeCloseTo(0.75, 10);

    // tin: only on the 1000-of-4000-unit candidate (well under half the volume) -> WAIT.
    expect(tin.status).toBe("WAIT");
    expect(tin.analogueCoverage).toBeCloseTo(0.25, 10);

    // artwork: ARTWORK component type -> WAIT regardless of coverage.
    expect(artwork.status).toBe("WAIT");
    expect(artwork.reason).toMatch(/artwork/i);

    // sugar: RAW_MATERIAL but planning_status flags it as still moving -> WAIT.
    expect(sugar.status).toBe("WAIT");

    expect(rows.length).toBe(5);
    const counted =
      situation.materialExposure.planNowCount +
      situation.materialExposure.reviewCount +
      situation.materialExposure.waitCount;
    expect(counted).toBe(rows.length);
    expect(situation.materialExposure.planNowCount).toBe(1);
    expect(situation.materialExposure.reviewCount).toBe(1);
    expect(situation.materialExposure.waitCount).toBe(3);
  });

  it("does not report a net requirement when Inventory_Supply was not provided", () => {
    const situation = firstSituation(buildCoreDataset());
    expect(situation.materialExposure.rows.every((r) => r.netRequirement === undefined)).toBe(true);
  });
});

describe("materials unavailable", () => {
  it("is unavailable with no BOM data", () => {
    const ds = makeDataset({
      metadata: meta("2027-01-01"),
      businessPlans: [
        {
          id: "bp1",
          planningPeriod: "2027-NoBom",
          eventOrProgram: "NoBom",
          businessUnit: "US",
          brand: "B",
          targetValue: 1000,
          targetUnits: 100,
        },
      ],
      currentPlanItems: [
        {
          id: "cp1",
          planningPeriod: "2027-NoBom",
          itemId: "item1",
          itemName: "Item 1",
          brand: "B",
          productFamily: "F",
          plannedUnits: 10,
          eventOrProgram: "NoBom",
        },
      ],
      historicalItems: [
        {
          id: "hi1",
          historicalPeriod: "2026-NoBom",
          itemId: "item_h1",
          itemName: "Hist 1",
          brand: "OtherBrand",
          productFamily: "OtherFam",
          actualUnits: 50,
        },
      ],
    });
    expect(() => buildSituations(ds)).not.toThrow();
    const situation = firstSituation(ds);
    expect(situation.materialExposure.available).toBe(false);
    expect(situation.materialExposure.unavailableReason).toBe("Add BOM data to calculate material exposure.");
  });
});

describe("net requirement (Inventory_Supply)", () => {
  it("treats on-hand as a position (max across months), not a sum, and nets it plus inbound against the requirement", () => {
    const ds = makeDataset({
      metadata: meta("2027-01-01"),
      businessPlans: [
        {
          id: "bp1",
          planningPeriod: "2027-Inv",
          eventOrProgram: "Inv",
          businessUnit: "US",
          brand: "B",
          targetValue: 1000,
          targetUnits: 100,
        },
      ],
      currentPlanItems: [
        {
          id: "cp1",
          planningPeriod: "2027-Inv",
          itemId: "item_current_inv",
          itemName: "Current",
          brand: "CurrentBrand",
          productFamily: "CurrentFam",
          plannedUnits: 0,
          eventOrProgram: "Inv",
        },
      ],
      historicalItems: [
        {
          id: "hi_inv",
          historicalPeriod: "2026-Inv",
          itemId: "item_inv",
          itemName: "Historical inv item",
          brand: "HistBrand",
          productFamily: "HistFam",
          actualUnits: 1000,
        },
      ],
      boms: [
        {
          id: "bom_inv",
          parentItemId: "item_inv",
          componentId: "matInv",
          componentName: "Inventoried Material",
          componentType: "RAW_MATERIAL",
          quantityPerParent: 2,
          uom: "KG",
        },
      ],
      inventorySupply: [
        { id: "inv1", materialId: "matInv", plant: "P1", period: "2027-05", onHandQty: 500, openPoQty: 100, plannedReceiptQty: 50, uom: "KG" },
        { id: "inv2", materialId: "matInv", plant: "P1", period: "2027-06", onHandQty: 800, openPoQty: 20, plannedReceiptQty: 10, uom: "KG" },
      ],
    });

    const situation = firstSituation(ds);
    const row = situation.materialExposure.rows.find((r) => r.materialId === "matInv")!;
    // Requirement: 1000 units * 2 qty/parent * (1 + 0 scrap) = 2000.
    expect(row.requirementBase).toBe(2000);
    // On-hand is a position: max(500, 800) = 800, not the sum (1300).
    expect(row.onHandQty).toBe(800);
    // Inbound accumulates across periods: (100+50) + (20+10) = 180.
    expect(row.inboundQty).toBe(180);
    expect(row.netRequirement).toBe(2000 - 800 - 180); // 1020
  });
});

/* ------------------------------------------------------------------ */
/* Lead time                                                           */
/* ------------------------------------------------------------------ */

describe("lead time", () => {
  function buildLeadTimeDataset(): PlanningDataset {
    const leadTimeHistory: LeadTimeHistoryRow[] = [
      ...[10, 20, 30, 40, 50].map((days, i) => ({
        id: `lt_a_${i}`,
        materialId: "matA",
        materialName: "Material A",
        poId: `po_a_${i}`,
        poDate: "2026-01-01",
        receiptDate: "2026-01-01",
        quantity: 10,
        uom: "KG",
        actualLeadTimeDays: days,
      })),
      ...[12, 18].map((days, i) => ({
        id: `lt_b_${i}`,
        materialId: "matB",
        materialName: "Material B",
        poId: `po_b_${i}`,
        poDate: "2026-01-01",
        receiptDate: "2026-01-01",
        quantity: 10,
        uom: "KG",
        systemLeadTimeDays: 15,
        actualLeadTimeDays: days,
      })),
    ];

    return makeDataset({
      metadata: meta("2027-01-01"),
      businessPlans: [
        {
          id: "bp1",
          planningPeriod: "2027-LeadTime",
          eventOrProgram: "LeadTime",
          businessUnit: "US",
          brand: "B",
          targetValue: 1000,
          targetUnits: 100,
        },
      ],
      currentPlanItems: [
        {
          id: "cp1",
          planningPeriod: "2027-LeadTime",
          itemId: "item_lt_current",
          itemName: "Current LT",
          brand: "CurrentBrand",
          productFamily: "CurrentFam",
          plannedUnits: 50,
          eventOrProgram: "LeadTime",
          productionWindow: { start: "2027-07-01", end: "2027-07-01" },
        },
      ],
      historicalItems: [
        {
          id: "hi_lt",
          historicalPeriod: "2026-LeadTime",
          itemId: "item_lt",
          itemName: "Historical LT item",
          brand: "HistBrand",
          productFamily: "HistFam",
          actualUnits: 500,
          actualValue: 5000,
        },
      ],
      boms: [
        {
          id: "bom_a",
          parentItemId: "item_lt",
          componentId: "matA",
          componentName: "Material A",
          componentType: "RAW_MATERIAL",
          quantityPerParent: 1,
          uom: "KG",
        },
        {
          id: "bom_b",
          parentItemId: "item_lt",
          componentId: "matB",
          componentName: "Material B",
          componentType: "RAW_MATERIAL",
          quantityPerParent: 1,
          uom: "KG",
        },
      ],
      leadTimeHistory,
    });
  }

  it("uses the historical P80 when there are at least 5 history rows", () => {
    const situation = firstSituation(buildLeadTimeDataset());
    const matA = situation.materialExposure.rows.find((r) => r.materialId === "matA")!;
    expect(matA.leadTimeBasis).toBe("historical_p80");
    expect(matA.leadTimeDays).toBe(percentile([10, 20, 30, 40, 50], 0.8));
    expect(matA.leadTimeDays).toBe(40);
    const expectedDecisionDate = addDays("2027-07-01", -40);
    expect(matA.decisionDate).toBe(expectedDecisionDate);
    expect(matA.weeksToDecision).toBe(weeksBetween("2027-01-01", expectedDecisionDate));
  });

  it("uses the system value when there are fewer than 5 history rows and a system lead time is present", () => {
    const situation = firstSituation(buildLeadTimeDataset());
    const matB = situation.materialExposure.rows.find((r) => r.materialId === "matB")!;
    expect(matB.leadTimeBasis).toBe("system");
    expect(matB.leadTimeDays).toBe(15);
    const expectedDecisionDate = addDays("2027-07-01", -15);
    expect(matB.decisionDate).toBe(expectedDecisionDate);
  });

  it("computes decisionDate as productionStart minus leadTimeDays", () => {
    const situation = firstSituation(buildLeadTimeDataset());
    for (const row of situation.materialExposure.rows) {
      expect(row.decisionDate).toBe(addDays("2027-07-01", -row.leadTimeDays));
    }
  });
});

/* ------------------------------------------------------------------ */
/* Runway                                                               */
/* ------------------------------------------------------------------ */

describe("runway", () => {
  it("sorts markers by date, and marks exactly one earliest-irreversible marker that is never today", () => {
    const situation = firstSituation(buildCoreDataset());
    const markers = situation.runway.markers;

    for (let i = 1; i < markers.length; i += 1) {
      expect(markers[i]!.date >= markers[i - 1]!.date).toBe(true);
    }

    const irreversible = markers.filter((m) => m.isEarliestIrreversible);
    expect(irreversible.length).toBe(1);
    expect(irreversible[0]!.kind).not.toBe("today");

    expect(situation.runway.weeksOfRunway).toBe(irreversible[0]!.weeksAway);
    expect(situation.runway.earliest?.kind).toBe(irreversible[0]!.kind);
  });

  it("computes weeksOfRunway from the actual earliest marker date", () => {
    const situation = firstSituation(buildCoreDataset());
    // The formal item's production starts 2027-07-01, and materials/capacity
    // markers land on the same date in this fixture (see buildCoreDataset).
    expect(situation.runway.today).toBe("2027-06-01");
    expect(situation.runway.weeksOfRunway).toBe(weeksBetween("2027-06-01", "2027-07-01"));
  });
});

/* ------------------------------------------------------------------ */
/* State                                                                */
/* ------------------------------------------------------------------ */

describe("state", () => {
  it("is FORMING for a large gap far in the future with no capacity breach", () => {
    const ds = makeDataset({
      metadata: meta("2026-01-01"),
      businessPlans: [
        {
          id: "bp1",
          planningPeriod: "2029-Future",
          eventOrProgram: "Future",
          businessUnit: "US",
          brand: "B",
          targetValue: 50_000,
          targetUnits: 5000,
        },
      ],
      currentPlanItems: [
        {
          id: "cp1",
          planningPeriod: "2029-Future",
          itemId: "item1",
          itemName: "Item 1",
          brand: "B",
          productFamily: "F",
          plannedUnits: 1000,
          plannedValue: 5000,
          eventOrProgram: "Future",
          productionWindow: { start: "2029-07-01", end: "2029-07-31" },
          salesWindow: { start: "2029-09-01", end: "2029-10-31" },
        },
      ],
    });
    const situation = firstSituation(ds);
    expect(situation.bridge.unresolvedValue).toBeGreaterThan(0);
    expect(situation.capacityExposure.exposedLineIds.length).toBe(0);
    expect(situation.state).toBe("FORMING");
  });

  it("is ACTION_NEEDED for a near-term gap with a capacity breach", () => {
    const ds = makeDataset({
      metadata: meta("2027-06-01"),
      businessPlans: [
        {
          id: "bp1",
          planningPeriod: "2027-Soon",
          eventOrProgram: "Soon",
          businessUnit: "US",
          brand: "B",
          targetValue: 50_000,
          targetUnits: 5000,
        },
      ],
      currentPlanItems: [
        {
          id: "cp1",
          planningPeriod: "2027-Soon",
          itemId: "item1",
          itemName: "Item 1",
          brand: "CurrentBrand",
          productFamily: "CurrentFam",
          plannedUnits: 1000,
          plannedValue: 10_000,
          eventOrProgram: "Soon",
          productionWindow: { start: "2027-06-15", end: "2027-06-20" },
        },
      ],
      historicalItems: [
        {
          id: "hi_an",
          historicalPeriod: "2026-Soon",
          itemId: "item_an",
          itemName: "Hist AN",
          brand: "HistBrand",
          productFamily: "HistFam",
          actualUnits: 2000,
          actualValue: 15_000,
        },
      ],
      lineCapacity: [
        {
          id: "lc_an",
          period: "2027-06",
          plant: "P1",
          lineId: "LINE_AN",
          lineName: "Line AN",
          baseCalendarHours: 50,
          plannedMaintenanceHours: 0,
          projectDowntimeHours: 0,
          laborConstraintHours: 0,
          otherConstraintHours: 0,
          customAdjustmentHours: 0,
          targetUtilizationPct: 0.8,
          availableHours: 50,
        },
      ],
      itemLineMappings: [
        {
          id: "ilm_an",
          itemOrFamilyId: "item_an",
          mappingLevel: "ITEM",
          lineId: "LINE_AN",
          runRateUnitsPerHour: 10,
          allocationPct: 1,
        },
      ],
    });
    const situation = firstSituation(ds);
    expect(situation.runway.weeksOfRunway).toBeLessThanOrEqual(12);
    expect(situation.capacityExposure.exposedLineIds.length).toBeGreaterThan(0);
    expect(situation.state).toBe("ACTION_NEEDED");
  });

  it("is RECONCILED when the formal plan fully represents the business target", () => {
    const ds = makeDataset({
      metadata: meta("2027-01-01"),
      businessPlans: [
        {
          id: "bp1",
          planningPeriod: "2027-Full",
          eventOrProgram: "Full",
          businessUnit: "US",
          brand: "B",
          targetValue: 50_000,
          targetUnits: 5000,
        },
      ],
      currentPlanItems: [
        {
          id: "cp1",
          planningPeriod: "2027-Full",
          itemId: "item1",
          itemName: "Item 1",
          brand: "B",
          productFamily: "F",
          plannedUnits: 6000,
          plannedValue: 60_000,
          eventOrProgram: "Full",
        },
      ],
    });
    const situation = firstSituation(ds);
    expect(situation.bridge.unresolvedValue).toBe(0);
    expect(situation.state).toBe("RECONCILED");
  });
});

/* ------------------------------------------------------------------ */
/* Situation list: sorting and grouping                                */
/* ------------------------------------------------------------------ */

describe("buildSituations — list-level behaviour", () => {
  it("produces one situation per (planning period, programme) even with multiple business-plan rows for the same scope", () => {
    const ds = makeDataset({
      metadata: meta("2027-01-01"),
      businessPlans: [
        {
          id: "bpA1",
          planningPeriod: "2027-Halloween",
          eventOrProgram: "Halloween",
          businessUnit: "US",
          brand: "Ridgeline",
          targetValue: 50_000,
          targetUnits: 5000,
        },
        {
          id: "bpA2",
          planningPeriod: "2027-Halloween",
          eventOrProgram: "Halloween",
          businessUnit: "US",
          brand: "Ghirardelli",
          targetValue: 30_000,
          targetUnits: 3000,
        },
        {
          id: "bpB1",
          planningPeriod: "2027-Christmas",
          eventOrProgram: "Christmas",
          businessUnit: "US",
          brand: "Ridgeline",
          targetValue: 20_000,
          targetUnits: 2000,
        },
      ],
    });

    const situations = buildSituations(ds);
    expect(situations.length).toBe(2);

    const halloween = situations.find((s) => s.eventOrProgram === "Halloween")!;
    expect(halloween.bridge.expectedValue).toBe(80_000); // 50,000 + 30,000 combined
  });

  it("sorts situations by unresolved value descending", () => {
    const ds = makeDataset({
      metadata: meta("2027-01-01"),
      businessPlans: [
        {
          id: "bpA",
          planningPeriod: "2027-Halloween",
          eventOrProgram: "Halloween",
          businessUnit: "US",
          brand: "Ridgeline",
          targetValue: 80_000,
          targetUnits: 8000,
        },
        {
          id: "bpB",
          planningPeriod: "2027-Christmas",
          eventOrProgram: "Christmas",
          businessUnit: "US",
          brand: "Ridgeline",
          targetValue: 20_000,
          targetUnits: 2000,
        },
      ],
    });

    const situations = buildSituations(ds);
    expect(situations.length).toBe(2);
    for (let i = 1; i < situations.length; i += 1) {
      expect(situations[i - 1]!.bridge.unresolvedValue).toBeGreaterThanOrEqual(
        situations[i]!.bridge.unresolvedValue
      );
    }
    expect(situations[0]!.eventOrProgram).toBe("Halloween"); // 80,000 unresolved > 20,000
  });
});

describe("the season basis defaults to the most recent comparable season", () => {
  it("uses only the latest season until the planner opts into more", () => {
    const situation = firstSituation(buildCoreDataset());
    const itemIds = situation.candidateItems.map((c) => c.itemId);
    expect(itemIds).not.toContain("item_2025_a");
    expect(itemIds).toContain("item_2026_a");
    expect(itemIds).toContain("item_2026_b");
    expect(itemIds).toContain("item_2026_c");
    expect(itemIds).toContain("item_2026_d");
    expect(situation.candidateItems.every((c) => c.historicalPeriod === "2026-Halloween")).toBe(true);
  });

  it("still offers the older season as available, rather than discarding it", () => {
    const situation = firstSituation(buildCoreDataset());
    const periods = situation.availableSeasons.map((s) => s.period);
    expect(periods).toEqual(["2025-Halloween", "2026-Halloween"]);
    expect(situation.selectedSeasons).toEqual(["2026-Halloween"]);
  });

  it("sizes every season, including the ones not in the basis", () => {
    const situation = firstSituation(buildCoreDataset());
    // A planner choosing whether to add a season needs its size *before* it is
    // selected, so the figure must come from the history, not the selection.
    const older = situation.availableSeasons.find((s) => s.period === "2025-Halloween")!;
    expect(older.units).toBeGreaterThan(0);
    expect(older.itemCount).toBeGreaterThan(0);
  });

  it("says plainly that one season implies no growth", () => {
    expect(firstSituation(buildCoreDataset()).seasonBasisLabel).toContain("no growth applied");
  });
});

describe("selecting more seasons changes the number, not the row count", () => {
  it("surfaces a product that sold in the older season and is gone from the latest", () => {
    const ds = buildCoreDataset();
    const oneSeason = firstSituation(ds);
    const twoSeasons = firstSituation(ds, {
      overridesBySituation: {
        [oneSeason.id]: {
          dispositions: {},
          seasonBasis: ["2025-Halloween", "2026-Halloween"],
        },
      },
    });
    // "Old bag" is a different product from anything in 2026, so widening the
    // basis is exactly how a planner finds it — one extra row, not a duplicate.
    expect(twoSeasons.candidateItems.length).toBe(oneSeason.candidateItems.length + 1);
    expect(twoSeasons.candidateItems.map((c) => c.itemId)).toContain("item_2025_a");
  });

  it("collapses the same product in both seasons into one row carrying both", () => {
    const ds = buildCoreDataset();
    const twin = ds.historicalItems.find((r) => r.id === "hi_carry")!;
    // The same product, one season earlier — the case that must NOT duplicate.
    ds.historicalItems.push({
      ...twin,
      id: "hi_carry_2025",
      historicalPeriod: "2025-Halloween",
      itemId: "item_2025_twin",
      actualUnits: 2400,
      actualValue: 24_000,
    });

    const id = firstSituation(ds).id;
    const twoSeasons = firstSituation(ds, {
      overridesBySituation: {
        [id]: { dispositions: {}, seasonBasis: ["2025-Halloween", "2026-Halloween"] },
      },
    });

    const merged = twoSeasons.candidateItems.filter((c) => c.seasonHistory.length > 1);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.seasonHistory.map((h) => h.period)).toEqual([
      "2025-Halloween",
      "2026-Halloween",
    ]);
    // The row reports the latest season's actual, and plans forward from it.
    expect(merged[0]!.actualUnits).toBe(3000);
    expect(twoSeasons.seasonBasisLabel).toContain("observed growth");
  });

  it("ignores a selection naming a season the dataset does not have", () => {
    const ds = buildCoreDataset();
    const id = firstSituation(ds).id;
    const stale = firstSituation(ds, {
      overridesBySituation: { [id]: { dispositions: {}, seasonBasis: ["1999-Halloween"] } },
    });
    // A stale selection must fall back to the latest season, never leave the
    // plan with no history at all.
    expect(stale.selectedSeasons).toEqual(["2026-Halloween"]);
    expect(stale.candidateItems.length).toBeGreaterThan(0);
  });
});

describe("per-SKU attribution", () => {
  it("names which items produced a cell's unresolved hours, summing to the total", () => {
    const situation = firstSituation(buildCoreDataset());
    const cell = situation.capacityExposure.cells.find(
      (c) => c.lineId === "LINE_A" && c.period === "2027-07"
    )!;
    expect(cell.contributors.length).toBeGreaterThan(0);
    const summed = cell.contributors.reduce((s, c) => s + c.hours, 0);
    expect(summed).toBeCloseTo(cell.unresolvedHours, 6);
  });

  it("names which items require a component, summing to its requirement", () => {
    const situation = firstSituation(buildCoreDataset());
    const cocoa = situation.materialExposure.rows.find((r) => r.materialId === "cocoa")!;
    expect(cocoa.contributors.length).toBeGreaterThan(0);
    const summed = cocoa.contributors.reduce((s, c) => s + c.requirement, 0);
    expect(summed).toBeCloseTo(cocoa.requirementBase, 6);
  });

  it("marks a component several carry-forward items need as shared", () => {
    const situation = firstSituation(buildCoreDataset());
    const cocoa = situation.materialExposure.rows.find((r) => r.materialId === "cocoa")!;
    // Two carry-forward items both use cocoa, so it stands on its own evidence.
    expect(cocoa.contributors.length).toBeGreaterThan(1);
    expect(cocoa.sourcing).toBe("shared");
    expect(cocoa.blockedByItemName).toBeUndefined();
  });

  it("reports carry-forward items that no line mapping covers", () => {
    const situation = firstSituation(buildCoreDataset());
    expect(Array.isArray(situation.capacityExposure.unmappedItems)).toBe(true);
  });

  it("reports BOM coverage rather than letting a missing BOM look like completeness", () => {
    const situation = firstSituation(buildCoreDataset());
    expect(situation.materialExposure.bomCoveragePct).toBeGreaterThan(0);
    expect(situation.materialExposure.bomCoveragePct).toBeLessThanOrEqual(1);
  });
});

describe("a scenario volume override moves every downstream number together", () => {
  it("raises validated units, line hours and material requirement from one change", () => {
    const ds = buildCoreDataset();
    const baseline = firstSituation(ds);
    const carry = baseline.candidateItems.find((c) => c.itemId === "item_2026_a")!;

    const overridden = firstSituation(ds, {
      volumeOverridesBySituation: { [baseline.id]: { [carry.id]: carry.plannedUnits * 2 } },
    });

    const extra = carry.plannedUnits;
    expect(overridden.bridge.validatedUnits).toBeCloseTo(baseline.bridge.validatedUnits + extra, 6);

    const before = baseline.capacityExposure.cells.find(
      (c) => c.lineId === "LINE_A" && c.period === "2027-07"
    )!;
    const after = overridden.capacityExposure.cells.find(
      (c) => c.lineId === "LINE_A" && c.period === "2027-07"
    )!;
    expect(after.unresolvedHours).toBeGreaterThan(before.unresolvedHours);

    const cocoaBefore = baseline.materialExposure.rows.find((r) => r.materialId === "cocoa")!;
    const cocoaAfter = overridden.materialExposure.rows.find((r) => r.materialId === "cocoa")!;
    expect(cocoaAfter.requirementBase).toBeGreaterThan(cocoaBefore.requirementBase);
  });

  it("leaves the historical actual untouched — an override is a plan, not a rewrite", () => {
    const ds = buildCoreDataset();
    const baseline = firstSituation(ds);
    const carry = baseline.candidateItems.find((c) => c.itemId === "item_2026_a")!;
    const overridden = firstSituation(ds, {
      volumeOverridesBySituation: { [baseline.id]: { [carry.id]: 999_999 } },
    });
    const after = overridden.candidateItems.find((c) => c.itemId === "item_2026_a")!;

    expect(after.plannedUnits).toBe(999_999);
    expect(after.actualUnits).toBe(carry.actualUnits);
    expect(after.plannedBasis.kind).toBe("planner_override");
  });

  it("does not touch a candidate the override does not name", () => {
    const ds = buildCoreDataset();
    const baseline = firstSituation(ds);
    const carry = baseline.candidateItems.find((c) => c.itemId === "item_2026_a")!;
    const other = baseline.candidateItems.find((c) => c.itemId === "item_2026_b")!;
    const overridden = firstSituation(ds, {
      volumeOverridesBySituation: { [baseline.id]: { [carry.id]: 1 } },
    });

    const otherAfter = overridden.candidateItems.find((c) => c.itemId === "item_2026_b")!;
    expect(otherAfter.plannedUnits).toBe(other.plannedUnits);
  });
});

describe("planner decisions stay inside the programme they were made in", () => {
  const ds = generateDemoDataset({ planningNow: "2027-03-08T09:00:00.000Z" });
  const baseline = buildSituations(ds);

  // A candidate id names a product, and the same product can run in two
  // programmes — which is exactly when a decision could leak between them.
  const shared = (() => {
    const seenIn = new Map<string, string>();
    for (const s of baseline) {
      for (const c of s.candidateItems) {
        const other = seenIn.get(c.id);
        if (other !== undefined && other !== s.id) return { id: c.id, first: other, second: s.id };
        seenIn.set(c.id, s.id);
      }
    }
    return undefined;
  })();

  const unitsIn = (situations: PlanningSituation[], situationId: string, candidateId: string) =>
    situations.find((s) => s.id === situationId)!.candidateItems.find((c) => c.id === candidateId)!
      .plannedUnits;

  it("the demo carries at least one product in two programmes", () => {
    expect(shared).toBeDefined();
  });

  it("a volume committed in one programme leaves the same product in another untouched", () => {
    const { id, first, second } = shared!;
    const after = buildSituations(ds, {
      overridesBySituation: {
        [first]: {
          dispositions: {},
          commitments: {
            [id]: {
              candidateId: id,
              itemName: "Shared product",
              units: 12_345,
              basisUnits: 0,
              basisLabel: "",
              committedAt: "2027-03-08T09:00:00.000Z",
            },
          },
        },
      },
    });
    expect(unitsIn(after, first, id)).toBe(12_345);
    expect(unitsIn(after, second, id)).toBe(unitsIn(baseline, second, id));
  });

  it("a scenario volume does the same", () => {
    const { id, first, second } = shared!;
    const after = buildSituations(ds, { volumeOverridesBySituation: { [first]: { [id]: 54_321 } } });
    expect(unitsIn(after, first, id)).toBe(54_321);
    expect(unitsIn(after, second, id)).toBe(unitsIn(baseline, second, id));
  });

  it("a scenario volume wins over a committed one in the same programme", () => {
    const { id, first } = shared!;
    const after = buildSituations(ds, {
      overridesBySituation: {
        [first]: {
          dispositions: {},
          commitments: {
            [id]: {
              candidateId: id,
              itemName: "Shared product",
              units: 100,
              basisUnits: 0,
              basisLabel: "",
              committedAt: "2027-03-08T09:00:00.000Z",
            },
          },
        },
      },
      volumeOverridesBySituation: { [first]: { [id]: 200 } },
    });
    expect(unitsIn(after, first, id)).toBe(200);
  });
});

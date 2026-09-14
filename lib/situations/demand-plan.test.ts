import { describe, expect, it } from "vitest";
import { DEMO_PLANNING_NOW, generateDemoDataset } from "@/lib/dataset/demo/generate";
import { buildSituations } from "@/lib/situations/build";
import {
  bandFor,
  bandTone,
  bucketOf,
  buildDemandPlan,
  describeExplanation,
  diffDemandPlans,
  UNASSIGNED_FAMILY,
  type DemandRow,
} from "./demand-plan";

const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
const situations = buildSituations(dataset);
const halloween = situations[0]!;
const plan = buildDemandPlan(dataset, halloween);

const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

describe("buildDemandPlan", () => {
  it("reconciles to the situation's bridge", () => {
    expect(plan.total.targetValue).toBeCloseTo(halloween.bridge.expectedValue, 3);
    expect(plan.total.formalValue).toBeCloseTo(halloween.bridge.formalValue, 3);
    expect(plan.total.gapToTargetValue).toBeCloseTo(halloween.bridge.unresolvedValue, 3);
    expect(plan.total.missing.carryForwardValue).toBeCloseTo(halloween.bridge.validatedValue, 3);
  });

  it("families add up to the programme total", () => {
    expect(sum(plan.families.map((f) => f.lyValue))).toBeCloseTo(plan.total.lyValue, 3);
    expect(sum(plan.families.map((f) => f.targetValue))).toBeCloseTo(plan.total.targetValue, 3);
    expect(sum(plan.families.map((f) => f.formalValue))).toBeCloseTo(plan.total.formalValue, 3);
    expect(sum(plan.families.map((f) => f.gapToTargetValue))).toBeGreaterThanOrEqual(plan.total.gapToTargetValue - 1);
    expect(sum(plan.families.map((f) => f.missing.carryForwardValue))).toBeCloseTo(
      plan.total.missing.carryForwardValue,
      3
    );
    const families = new Set([
      ...halloween.candidateItems.map((c) => c.productFamily),
      ...dataset.businessPlans
        .filter((r) => r.planningPeriod === halloween.planningPeriod)
        .map((r) => r.productFamily ?? UNASSIGNED_FAMILY),
    ]);
    for (const f of plan.families) expect(families.has(f.productFamily)).toBe(true);
    expect(plan.families.some((f) => f.unassigned)).toBe(false);
  });

  it("puts a target with no product family in an unassigned row, never spread across families", () => {
    const targets = dataset.businessPlans.filter((r) => r.planningPeriod === halloween.planningPeriod);
    const stripped = targets[0]!;
    const noFamily = buildDemandPlan(
      {
        ...dataset,
        businessPlans: dataset.businessPlans.map((r) => (r === stripped ? { ...r, productFamily: undefined } : r)),
      },
      halloween
    );
    const unassigned = noFamily.families.find((f) => f.unassigned)!;
    expect(unassigned.productFamily).toBe(UNASSIGNED_FAMILY);
    expect(unassigned.targetValue).toBeCloseTo(stripped.targetValue, 3);
    expect(noFamily.families[noFamily.families.length - 1]).toBe(unassigned);
    expect(noFamily.total.targetValue).toBeCloseTo(plan.total.targetValue, 3);
    const familyBefore = plan.families.find((f) => f.productFamily === stripped.productFamily)!;
    const familyAfter = noFamily.families.find((f) => f.productFamily === stripped.productFamily)!;
    expect(familyBefore.targetValue - familyAfter.targetValue).toBeCloseTo(stripped.targetValue, 3);
  });

  it("last year is the most recent comparable season", () => {
    const latest = halloween.availableSeasons[halloween.availableSeasons.length - 1]!;
    expect(plan.lySeason).toBe(latest.period);
    expect(plan.total.lyValue).toBeCloseTo(latest.value, 0);
    expect(plan.total.targetGrowthPct).toBeCloseTo(plan.total.targetValue / plan.total.lyValue - 1, 9);
  });

  it("lists only items missing from this year's plan, and never counts exits as explaining the gap", () => {
    const skus = plan.families.flatMap((f) => f.skus);
    const represented = halloween.candidateItems.filter((c) => c.disposition === "already_represented");
    expect(skus).toHaveLength(halloween.candidateItems.length - represented.length);

    const exitPlan = buildDemandPlan(dataset, {
      ...halloween,
      candidateItems: halloween.candidateItems.map((c) =>
        c.disposition === "carry_forward" ? { ...c, disposition: "intentional_exit" as const } : c
      ),
    });
    expect(exitPlan.total.missing.carryForwardValue).toBe(0);
    expect(exitPlan.total.missing.exitValue).toBeCloseTo(plan.total.missing.carryForwardValue, 3);
    expect(exitPlan.total.unexplainedValue).toBeGreaterThan(plan.total.unexplainedValue);
  });

  it("a scenario volume moves the SKU's revenue at its own price, and the family and total with it", () => {
    const sku = plan.families.flatMap((f) => f.skus).find((s) => s.bucket === "carry_forward")!;
    const units = Math.round(sku.plannedUnits * 1.5);
    const scenarioSituation = buildSituations(dataset, {
      volumeOverridesBySituation: { [halloween.id]: { [sku.candidateId]: units } },
    }).find((s) => s.id === halloween.id)!;
    const scenario = buildDemandPlan(dataset, scenarioSituation);

    const after = scenario.families.flatMap((f) => f.skus).find((s) => s.candidateId === sku.candidateId)!;
    expect(after.plannedUnits).toBe(units);
    expect(after.plannedValue / after.plannedUnits).toBeCloseTo(sku.plannedValue / sku.plannedUnits, 6);

    const delta = after.plannedValue - sku.plannedValue;
    const familyBefore = plan.families.find((f) => f.productFamily === sku.productFamily)!;
    const familyAfter = scenario.families.find((f) => f.productFamily === sku.productFamily)!;
    expect(familyAfter.missing.carryForwardValue - familyBefore.missing.carryForwardValue).toBeCloseTo(delta, 3);
    expect(scenario.total.formalValue).toBeCloseTo(plan.total.formalValue, 3);

    const changes = diffDemandPlans(plan, scenario);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.valueDelta).toBeCloseTo(delta, 3);
  });

  it("orders families and SKUs the same whatever the scenario does to units", () => {
    const order = (p: typeof plan) => p.families.map((f) => [f.productFamily, f.skus.map((s) => s.candidateId)]);
    const editable = plan.families.flatMap((f) => f.skus).filter((s) => s.bucket !== "exit");
    expect(editable.length).toBeGreaterThan(2);
    // Invert the value order: the smallest SKUs get huge volumes, the largest go to zero.
    const overrides = Object.fromEntries(
      editable.map((s, i) => [s.candidateId, i % 2 === 0 ? 0 : Math.round(s.plannedUnits * 40 + 1_000_000)])
    );
    const scenarioSituation = buildSituations(dataset, {
      volumeOverridesBySituation: { [halloween.id]: overrides },
    }).find((s) => s.id === halloween.id)!;
    const scenario = buildDemandPlan(dataset, scenarioSituation);
    expect(diffDemandPlans(plan, scenario).length).toBeGreaterThan(0);
    expect(order(scenario)).toEqual(order(plan));
  });

  it("carries the new-this-season flag through to each SKU", () => {
    const byId = new Map(halloween.candidateItems.map((c) => [c.id, c]));
    for (const sku of plan.families.flatMap((f) => f.skus)) {
      expect(sku.isNewThisSeason).toBe(byId.get(sku.candidateId)!.isNewThisSeason);
    }
  });
});

describe("explained band follows carry-forward", () => {
  it("counts only carry-forward as explaining; to-decide is shown separately", () => {
    const t = plan.total;
    expect(t.explainedByCarryPct).toBeCloseTo(t.missing.carryForwardValue / t.gapToTargetValue, 9);
    expect(t.explainsTargetPct).toBeCloseTo(
      (t.missing.carryForwardValue + t.missing.toDecideValue) / t.gapToTargetValue,
      9
    );
    expect(t.explainedBand).toBe(bandFor(t.explainedByCarryPct));
  });

  it("cutting a family's carry-forward SKUs to 86 units lowers the explained % and changes the band", () => {
    const family = plan.families.find(
      (f) => f.explainedBand !== "short" && f.explainedBand !== "no_gap" && f.missing.carryForwardValue > 0
    )!;
    expect(family).toBeDefined();
    const cut = Object.fromEntries(
      family.skus.filter((s) => s.bucket === "carry_forward").map((s) => [s.candidateId, 86])
    );
    const scenarioSituation = buildSituations(dataset, {
      volumeOverridesBySituation: { [halloween.id]: cut },
    }).find((s) => s.id === halloween.id)!;
    const after = buildDemandPlan(dataset, scenarioSituation).families.find(
      (f) => f.productFamily === family.productFamily
    )!;

    expect(after.explainedByCarryPct!).toBeLessThan(family.explainedByCarryPct!);
    expect(after.explainedBand).toBe("short");
    expect(after.explainedBand).not.toBe(family.explainedBand);
    expect(after.remainingGapValue).toBeGreaterThan(family.remainingGapValue);
  });

  it("cutting one carry-forward SKU lowers the explained %", () => {
    const sku = plan.families
      .flatMap((f) => f.skus)
      .filter((s) => s.bucket === "carry_forward")
      .sort((a, b) => b.plannedValue - a.plannedValue)[0]!;
    const scenarioSituation = buildSituations(dataset, {
      volumeOverridesBySituation: { [halloween.id]: { [sku.candidateId]: 86 } },
    }).find((s) => s.id === halloween.id)!;
    const before = plan.families.find((f) => f.productFamily === sku.productFamily)!;
    const after = buildDemandPlan(dataset, scenarioSituation).families.find(
      (f) => f.productFamily === sku.productFamily
    )!;
    expect(after.explainedByCarryPct!).toBeLessThan(before.explainedByCarryPct!);
  });
});

describe("plain language", () => {
  const row = (partial: Partial<DemandRow>): DemandRow => ({ ...plan.total, ...partial });

  it("bands the carry-forward share: ≥100% covers, 60–99% partial, <60% short", () => {
    expect(bandFor(undefined)).toBe("no_gap");
    expect(bandFor(1.2)).toBe("covers");
    expect(bandFor(1)).toBe("covers");
    expect(bandFor(0.99)).toBe("partial");
    expect(bandFor(0.6)).toBe("partial");
    expect(bandFor(0.59)).toBe("short");
    expect(bandTone("covers")).toBe("positive");
    expect(bandTone("partial")).toBe("warning");
    expect(bandTone("short")).toBe("critical");
    expect(bandTone("no_gap")).toBe("neutral");
  });

  it("says it in one line", () => {
    expect(
      describeExplanation(
        row({
          explainedBand: "short",
          explainedByCarryPct: 0.12,
          explainsTargetPct: 0.87,
          missing: { ...plan.total.missing, toDecideValue: 5_000_000 },
          remainingGapValue: 3_700_000,
        }),
        "USD"
      )
    ).toBe("Carry-forward explains 12% of the gap · 87% with to-decide · $3.7M still open");
    expect(describeExplanation(row({ explainedBand: "no_gap" }), "USD")).toBe("Plan meets the target");
  });

  it("buckets dispositions", () => {
    expect(bucketOf("already_represented")).toBeUndefined();
    expect(bucketOf("carry_forward")).toBe("carry_forward");
    expect(bucketOf("intentional_exit")).toBe("exit");
    expect(bucketOf("under_review")).toBe("to_decide");
    expect(bucketOf("unreviewed")).toBe("to_decide");
  });
});

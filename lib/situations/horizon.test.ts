import { describe, it, expect } from "vitest";
import { generateDemoDataset } from "@/lib/dataset/demo/generate";
import { buildSituations } from "./build";
import { buildPlanningHorizon, expectedItems, missingItems, stackTotal } from "./horizon";
import type { ContributorDisposition, PlanningSituation } from "@/types/situation";

const DATASET = generateDemoDataset({ planningNow: "2027-03-08T09:00:00.000Z" });

interface FakeCandidate {
  disposition: ContributorDisposition;
  matched?: boolean;
  plannedUnits?: number;
  plannedValue?: number;
}

/** Only the fields `buildPlanningHorizon` reads. */
function fakeSituation(input: {
  id: string;
  currency?: string;
  productionWindow?: { start: string; end: string };
  candidates?: FakeCandidate[];
}): PlanningSituation {
  return {
    id: input.id,
    title: input.id,
    bridge: {
      expectedValue: 200,
      formalValue: 100,
      unresolvedValue: 100,
      explainedValue: 80,
      unexplainedValue: 20,
      expectedUnits: 20,
      formalUnits: 10,
      unresolvedUnits: 10,
      formalItemCount: 3,
      validatedValue: 60,
      validatedUnits: 6,
      currency: input.currency ?? "USD",
    },
    candidateItems: (input.candidates ?? []).map((c, i) => ({
      id: `${input.id}-${i}`,
      disposition: c.disposition,
      plannedUnits: c.plannedUnits ?? 0,
      plannedValue: c.plannedValue ?? 0,
      match: { matchedItemId: c.matched ? "plan-item" : undefined },
    })),
    productionWindow: input.productionWindow,
  } as unknown as PlanningSituation;
}

describe("buildPlanningHorizon — one programme across two months", () => {
  // June has 30 production days, July 31.
  const halloween = fakeSituation({
    id: "halloween",
    productionWindow: { start: "2027-06-01", end: "2027-07-31" },
    candidates: [
      { disposition: "carry_forward", plannedUnits: 6, plannedValue: 60 },
      { disposition: "under_review", plannedUnits: 2, plannedValue: 20 },
      { disposition: "intentional_exit", plannedUnits: 1, plannedValue: 5 },
      { disposition: "already_represented", matched: true, plannedUnits: 9, plannedValue: 90 },
      // Matched, but the planner doubts the match: classed by disposition, as
      // the bridge, Reconcile and Decisions class it — still to decide.
      { disposition: "under_review", matched: true, plannedUnits: 4, plannedValue: 40 },
    ],
  });
  const horizon = buildPlanningHorizon([halloween]);

  it("lists only the production months, in order", () => {
    expect(horizon.months.map((m) => m.period)).toEqual(["2027-06", "2027-07"]);
    expect(horizon.unphased).toEqual([]);
  });

  it("counts items in every month the programme produces in, without weighting", () => {
    for (const month of horizon.months) {
      expect(month.items).toEqual({ planned: 3, carryingForward: 1, toDecide: 2, unexplained: 0, exited: 1 });
      expect(missingItems(month)).toBe(3);
      expect(expectedItems(month)).toBe(7);
    }
    expect(horizon.total.items).toEqual(horizon.months[0]!.items);
  });

  it("weights value and units by production days, reaching expected with the unexplained remainder", () => {
    const june = horizon.months[0]!;
    const w = 30 / 61;
    expect(june.value.planned).toBeCloseTo(100 * w, 6);
    expect(june.value.carryingForward).toBeCloseTo(60 * w, 6);
    expect(june.value.toDecide).toBeCloseTo((20 + 40) * w, 6);
    expect(june.value.unexplained).toBeCloseTo(20 * w, 6);
    expect(june.value.exited).toBeCloseTo(5 * w, 6);
    expect(june.missingValue).toBeCloseTo(100 * w, 6);
    // Units follow the unexplained share of value: 20% of 10 unresolved units.
    expect(june.units.unexplained).toBeCloseTo(2 * w, 6);
    expect(june.missingUnits).toBeCloseTo(10 * w, 6);

    const sum = horizon.months.reduce((n, m) => n + stackTotal(m.value), 0);
    expect(sum).toBeCloseTo(stackTotal(horizon.total.value), 6);
  });
});

describe("buildPlanningHorizon — honesty about what cannot be phased or summed", () => {
  it("keeps a programme with no production window in the total but out of every month", () => {
    const phased = fakeSituation({ id: "a", productionWindow: { start: "2027-06-01", end: "2027-06-30" } });
    const unphased = fakeSituation({ id: "b" });
    const horizon = buildPlanningHorizon([phased, unphased]);
    expect(horizon.months.map((m) => m.situationIds)).toEqual([["a"]]);
    expect(horizon.unphased).toEqual([{ situationId: "b", title: "b" }]);
    expect(horizon.total.value.planned).toBe(200);
  });

  it("does not add money across currencies", () => {
    const horizon = buildPlanningHorizon([
      fakeSituation({ id: "a", productionWindow: { start: "2027-06-01", end: "2027-06-30" } }),
      fakeSituation({ id: "b", currency: "EUR", productionWindow: { start: "2027-06-01", end: "2027-06-30" } }),
    ]);
    expect(horizon.valuesComparable).toBe(false);
    expect(stackTotal(horizon.total.value)).toBe(0);
    expect(horizon.months[0]!.units.planned).toBe(20);
  });
});

describe("buildPlanningHorizon — demo portfolio", () => {
  const situations = buildSituations(DATASET);
  const horizon = buildPlanningHorizon(situations);

  it("phases the whole bridge: months add back up to the programme totals", () => {
    const sum = (pick: (m: (typeof horizon.months)[number]) => number) =>
      horizon.months.reduce((n, m) => n + pick(m), 0);
    expect(sum((m) => m.value.planned)).toBeCloseTo(situations.reduce((n, s) => n + s.bridge.formalValue, 0), 0);
    expect(sum((m) => m.value.carryingForward)).toBeCloseTo(
      situations.reduce((n, s) => n + s.bridge.validatedValue, 0),
      0
    );
    expect(sum((m) => m.units.carryingForward)).toBeCloseTo(
      situations.reduce((n, s) => n + s.bridge.validatedUnits, 0),
      0
    );
  });

  it("counts a month's items from exactly the programmes producing in it", () => {
    for (const month of horizon.months) {
      const active = situations.filter((s) => month.situationIds.includes(s.id));
      expect(month.items.planned).toBe(active.reduce((n, s) => n + s.bridge.formalItemCount, 0));
    }
  });
});

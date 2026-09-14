import { describe, it, expect } from "vitest";
import { generateDemoDataset } from "@/lib/dataset/demo/generate";
import { buildSituations } from "./build";
import { buildReadinessCurve, computeReadinessLateness, interpolateReadiness } from "./readiness-curve";

const DATASET = generateDemoDataset({ planningNow: "2027-03-08T09:00:00.000Z" });

function situations() {
  return buildSituations(DATASET);
}

describe("buildReadinessCurve", () => {
  it("reads today's percentage as the share of expected value in the formal plan", () => {
    for (const s of situations()) {
      const curve = buildReadinessCurve(s, DATASET);
      expect(curve.todayPct).toBe(s.bridge.expectedValue > 0 ? s.bridge.representedPct : undefined);
    }
  });

  it("has readiness history available for the demo dataset, sorted earliest-first", () => {
    const s = situations()[0]!;
    const curve = buildReadinessCurve(s, DATASET);
    expect(curve.historyAvailable).toBe(true);
    expect(curve.currentSeasonHistory.length + curve.priorSeasonPace.length).toBeGreaterThan(0);

    for (const series of [curve.currentSeasonHistory, curve.currentSeasonPace, curve.priorSeasonPace]) {
      const weeks = series.map((p) => p.weeksBeforeProductionStart);
      expect(weeks).toEqual([...weeks].sort((a, b) => b - a));
      for (const point of series) {
        expect(point.representedPct).toBeGreaterThanOrEqual(0);
        expect(point.representedPct).toBeLessThanOrEqual(1);
      }
    }
  });

  it("ends this year's line on today's live figure, with no checkpoint dated after today", () => {
    for (const s of situations()) {
      const curve = buildReadinessCurve(s, DATASET);
      if (curve.currentSeasonPace.length === 0) continue;
      const last = curve.currentSeasonPace[curve.currentSeasonPace.length - 1]!;
      expect(last.weeksBeforeProductionStart).toBe(curve.todayWeeksBeforeProduction);
      expect(last.representedPct).toBe(curve.todayPct);
      for (const p of curve.currentSeasonPace.slice(0, -1)) {
        expect(p.weeksBeforeProductionStart).toBeGreaterThan(curve.todayWeeksBeforeProduction!);
      }
    }
  });

  it("never invents a pace or a lateness gap without history", () => {
    const s = situations()[0]!;
    // A dataset that reports the capability off, as an upload without the sheet would.
    const withoutHistory = {
      ...DATASET,
      readinessHistory: [],
      metadata: { ...DATASET.metadata, capabilities: { ...DATASET.metadata.capabilities, readinessHistory: false } },
    };
    const curve = buildReadinessCurve(s, withoutHistory);
    expect(curve.historyAvailable).toBe(false);
    expect(curve.currentSeasonHistory).toEqual([]);
    expect(curve.currentSeasonPace).toEqual([]);
    expect(curve.priorSeasonPace).toEqual([]);
    expect(curve.lastYearAtToday).toBeUndefined();
    expect(curve.lateness).toBeUndefined();
    expect(curve.historyUnavailableReason).toBeTruthy();
  });

  it("reuses the situation's own runway, and splits the axis into weeks left and lead time", () => {
    for (const s of situations()) {
      const curve = buildReadinessCurve(s, DATASET);
      expect(curve.dropDeadDate).toBe(s.runway.earliest?.date);
      expect(curve.runwayWeeks).toBe(s.runway.weeksOfRunway);
      if (curve.weeksLeft !== undefined && curve.leadTimeWeeks !== undefined) {
        expect(curve.weeksLeft + curve.leadTimeWeeks).toBe(curve.todayWeeksBeforeProduction);
      }
    }
  });

  it("computes the lateness gap from the same curve it draws", () => {
    for (const s of situations()) {
      const curve = buildReadinessCurve(s, DATASET);
      const lateness = curve.lateness;
      if (!lateness) continue;
      if (lateness.gapPts !== undefined) {
        expect(lateness.gapPts).toBeCloseTo(curve.todayPct! - curve.lastYearAtToday!, 9);
      }
      if (lateness.neededPts !== undefined) {
        expect(lateness.neededPts).toBeCloseTo(curve.lastYearAtDeadline! - curve.todayPct!, 9);
        expect(lateness.neededValue).toBeCloseTo(Math.max(0, lateness.neededPts) * s.bridge.expectedValue, 3);
      }
    }
  });

  it("names a constraining material only when the situation has unrepresented candidates and a BOM/analogue picture", () => {
    for (const s of situations()) {
      const curve = buildReadinessCurve(s, DATASET);
      const hasUnrepresented = s.candidateItems.some((c) => c.match.matchedItemId === undefined);
      if (!hasUnrepresented) {
        expect(curve.constrainingMaterial).toBeUndefined();
      }
      if (curve.constrainingMaterial) {
        expect(curve.constrainingMaterial.itemCount).toBeGreaterThan(0);
        expect(curve.constrainingMaterial.leadTimeDays).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("interpolateReadiness", () => {
  const points = [
    { weeksBeforeProductionStart: 40, representedPct: 0.4 },
    { weeksBeforeProductionStart: 20, representedPct: 0.8 },
    { weeksBeforeProductionStart: 0, representedPct: 1 },
  ];

  it("reads between checkpoints", () => {
    expect(interpolateReadiness(points, 30)).toBeCloseTo(0.6, 9);
    expect(interpolateReadiness(points, 20)).toBeCloseTo(0.8, 9);
    expect(interpolateReadiness(points, 10)).toBeCloseTo(0.9, 9);
  });

  it("does not extrapolate beyond the history that exists", () => {
    expect(interpolateReadiness(points, 52)).toBeUndefined();
    expect(interpolateReadiness([], 10)).toBeUndefined();
  });
});

describe("computeReadinessLateness", () => {
  it("reads '12 pts behind · needs +29 pts in 10 wks — last year gained 17'", () => {
    const lateness = computeReadinessLateness({
      todayPct: 0.6,
      lastYearAtToday: 0.72,
      lastYearAtDeadline: 0.89,
      weeksLeft: 10,
      expectedValue: 200_000_000,
      currency: "USD",
    })!;
    expect(lateness.gapPts).toBeCloseTo(-0.12, 9);
    expect(lateness.neededPts).toBeCloseTo(0.29, 9);
    expect(lateness.neededValue).toBeCloseTo(58_000_000, 0);
    expect(lateness.lastYearGainedPts).toBeCloseTo(0.17, 9);
    expect(lateness.weeksLeft).toBe(10);
  });

  it("needs nothing when already ahead of last year's deadline level", () => {
    const lateness = computeReadinessLateness({
      todayPct: 0.95,
      lastYearAtToday: 0.8,
      lastYearAtDeadline: 0.9,
      weeksLeft: 4,
      expectedValue: 100,
      currency: "USD",
    })!;
    expect(lateness.gapPts).toBeCloseTo(0.15, 9);
    expect(lateness.neededValue).toBe(0);
  });

  it("drops the parts it cannot compute rather than guessing them", () => {
    // Today sits before the first checkpoint: no same-week comparison.
    const early = computeReadinessLateness({
      todayPct: 0.5,
      lastYearAtDeadline: 0.8,
      weeksLeft: 30,
      expectedValue: 100,
      currency: "USD",
    })!;
    expect(early.gapPts).toBeUndefined();
    expect(early.lastYearGainedPts).toBeUndefined();
    expect(early.neededPts).toBeCloseTo(0.3, 9);

    // The deadline has passed: nothing is still "needed by" it.
    const late = computeReadinessLateness({
      todayPct: 0.5,
      lastYearAtToday: 0.6,
      lastYearAtDeadline: 0.55,
      weeksLeft: undefined,
      expectedValue: 100,
      currency: "USD",
    })!;
    expect(late.neededPts).toBeUndefined();
    expect(late.gapPts).toBeCloseTo(-0.1, 9);

    expect(computeReadinessLateness({ expectedValue: 100, currency: "USD" })).toBeUndefined();
  });
});

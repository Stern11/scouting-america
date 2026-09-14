import { describe, expect, it } from "vitest";
import { generateDemoDataset } from "@/lib/dataset/demo/generate";
import { buildSituations } from "./build";
import { ALL_LINES, buildLineLoadSeries, listLoadLines } from "./portfolio";

const NOW = "2026-09-15T09:00:00.000Z";
const situations = buildSituations(generateDemoDataset({ planningNow: NOW }));

describe("buildLineLoadSeries — whole-horizon totals", () => {
  const lineIds = [ALL_LINES, ...listLoadLines(situations).map((l) => l.lineId)];

  it("sums every month, so headline figures do not depend on which month is hovered", () => {
    for (const lineId of lineIds) {
      const series = buildLineLoadSeries(situations, lineId);
      const sum = (pick: (m: (typeof series.months)[number]) => number) =>
        series.months.reduce((n, m) => n + pick(m), 0);
      expect(series.totals.committedHours).toBeCloseTo(sum((m) => m.committedHours), 6);
      expect(series.totals.addedHours).toBeCloseTo(sum((m) => m.addedHours), 6);
      expect(series.totals.capacityHours).toBeCloseTo(sum((m) => m.capacityHours), 6);
      if (series.totals.capacityHours > 0) {
        expect(series.totals.effectiveUtilization).toBeCloseTo(
          (series.totals.committedHours + series.totals.addedHours) / series.totals.capacityHours,
          9
        );
      }
    }
  });

  it("credits each programme with all of its hours across the horizon, and they add to the added hours", () => {
    for (const lineId of lineIds) {
      const series = buildLineLoadSeries(situations, lineId);
      const programmeHours = series.totals.byProgramme.reduce((n, p) => n + p.hours, 0);
      expect(programmeHours).toBeCloseTo(series.totals.addedHours, 6);
      const hours = series.totals.byProgramme.map((p) => p.hours);
      expect(hours).toEqual([...hours].sort((a, b) => b - a));
    }
  });

  it("makes the plant total the sum of the lines", () => {
    const all = buildLineLoadSeries(situations, ALL_LINES).totals;
    const lines = listLoadLines(situations).map((l) => buildLineLoadSeries(situations, l.lineId).totals);
    expect(all.committedHours).toBeCloseTo(lines.reduce((n, t) => n + t.committedHours, 0), 6);
    expect(all.addedHours).toBeCloseTo(lines.reduce((n, t) => n + t.addedHours, 0), 6);
    expect(all.capacityHours).toBeCloseTo(lines.reduce((n, t) => n + t.capacityHours, 0), 6);
  });
});

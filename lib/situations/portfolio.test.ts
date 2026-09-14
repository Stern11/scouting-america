import { describe, it, expect } from "vitest";
import { generateDemoDataset } from "@/lib/dataset/demo/generate";
import { buildSituations } from "./build";
import { ALL_LINES, buildLineLoadSeries, listLoadLines, summarizePortfolio, worstLoadLine } from "./portfolio";
import type { MaterialPlanningStatus, PlanningSituation } from "@/types/situation";

const DATASET = generateDemoDataset({ planningNow: "2027-03-08T09:00:00.000Z" });

function situations() {
  return buildSituations(DATASET);
}

describe("summarizePortfolio — empty portfolio", () => {
  it("returns a zeroed before/after rather than throwing", () => {
    const summary = summarizePortfolio([]);
    expect(summary.beforeAfter).toEqual({
      demandValueBefore: 0,
      demandValueAfter: 0,
      addedValue: 0,
      carriedForwardSkuCount: 0,
      hoursBefore: 0,
      hoursAfter: 0,
      addedHours: 0,
      components: [],
      currency: "USD",
      valuesComparable: true,
    });
  });
});

describe("summarizePortfolio — formal hours", () => {
  it("counts each line-month's formal hours once, however many programmes share it", () => {
    const summary = summarizePortfolio(situations());

    // Formal load is one property of the plan, so every situation reports the
    // same figure for a shared line-month. Deduplicate before summing.
    const formalByCell = new Map<string, number>();
    let unresolved = 0;
    for (const s of situations()) {
      for (const cell of s.capacityExposure.cells) {
        const key = `${cell.lineId}::${cell.period}`;
        const seen = formalByCell.get(key);
        if (seen !== undefined) expect(cell.formalHours).toBeCloseTo(seen, 6);
        formalByCell.set(key, cell.formalHours);
        unresolved += cell.unresolvedHours;
      }
    }
    const allFormal = [...formalByCell.values()].reduce((a, b) => a + b, 0);
    expect(summary.formalHours).toBeCloseTo(allFormal, 6);
    expect(summary.unresolvedHours).toBeCloseTo(unresolved, 6);
  });
});

describe("summarizePortfolio — beforeAfter", () => {
  it("after never counts less than before — including absent SKUs only ever adds", () => {
    const summary = summarizePortfolio(situations());
    expect(summary.beforeAfter.demandValueAfter).toBeGreaterThanOrEqual(summary.beforeAfter.demandValueBefore);
    expect(summary.beforeAfter.hoursAfter).toBeGreaterThanOrEqual(summary.beforeAfter.hoursBefore);
  });

  it("reconciles to the same formal/validated/hours figures shown elsewhere on Overview", () => {
    const summary = summarizePortfolio(situations());
    expect(summary.beforeAfter.demandValueBefore).toBeCloseTo(summary.formalValue, 6);
    expect(summary.beforeAfter.demandValueAfter).toBeCloseTo(summary.formalValue + summary.validatedValue, 6);
    expect(summary.beforeAfter.addedValue).toBeCloseTo(summary.validatedValue, 6);
    expect(summary.beforeAfter.hoursBefore).toBeCloseTo(summary.formalHours, 6);
    expect(summary.beforeAfter.hoursAfter).toBeCloseTo(summary.formalHours + summary.unresolvedHours, 6);
    expect(summary.beforeAfter.carriedForwardSkuCount).toBe(summary.carryingForwardSkuCount);
    expect(summary.beforeAfter.currency).toBe(summary.currency);
  });

  it("lists every carried-forward component, most urgent first, and never calls a WAIT orderable", () => {
    const all = situations();
    const summary = summarizePortfolio(all);
    const rowCount = all.reduce((n, s) => n + s.materialExposure.rows.length, 0);
    expect(summary.beforeAfter.components).toHaveLength(rowCount);
    const weeks = summary.beforeAfter.components.map((c) => c.weeksToDecision);
    expect(weeks).toEqual([...weeks].sort((a, b) => a - b));

    for (const s of all) {
      for (const row of s.materialExposure.rows) {
        const listed = summary.beforeAfter.components.find(
          (c) => c.materialId === row.materialId && c.situationId === s.id
        );
        expect(listed).toBeDefined();
        if (row.status === "WAIT") expect(listed!.action).toBe("cannot_order_yet");
        if (row.status === "PLAN_NOW") expect(listed!.action).toBe("order_now");
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* Hand-built portfolios: exact figures for the aggregation rules       */
/* ------------------------------------------------------------------ */

interface FakeCell {
  lineId: string;
  period: string;
  formalHours: number;
  unresolvedHours: number;
  availableHours?: number;
}

interface FakeMaterial {
  materialId: string;
  status: MaterialPlanningStatus;
  requirementBase: number;
  weeksToDecision: number;
}

/** Only the fields `summarizePortfolio` reads. */
function fakeSituation(input: {
  id: string;
  currency?: string;
  formalValue?: number;
  expectedValue?: number;
  validatedValue?: number;
  formalUnits?: number;
  expectedUnits?: number;
  cells?: FakeCell[];
  productionWindow?: { start: string; end: string };
  materials?: FakeMaterial[];
}): PlanningSituation {
  const cells = (input.cells ?? []).map((c) => {
    const availableHours = c.availableHours ?? 1000;
    const effectiveHours = c.formalHours + c.unresolvedHours;
    return {
      lineId: c.lineId,
      lineName: c.lineId,
      period: c.period,
      availableHours,
      targetUtilizationPct: 0.9,
      formalHours: c.formalHours,
      unresolvedHours: c.unresolvedHours,
      effectiveHours,
      formalUtilization: c.formalHours / availableHours,
      effectiveUtilization: effectiveHours / availableHours,
      contributors: [{ candidateId: `${input.id}-item`, itemId: "x", itemName: `${input.id} item`, hours: c.unresolvedHours }],
    };
  });
  const rows = (input.materials ?? []).map((m) => ({
    materialId: m.materialId,
    materialName: m.materialId,
    componentType: "RAW_MATERIAL",
    uom: "kg",
    requirementLow: m.requirementBase,
    requirementBase: m.requirementBase,
    requirementHigh: m.requirementBase,
    status: m.status,
    reason: "",
    decisionDate: "2027-01-01",
    weeksToDecision: m.weeksToDecision,
  }));
  return {
    id: input.id,
    title: input.id,
    state: "MONITOR",
    bridge: {
      expectedValue: input.expectedValue ?? 0,
      formalValue: input.formalValue ?? 0,
      unresolvedValue: Math.max(0, (input.expectedValue ?? 0) - (input.formalValue ?? 0)),
      validatedValue: input.validatedValue ?? 0,
      validatedUnits: 0,
      formalUnits: input.formalUnits ?? 0,
      expectedUnits: input.expectedUnits,
      currency: input.currency ?? "USD",
    },
    candidateItems: [],
    capacityExposure: { available: true, cells },
    materialExposure: {
      available: true,
      rows,
      planNowCount: rows.filter((r) => r.status === "PLAN_NOW").length,
      waitCount: rows.filter((r) => r.status === "WAIT").length,
    },
    runway: {
      earliest: rows[0] ? { date: `2027-01-${String(10 + rows[0].weeksToDecision).padStart(2, "0")}`, weeksAway: rows[0].weeksToDecision, label: "Material commitment" } : undefined,
    },
    productionWindow: input.productionWindow,
  } as unknown as PlanningSituation;
}

describe("summarizePortfolio — a line-month shared by two programmes", () => {
  // Line 1 is 80% formally loaded. Halloween adds 5 points and Holiday 7:
  // neither crosses a 90% target alone, together they reach 92%.
  const halloween = fakeSituation({
    id: "halloween",
    cells: [{ lineId: "LINE-1", period: "2027-07", formalHours: 800, unresolvedHours: 50 }],
  });
  const holiday = fakeSituation({
    id: "holiday",
    cells: [{ lineId: "LINE-1", period: "2027-07", formalHours: 800, unresolvedHours: 70 }],
  });
  const summary = summarizePortfolio([halloween, holiday]);

  it("counts the formal load once, not once per programme", () => {
    expect(summary.formalHours).toBe(800);
    expect(summary.unresolvedHours).toBe(120);
    expect(summary.beforeAfter.hoursAfter).toBe(920);
  });

  it("recomputes utilisation from the combined load and flags the line", () => {
    expect(summary.exposedLines).toHaveLength(1);
    const line = summary.exposedLines[0]!;
    expect(line.effectiveUtilization).toBeCloseTo(0.92, 6);
    expect(line.formalUtilization).toBeCloseTo(0.8, 6);
    expect(line.unresolvedHours).toBe(120);
    // Linked to the programme adding the most hours.
    expect(line.situationId).toBe("holiday");
    expect(summary.beforeAfter.peak?.effectiveUtilization).toBeCloseTo(0.92, 6);
  });

  it("still adds formal hours across different line-months", () => {
    const other = fakeSituation({
      id: "valentine",
      cells: [{ lineId: "LINE-2", period: "2027-07", formalHours: 300, unresolvedHours: 10 }],
    });
    expect(summarizePortfolio([halloween, holiday, other]).formalHours).toBe(1100);
  });
});

describe("buildLineLoadSeries", () => {
  // Line 1: June 500 + 100 of 1000; July 800 formal (shared) + 50 + 70 = 920
  // of 900 — over. Line 2: July 950 formal alone of 1000.
  const halloween = fakeSituation({
    id: "halloween",
    cells: [
      { lineId: "LINE-1", period: "2027-06", formalHours: 500, unresolvedHours: 100 },
      { lineId: "LINE-1", period: "2027-07", formalHours: 800, unresolvedHours: 50, availableHours: 900 },
      { lineId: "LINE-2", period: "2027-07", formalHours: 950, unresolvedHours: 0 },
    ],
  });
  const holiday = fakeSituation({
    id: "holiday",
    cells: [{ lineId: "LINE-1", period: "2027-07", formalHours: 800, unresolvedHours: 70, availableHours: 900 }],
  });
  const both = [halloween, holiday];

  it("lists every line once, by name", () => {
    expect(listLoadLines(both).map((l) => l.lineId)).toEqual(["LINE-1", "LINE-2"]);
  });

  it("counts formal once per line-month and adds every programme's hours on top", () => {
    const line = buildLineLoadSeries(both, "LINE-1");
    expect(line.months.map((m) => m.period)).toEqual(["2027-06", "2027-07"]);
    const july = line.months[1]!;
    expect(july.committedHours).toBe(800);
    expect(july.addedHours).toBe(120);
    expect(july.capacityHours).toBe(900);
    expect(july.committedUtilization).toBeCloseTo(800 / 900, 6);
    expect(july.effectiveUtilization).toBeCloseTo(920 / 900, 6);
    expect(july.overCapacityHours).toBeCloseTo(20, 6);
    expect(july.byProgramme.map((p) => [p.situationId, p.hours])).toEqual([
      ["holiday", 70],
      ["halloween", 50],
    ]);
  });

  it("reports the peak, months over capacity and hours over for the header", () => {
    const line = buildLineLoadSeries(both, "LINE-1");
    expect(line.peakPeriod).toBe("2027-07");
    expect(line.peakUtilization).toBeCloseTo(920 / 900, 6);
    expect(line.monthsOverCapacity).toBe(1);
    expect(line.overCapacityHours).toBeCloseTo(20, 6);

    const june = line.months[0]!;
    expect(june.overCapacityHours).toBe(0);
    expect(june.byProgramme).toEqual([{ situationId: "halloween", title: "halloween", hours: 100 }]);
  });

  it("sums every line into the plant total", () => {
    const plant = buildLineLoadSeries(both, ALL_LINES);
    expect(plant.lineName).toBe("All lines (plant total)");
    const july = plant.months.find((m) => m.period === "2027-07")!;
    expect(july.committedHours).toBe(800 + 950);
    expect(july.addedHours).toBe(120);
    expect(july.capacityHours).toBe(900 + 1000);
    // Line 1 is over by 20h but the plant as a whole is not.
    expect(july.overCapacityHours).toBe(0);
  });

  it("opens on the line that goes furthest past capacity", () => {
    expect(worstLoadLine(both)).toBe("LINE-1");
    expect(worstLoadLine([])).toBeUndefined();
  });

  it("reconciles with the whole-horizon summary on the demo portfolio", () => {
    const all = situations();
    const summary = summarizePortfolio(all);
    const plant = buildLineLoadSeries(all, ALL_LINES);
    expect(plant.months.reduce((n, m) => n + m.committedHours, 0)).toBeCloseTo(summary.formalHours, 6);
    expect(plant.months.reduce((n, m) => n + m.addedHours, 0)).toBeCloseTo(summary.unresolvedHours, 6);

    const perLine = listLoadLines(all).reduce(
      (n, l) => n + buildLineLoadSeries(all, l.lineId).months.reduce((h, m) => h + m.addedHours, 0),
      0
    );
    expect(perLine).toBeCloseTo(summary.unresolvedHours, 6);
  });
});

describe("summarizePortfolio — currencies", () => {
  it("sums money when every programme shares a currency", () => {
    const summary = summarizePortfolio([
      fakeSituation({ id: "a", formalValue: 60, expectedValue: 100 }),
      fakeSituation({ id: "b", formalValue: 40, expectedValue: 100 }),
    ]);
    expect(summary.valuesComparable).toBe(true);
    expect(summary.formalValue).toBe(100);
    expect(summary.representedBasis).toBe("value");
    expect(summary.representedPct).toBeCloseTo(0.5, 6);
  });

  it("refuses to add USD to EUR, and falls back to units for representation", () => {
    const summary = summarizePortfolio([
      fakeSituation({ id: "a", currency: "USD", formalValue: 60, expectedValue: 100, formalUnits: 30, expectedUnits: 50 }),
      fakeSituation({ id: "b", currency: "EUR", formalValue: 40, expectedValue: 100, formalUnits: 20, expectedUnits: 50 }),
    ]);
    expect(summary.valuesComparable).toBe(false);
    expect(summary.currencies).toEqual(["EUR", "USD"]);
    expect(summary.formalValue).toBe(0);
    expect(summary.expectedValue).toBe(0);
    expect(summary.beforeAfter.valuesComparable).toBe(false);
    expect(summary.representedBasis).toBe("units");
    expect(summary.representedPct).toBeCloseTo(0.5, 6);
  });

  it("says representation is unavailable when neither money nor units can be combined", () => {
    const summary = summarizePortfolio([
      fakeSituation({ id: "a", currency: "USD", formalUnits: 30 }),
      fakeSituation({ id: "b", currency: "EUR", formalUnits: 20, expectedUnits: 50 }),
    ]);
    expect(summary.representedBasis).toBe("unavailable");
  });
});

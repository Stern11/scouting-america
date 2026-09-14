import { describe, expect, it } from "vitest";
import { normalizePlanningInput } from "@/lib/dataset/normalize";
import { buildSituations } from "@/lib/situations/build";
import {
  DEFAULT_DEMO_SEED,
  DEMO_PLANNING_NOW,
  demoAnchorYear,
  generateDemoDataset,
  generateDemoRawInput,
} from "./generate";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx] ?? 0;
}

describe("generateDemoDataset — determinism", () => {
  it("produces a byte-identical dataset for the same seed", () => {
    const a = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const b = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    expect(a).toEqual(b);
  });

  it("produces a byte-identical dataset across repeated calls with explicit options", () => {
    const a = generateDemoDataset({ seed: DEFAULT_DEMO_SEED, planningNow: DEMO_PLANNING_NOW });
    const b = generateDemoDataset({ seed: DEFAULT_DEMO_SEED, planningNow: DEMO_PLANNING_NOW });
    expect(a).toEqual(b);
  });

  it("produces a different (but still valid) dataset for a different seed", () => {
    const a = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const b = generateDemoDataset({ seed: "alternate-seed-9000", planningNow: DEMO_PLANNING_NOW });
    expect(a).not.toEqual(b);

    const { collector } = normalizePlanningInput(generateDemoRawInput({ seed: "alternate-seed-9000", planningNow: DEMO_PLANNING_NOW }));
    expect(collector.hasErrors()).toBe(false);
  });
});

describe("generateDemoDataset — zero validation errors", () => {
  it("normalizes the default demo input with zero errors", () => {
    const { collector } = normalizePlanningInput(generateDemoRawInput({ planningNow: DEMO_PLANNING_NOW }));
    if (collector.hasErrors()) {
      // Surface the actual problems if this ever regresses.
      console.error(collector.all().filter((i) => i.severity === "error"));
    }
    expect(collector.hasErrors()).toBe(false);
  });
});

describe("generateDemoDataset — capabilities", () => {
  it("has every optional capability enabled", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    expect(dataset.metadata.capabilities).toEqual({
      reconciliation: true,
      capacity: true,
      materials: true,
      leadTimeAnalysis: true,
      netRequirements: true,
      readinessHistory: true,
      lineHistory: true,
    });
  });

  it("stamps DEMO mode, the seed, and planningNow", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    expect(dataset.metadata.mode).toBe("DEMO");
    expect(dataset.metadata.seed).toBe(DEFAULT_DEMO_SEED);
    expect(dataset.metadata.planningNow).toBe(DEMO_PLANNING_NOW);
  });
});

describe("generateDemoDataset — Halloween reconciliation story", () => {
  it("lands expected/formal/unresolved in the intended range", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });

    const businessTotal = dataset.businessPlans
      .filter((r) => r.planningPeriod === "2027-Halloween")
      .reduce((s, r) => s + r.targetValue, 0);
    const formalTotal = dataset.currentPlanItems
      .filter((r) => r.planningPeriod === "2027-Halloween")
      .reduce((s, r) => s + (r.plannedValue ?? 0), 0);
    const unresolved = businessTotal - formalTotal;

    expect(businessTotal).toBeGreaterThan(550_000_000);
    expect(businessTotal).toBeLessThan(700_000_000);
    expect(formalTotal).toBeGreaterThan(350_000_000);
    expect(formalTotal).toBeLessThan(520_000_000);
    expect(unresolved).toBeGreaterThan(150_000_000);
    expect(unresolved).toBeLessThan(200_000_000);
  });

  it("Historical_Items orphans (no 2027 successor) roughly explain the unresolved amount", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const successorIds = new Set(
      dataset.currentPlanItems.filter((r) => r.planningPeriod === "2027-Halloween").map((r) => r.itemId)
    );
    const historicalHalloween = dataset.historicalItems.filter((r) => r.historicalPeriod === "2026-Halloween");
    // "Orphan" here means: no successor of the SAME item id family — since
    // ids are generated per-row, we approximate orphans as items produced
    // beyond the count of successor-bearing predecessors (the extra pool).
    const orphanCandidates = historicalHalloween.slice(-5);
    const orphanValue = orphanCandidates.reduce((s, r) => s + (r.actualValue ?? 0), 0);
    expect(successorIds.size).toBeGreaterThan(0);
    // Orphan value should roughly explain the unresolved dollar gap — units
    // vary with per-family price, so the dollar figure is the stable check.
    expect(orphanValue).toBeGreaterThan(100_000_000);
    expect(orphanValue).toBeLessThan(220_000_000);
  });
});

describe("generateDemoDataset — capacity", () => {
  it("has Line_Capacity rows for all 4 lines across every month 2027-01..2028-03", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const lineIds = ["LINE-01", "LINE-02", "LINE-03", "LINE-04"];
    const months: string[] = [];
    for (let y = 2027; y <= 2028; y++) {
      for (let m = 1; m <= 12; m++) {
        if (y === 2028 && m > 3) break;
        months.push(`${y}-${String(m).padStart(2, "0")}`);
      }
    }
    expect(months.length).toBe(15);

    for (const lineId of lineIds) {
      for (const month of months) {
        const row = dataset.lineCapacity.find((r) => r.lineId === lineId && r.period === month);
        expect(row, `expected a Line_Capacity row for ${lineId} / ${month}`).toBeDefined();
      }
    }
  });

  it("LINE-03 available hours vary month to month", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const line3Hours = dataset.lineCapacity.filter((r) => r.lineId === "LINE-03").map((r) => r.availableHours);
    expect(new Set(line3Hours).size).toBeGreaterThan(1);
  });

  it("LINE-03 available hours in 2027-06 are materially lower than a normal month", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const line3 = dataset.lineCapacity.filter((r) => r.lineId === "LINE-03");
    const june = line3.find((r) => r.period === "2027-06");
    const otherMonths = line3.filter((r) => r.period !== "2027-06");
    const avgOther = otherMonths.reduce((s, r) => s + r.availableHours, 0) / otherMonths.length;

    expect(june).toBeDefined();
    expect(june!.availableHours).toBeLessThan(avgOther * 0.85);
  });

  // --- Physical-plausibility guardrails (the credibility bug) -----------
  //
  // A calendar month has at most 31 * 24 = 744h. Available hours (after the
  // §20 deductions) can never exceed the base calendar hours they were
  // deducted from, and a line that exists at all should still carry a
  // sensible floor of hours even in a quiet month. These must hold for
  // EVERY row — not just the ones the golden-demo story cares about —
  // because a single impossible cell anywhere on the grid is enough for a
  // planner to stop trusting every other number on the page.
  it("every Line_Capacity row has physically plausible hours", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    expect(dataset.lineCapacity.length).toBeGreaterThan(0);
    for (const row of dataset.lineCapacity) {
      expect(row.baseCalendarHours, `${row.lineId}/${row.period} base_calendar_hours`).toBeLessThanOrEqual(744);
      expect(
        row.availableHours,
        `${row.lineId}/${row.period} available_hours <= base_calendar_hours`
      ).toBeLessThanOrEqual(row.baseCalendarHours);
      expect(row.availableHours, `${row.lineId}/${row.period} available_hours >= 250`).toBeGreaterThanOrEqual(250);
    }
  });

  it("every Item_Line_Mapping run rate is a plausible units/hour figure", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    expect(dataset.itemLineMappings.length).toBeGreaterThan(0);
    for (const mapping of dataset.itemLineMappings) {
      expect(mapping.runRateUnitsPerHour, `${mapping.itemOrFamilyId}/${mapping.lineId} run rate`).toBeGreaterThanOrEqual(1000);
      expect(mapping.runRateUnitsPerHour, `${mapping.itemOrFamilyId}/${mapping.lineId} run rate`).toBeLessThanOrEqual(20000);
    }
  });

  // The real engine, not just the raw sheet: `buildSituations()` is what
  // actually turns Line_Capacity + Item_Line_Mapping + Current_Plan +
  // candidates into formal/effective utilisation per cell. A dataset can
  // pass the row-level checks above and still produce an impossible
  // formalUtilization if the *load* (units / run rate / allocation) doesn't
  // fit inside the hours — so this is the assertion that actually catches
  // the credibility bug end to end.
  it("no capacity cell in any situation ever shows formal utilisation above 100%", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const situations = buildSituations(dataset);
    expect(situations.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const situation of situations) {
      for (const cell of situation.capacityExposure.cells) {
        if (cell.formalUtilization > 1.0) {
          offenders.push(
            `${situation.id} ${cell.lineId}/${cell.period} formalUtilization=${cell.formalUtilization.toFixed(3)}`
          );
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the golden Halloween demo moment: LINE-03 is tight but plausible in 2027-06, LINE-04 has real headroom", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const situations = buildSituations(dataset);
    const halloween = situations.find((s) => s.planningPeriod === "2027-Halloween");
    expect(halloween).toBeDefined();

    const line3June = halloween!.capacityExposure.cells.find((c) => c.lineId === "LINE-03" && c.period === "2027-06");
    const line4June = halloween!.capacityExposure.cells.find((c) => c.lineId === "LINE-04" && c.period === "2027-06");
    expect(line3June).toBeDefined();
    expect(line4June).toBeDefined();

    // LINE-03: formally represented plan looks routine (60-80% of a real
    // month's hours) but the carry-forward Halloween load pushes effective
    // utilisation past 100% — the whole point of the golden demo moment.
    expect(line3June!.formalUtilization).toBeGreaterThanOrEqual(0.65);
    expect(line3June!.formalUtilization).toBeLessThanOrEqual(0.78);
    expect(line3June!.effectiveUtilization).toBeGreaterThan(1.0);

    // LINE-04: genuine headroom, so shifting Variety Bags overflow there in
    // Scenario Lab is a feasible move, not a paper exercise.
    expect(line4June!.effectiveUtilization).toBeLessThan(0.7);
  });
});

describe("generateDemoDataset — MAT-FILM master-data story", () => {
  it("keeps the system lead time at 42 days for every MAT-FILM PO", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const film = dataset.leadTimeHistory.filter((r) => r.materialId === "MAT-FILM");
    expect(film.length).toBeGreaterThan(10);
    expect(film.every((r) => r.systemLeadTimeDays === 42)).toBe(true);
  });

  it("has an actual lead-time median in the 60-75 day range", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const film = dataset.leadTimeHistory.filter((r) => r.materialId === "MAT-FILM");
    const days = film.map((r) => r.actualLeadTimeDays);
    const med = median(days);
    expect(med).toBeGreaterThanOrEqual(60);
    expect(med).toBeLessThanOrEqual(75);
  });

  it("has a P80 actual lead time meaningfully above the system assumption", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const film = dataset.leadTimeHistory.filter((r) => r.materialId === "MAT-FILM");
    const days = film.map((r) => r.actualLeadTimeDays);
    const p80 = percentile(days, 0.8);
    expect(p80).toBeGreaterThan(70);
    expect(p80).toBeLessThan(100);
  });
});

describe("generateDemoDataset — cross references", () => {
  it("every BOM parent_item_id exists in Current_Plan or Historical_Items", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const known = new Set([
      ...dataset.currentPlanItems.map((r) => r.itemId),
      ...dataset.historicalItems.map((r) => r.itemId),
    ]);
    for (const bom of dataset.boms) {
      expect(known.has(bom.parentItemId), `unknown parent item ${bom.parentItemId}`).toBe(true);
    }
  });

  it("every Item_Line_Mapping line_id exists in Line_Capacity", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const lineIds = new Set(dataset.lineCapacity.map((r) => r.lineId));
    for (const mapping of dataset.itemLineMappings) {
      expect(lineIds.has(mapping.lineId), `unknown line ${mapping.lineId}`).toBe(true);
    }
  });

  it("includes a mix of mapping levels in Item_Line_Mapping", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const levels = new Set(dataset.itemLineMappings.map((r) => r.mappingLevel));
    expect(levels.has("PRODUCT_FAMILY")).toBe(true);
    expect(levels.has("BASE_PACK")).toBe(true);
    expect(levels.has("ITEM")).toBe(true);
  });

  it("has the Counter Displays line-mapping anomaly: mapping favors LINE-01/04, history favors LINE-02", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const cdHistorical = dataset.historicalItems.filter((r) => r.productFamily === "Counter Displays");
    const line02Count = cdHistorical.filter((r) => r.primaryLineId === "LINE-02").length;
    expect(cdHistorical.length).toBeGreaterThan(0);
    expect(line02Count / cdHistorical.length).toBeGreaterThan(0.6);

    const cdMapping = dataset.itemLineMappings.filter(
      (r) => r.itemOrFamilyId === "Counter Displays" && r.mappingLevel === "PRODUCT_FAMILY"
    );
    expect(cdMapping.some((r) => r.lineId === "LINE-02")).toBe(false);
  });
});

describe("generateDemoDataset — situations built by the real engine", () => {
  it("Halloween: 20 candidate items, 5 proposed carry_forward, and a headline bridge within ~2% of target", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const situations = buildSituations(dataset);
    const halloween = situations.find((s) => s.planningPeriod === "2027-Halloween");
    expect(halloween).toBeDefined();

    expect(halloween!.candidateItems.length).toBe(20);
    const carryForward = halloween!.candidateItems.filter((c) => c.disposition === "carry_forward");
    expect(carryForward.length).toBe(5);

    expect(halloween!.bridge.expectedValue).toBeGreaterThan(620_000_000 * 0.98);
    expect(halloween!.bridge.expectedValue).toBeLessThan(620_000_000 * 1.02);
    expect(halloween!.bridge.formalValue).toBeGreaterThan(446_000_000 * 0.98);
    expect(halloween!.bridge.formalValue).toBeLessThan(446_000_000 * 1.02);
    expect(halloween!.bridge.unresolvedValue).toBeGreaterThan(174_000_000 * 0.98);
    expect(halloween!.bridge.unresolvedValue).toBeLessThan(174_000_000 * 1.02);

    // Validated (carry_forward) value should land close to the unresolved
    // figure it's meant to explain — units vary with the per-family price
    // used to size the demo (kept a stable, credible ~$4-18/unit range), so
    // the dollar figure is the trustworthy invariant to pin here.
    expect(halloween!.bridge.validatedValue).toBeGreaterThan(150_000_000);
    expect(halloween!.bridge.validatedValue).toBeLessThan(200_000_000);
  });

  it("Holiday: headline bridge within ~2% of target, with a non-empty carry_forward set", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const situations = buildSituations(dataset);
    const holiday = situations.find((s) => s.planningPeriod === "2027-Holiday");
    expect(holiday).toBeDefined();

    expect(holiday!.candidateItems.length).toBeGreaterThan(0);
    const carryForward = holiday!.candidateItems.filter((c) => c.disposition === "carry_forward");
    expect(carryForward.length).toBeGreaterThanOrEqual(1);

    expect(holiday!.bridge.expectedValue).toBeGreaterThan(410_000_000 * 0.98);
    expect(holiday!.bridge.expectedValue).toBeLessThan(410_000_000 * 1.02);
    expect(holiday!.bridge.formalValue).toBeGreaterThan(349_000_000 * 0.98);
    expect(holiday!.bridge.formalValue).toBeLessThan(349_000_000 * 1.02);
    expect(holiday!.bridge.unresolvedValue).toBeGreaterThan(62_000_000 * 0.98);
    expect(holiday!.bridge.unresolvedValue).toBeLessThan(62_000_000 * 1.02);
  });

  it("Valentine: headline bridge within ~2% of target, with a non-empty carry_forward set", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const situations = buildSituations(dataset);
    const valentine = situations.find((s) => s.planningPeriod === "2028-Valentine");
    expect(valentine).toBeDefined();

    expect(valentine!.candidateItems.length).toBeGreaterThan(0);
    const carryForward = valentine!.candidateItems.filter((c) => c.disposition === "carry_forward");
    expect(carryForward.length).toBeGreaterThanOrEqual(1);

    expect(valentine!.bridge.expectedValue).toBeGreaterThan(150_000_000 * 0.98);
    expect(valentine!.bridge.expectedValue).toBeLessThan(150_000_000 * 1.02);
    expect(valentine!.bridge.formalValue).toBeGreaterThan(83_000_000 * 0.98);
    expect(valentine!.bridge.formalValue).toBeLessThan(83_000_000 * 1.02);
    expect(valentine!.bridge.unresolvedValue).toBeGreaterThan(67_000_000 * 0.98);
    expect(valentine!.bridge.unresolvedValue).toBeLessThan(67_000_000 * 1.02);
  });

  it("Halloween materials: at least 3 PLAN_NOW and at least 1 WAIT", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const situations = buildSituations(dataset);
    const halloween = situations.find((s) => s.planningPeriod === "2027-Halloween");
    expect(halloween).toBeDefined();
    expect(halloween!.materialExposure.planNowCount).toBeGreaterThanOrEqual(3);
    expect(halloween!.materialExposure.waitCount).toBeGreaterThanOrEqual(1);
  });

  it("each programme has two comparable prior seasons available in Historical_Items", () => {
    const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
    const halloweenPeriods = new Set(
      dataset.historicalItems.filter((r) => r.eventOrProgram?.toLowerCase().includes("halloween")).map((r) => r.historicalPeriod)
    );
    const holidayPeriods = new Set(
      dataset.historicalItems.filter((r) => r.eventOrProgram?.toLowerCase().includes("holiday")).map((r) => r.historicalPeriod)
    );
    const valentinePeriods = new Set(
      dataset.historicalItems.filter((r) => r.eventOrProgram?.toLowerCase().includes("valentine")).map((r) => r.historicalPeriod)
    );
    expect(halloweenPeriods.size).toBeGreaterThanOrEqual(2);
    expect(holidayPeriods.size).toBeGreaterThanOrEqual(2);
    expect(valentinePeriods.size).toBeGreaterThanOrEqual(2);
  });
});

describe("generateDemoDataset — the calendar follows the anchor date", () => {
  // The demo used to be pinned to March 2027, so it opened on a date that was
  // not today. The programme calendar now moves in whole years, which keeps
  // Halloween in autumn while letting "today" be genuinely today.
  it("moves the programme years with the anchor", () => {
    const early = generateDemoDataset({ planningNow: "2026-09-04T12:00:00.000Z" });
    const later = generateDemoDataset({ planningNow: "2027-09-04T12:00:00.000Z" });

    const periodsOf = (d: typeof early) => [...new Set(d.businessPlans.map((b) => b.planningPeriod))].sort();
    expect(periodsOf(early)).toEqual(["2027-Halloween", "2027-Holiday", "2028-Valentine"]);
    expect(periodsOf(later)).toEqual(["2028-Halloween", "2028-Holiday", "2029-Valentine"]);
  });

  it("picks the season whose production has not started yet", () => {
    // Before production opens in late April, this year's season is still ahead.
    expect(demoAnchorYear("2027-02-10T00:00:00.000Z")).toBe(2027);
    expect(demoAnchorYear("2027-04-30T00:00:00.000Z")).toBe(2027);
    // Once it has started, the demo moves to the next one.
    expect(demoAnchorYear("2027-05-01T00:00:00.000Z")).toBe(2028);
    expect(demoAnchorYear("2027-12-31T00:00:00.000Z")).toBe(2028);
  });

  it("keeps the headline figures and the capacity story at any anchor", () => {
    for (const planningNow of [
      "2026-09-04T12:00:00.000Z",
      "2027-02-10T12:00:00.000Z",
      "2028-11-20T12:00:00.000Z",
    ]) {
      const situations = buildSituations(generateDemoDataset({ planningNow }));
      expect(situations).toHaveLength(3);

      const halloween = situations.find((s) => s.title.startsWith("Halloween"));
      expect(halloween).toBeDefined();
      expect(halloween!.bridge.unresolvedValue).toBeGreaterThan(170_000_000);
      expect(halloween!.bridge.unresolvedValue).toBeLessThan(178_000_000);

      // The formal plan must remain buildable whatever year it lands in.
      for (const cell of situations.flatMap((s) => s.capacityExposure.cells)) {
        expect(cell.formalUtilization).toBeLessThanOrEqual(1);
      }
    }
  });

  it("reports today as the anchor and puts production ahead of it", () => {
    const planningNow = "2026-09-04T12:00:00.000Z";
    for (const situation of buildSituations(generateDemoDataset({ planningNow }))) {
      expect(situation.runway.today).toBe(planningNow.slice(0, 10));
      expect(situation.productionWindow!.start > planningNow.slice(0, 10)).toBe(true);
    }
  });
});

describe("generateDemoDataset — new products this season", () => {
  // The unspecified renovation in each programme has no prior-year echo, so it
  // is a genuinely new product: no row in any earlier comparable season.
  for (const planningNow of [DEMO_PLANNING_NOW, "2026-09-15T09:00:00Z"]) {
    it(`flags a new product in every programme, and it is the analogue-derived renovation (${planningNow})`, () => {
      const situations = buildSituations(generateDemoDataset({ planningNow }));
      for (const title of ["Halloween", "Holiday", "Valentine"]) {
        const s = situations.find((x) => x.title.includes(title));
        expect(s, title).toBeDefined();
        const fresh = s!.candidateItems.filter((c) => c.isNewThisSeason);
        expect(fresh.length, title).toBeGreaterThanOrEqual(1);
        // Nothing is new that has an earlier season in its own history.
        for (const c of s!.candidateItems) {
          if (c.seasonHistory.length > 1) expect(c.isNewThisSeason, c.itemName).toBe(false);
        }
        expect(fresh.some((c) => c.derivation === "analogue"), title).toBe(true);
      }
    });
  }
});

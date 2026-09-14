import { describe, expect, it } from "vitest";
import { DEMO_PLANNING_NOW, generateDemoDataset } from "@/lib/dataset/demo/generate";
import { buildSituations } from "@/lib/situations/build";
import { daysBetween, weeksBetween } from "@/lib/dataset/periods";
import {
  buildCapacityPlan,
  procurementUrgency,
  pullForwardPlanForMonth,
  calendarMaxHours,
  describeCapacityChanges,
  describeLineHistory,
  focusMonth,
  lineChartMonths,
  worstPeriod,
  EMPTY_CAPACITY_ADJUSTMENTS,
  extraShiftHoursFor,
  lineHistoryStats,
  lineMonthKey,
  resolveCapacityEntry,
  weekendDaysIn,
  type CapacityAdjustments,
} from "./capacity-plan";

const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
const situations = buildSituations(dataset);
const baseline = buildCapacityPlan(dataset, situations);

function adjust(partial: Partial<CapacityAdjustments>): CapacityAdjustments {
  return { ...EMPTY_CAPACITY_ADJUSTMENTS, ...partial };
}

const allCells = (plan = baseline) => plan.lines.flatMap((l) => l.cells);

describe("calendar rules", () => {
  it("knows a month's physical ceiling and its weekend days", () => {
    expect(calendarMaxHours("2027-05")).toBe(744);
    expect(calendarMaxHours("2028-02")).toBe(29 * 24);
    // May 2027 starts on a Saturday: five full weekends.
    expect(weekendDaysIn("2027-05")).toBe(10);
    expect(extraShiftHoursFor("2027-05")).toBe(80);
  });
});

describe("buildCapacityPlan", () => {
  it("covers the plant's lines across the months that carry load", () => {
    expect(baseline.available).toBe(true);
    expect(baseline.plant).toBe("PLT-01");
    expect(baseline.lines.map((l) => l.lineId)).toEqual(["LINE-01", "LINE-02", "LINE-03", "LINE-04"]);
    expect(baseline.periods.length).toBeGreaterThan(3);
    // Starts no earlier than the planner's own month.
    expect(baseline.periods[0]! >= DEMO_PLANNING_NOW.slice(0, 7)).toBe(true);
  });

  it("reconciles: formal hours match every programme's cells, counted once", () => {
    for (const cell of allCells()) {
      const situationCell = situations
        .flatMap((s) => s.capacityExposure.cells)
        .find((c) => c.lineId === cell.lineId && c.period === cell.period);
      if (!situationCell) continue;
      expect(cell.formalHours).toBeCloseTo(situationCell.formalHours, 6);
    }
  });

  it("reconciles: carry-forward hours are the sum of every programme's carry-forward hours", () => {
    for (const cell of allCells()) {
      const expected = situations
        .flatMap((s) => s.capacityExposure.cells)
        .filter((c) => c.lineId === cell.lineId && c.period === cell.period)
        .reduce((sum, c) => sum + c.unresolvedHours, 0);
      expect(cell.carryForwardHours).toBeCloseTo(expected, 6);
    }
  });

  it("an edited cap is clamped to the calendar and never mutates the dataset", () => {
    const cell = allCells()[5]!;
    const key = lineMonthKey(cell.lineId, cell.period);
    const before = dataset.lineCapacity.find((r) => lineMonthKey(r.lineId, r.period) === key)!.availableHours;

    const plan = buildCapacityPlan(dataset, situations, adjust({ availableHours: { [key]: 99_999 } }));
    const after = allCells(plan).find((c) => c.lineId === cell.lineId && c.period === cell.period)!;
    expect(after.plannedAvailableHours).toBe(calendarMaxHours(cell.period));
    expect(dataset.lineCapacity.find((r) => lineMonthKey(r.lineId, r.period) === key)!.availableHours).toBe(before);
  });

  it("an extra shift adds its weekend hours, capped by the calendar", () => {
    const cell = allCells()[5]!;
    const key = lineMonthKey(cell.lineId, cell.period);
    const on = buildCapacityPlan(dataset, situations, adjust({ extraShifts: { [key]: 1 } }));
    const shifted = allCells(on).find((c) => c.lineId === cell.lineId && c.period === cell.period)!;
    expect(shifted.extraShiftHours).toBe(extraShiftHoursFor(cell.period));
    expect(shifted.availableHours).toBe(cell.availableHours + extraShiftHoursFor(cell.period));
    expect(on.summary.extraShiftHours).toBe(extraShiftHoursFor(cell.period));

    const capped = buildCapacityPlan(
      dataset,
      situations,
      adjust({ availableHours: { [key]: calendarMaxHours(cell.period) - 10 }, extraShifts: { [key]: 1 } })
    );
    const full = allCells(capped).find((c) => c.lineId === cell.lineId && c.period === cell.period)!;
    expect(full.extraShiftHours).toBe(10);
    expect(full.availableHours).toBe(calendarMaxHours(cell.period));
  });

  it("reducing a brand × pack allocation frees its hours and reports what is not supplied", () => {
    const biggest = baseline.brandPacks[0]!;
    const plan = buildCapacityPlan(dataset, situations, adjust({ allocation: { [biggest.key]: 0.5 } }));
    const bp = plan.brandPacks.find((b) => b.key === biggest.key)!;

    expect(bp.hoursFreed).toBeCloseTo(biggest.totalHours / 2, 6);
    expect(bp.unitsNotSupplied).toBeCloseTo(biggest.units / 2, 6);
    expect(bp.revenueAtRisk).toBeCloseTo(biggest.value / 2, 6);

    const loadBefore = allCells().reduce((s, c) => s + c.loadHours, 0);
    const loadAfter = allCells(plan).reduce((s, c) => s + c.loadHours, 0);
    expect(loadBefore - loadAfter).toBeCloseTo(bp.hoursFreed, 6);
    expect(plan.summary.unitsNotSupplied).toBeCloseTo(bp.unitsNotSupplied, 6);
  });

  it("brand × pack load adds back up to the line load", () => {
    const load = allCells().reduce((s, c) => s + c.loadHours, 0);
    const byBrandPack = baseline.brandPacks.reduce((s, b) => s + b.totalHours, 0);
    expect(byBrandPack).toBeCloseTo(load, 6);
  });

  it("pulling forward shifts carry-forward hours without creating or losing any", () => {
    const worst = [...baseline.lines].sort((a, b) => b.overCapacityHours - a.overCapacityHours)[0]!;
    const before = worst.cells.reduce((s, c) => s + c.loadHours, 0);
    const plan = buildCapacityPlan(dataset, situations, adjust({ moveWeeks: { [worst.lineId]: 8 } }));
    const line = plan.lines.find((l) => l.lineId === worst.lineId)!;
    expect(line.overCapacityHours).toBeLessThanOrEqual(worst.overCapacityHours);
    expect(line.cells.reduce((s, c) => s + c.loadAfterHours, 0)).toBeCloseTo(before, 6);
    expect(line.moveDirection).toBe(line.movedHours > 0 ? "earlier" : "none");
    for (const cell of line.cells) {
      // Formal load never moves; only carry-forward can leave a month.
      expect(cell.movedOutHours).toBeLessThanOrEqual(cell.carryForwardHours + 1e-6);
      expect(cell.loadAfterHours).toBeGreaterThanOrEqual(cell.formalHours - 1e-6);
    }
  });

  it("records each pull-forward as an SKU move, earlier only, adding up to the hours moved", () => {
    const nowMonth = DEMO_PLANNING_NOW.slice(0, 7);
    for (const l of baseline.lines) {
      const plan = buildCapacityPlan(dataset, situations, adjust({ moveWeeks: { [l.lineId]: 8 } }));
      const line = plan.lines.find((x) => x.lineId === l.lineId)!;
      expect(line.moves.reduce((s, m) => s + m.hours, 0)).toBeCloseTo(line.movedHours, 6);
      for (const move of line.moves) {
        expect(move.toPeriod < move.fromPeriod).toBe(true);
        expect(move.toPeriod >= nowMonth).toBe(true);
        expect(situations.some((s) => s.id === move.situationId)).toBe(true);
        expect(move.units).toBeGreaterThan(0);
      }
      for (const cell of line.cells) {
        const out = line.moves.filter((m) => m.fromPeriod === cell.period).reduce((s, m) => s + m.hours, 0);
        const into = line.moves.filter((m) => m.toPeriod === cell.period).reduce((s, m) => s + m.hours, 0);
        expect(out).toBeCloseTo(cell.movedOutHours, 6);
        expect(into).toBeCloseTo(cell.movedInHours, 6);
      }
    }
  });

  it("prices moved units at the SKU's own run rate on that line", () => {
    const worst = [...baseline.lines].sort((a, b) => b.overCapacityHours - a.overCapacityHours)[0]!;
    const plan = buildCapacityPlan(dataset, situations, adjust({ moveWeeks: { [worst.lineId]: 8 } }));
    const move = plan.lines.find((l) => l.lineId === worst.lineId)!.moves[0];
    if (!move) return;
    const situation = situations.find((s) => s.id === move.situationId)!;
    const candidate = situation.candidateItems.find((c) => c.id === move.candidateId)!;
    const hoursOnLine = situation.capacityExposure.cells
      .filter((c) => c.lineId === worst.lineId)
      .flatMap((c) => c.contributors)
      .filter((c) => c.candidateId === move.candidateId)
      .reduce((s, c) => s + c.hours, 0);
    // With a single line mapping, units on the line are all planned units.
    const rate = move.units! / move.hours;
    expect(rate).toBeLessThanOrEqual(candidate.plannedUnits / hoursOnLine + 1e-6);
    expect(rate).toBeGreaterThan(0);
  });

  it("says why when there is nothing to plan with", () => {
    const plan = buildCapacityPlan({ ...dataset, lineCapacity: [] }, situations);
    expect(plan.available).toBe(false);
    expect(plan.unavailableReason).toMatch(/Line_Capacity/);
  });
});

describe("line history", () => {
  it("summarises the last twelve months in one line", () => {
    const stats = lineHistoryStats(dataset.lineHistory, "LINE-03", DEMO_PLANNING_NOW.slice(0, 7))!;
    const rows = dataset.lineHistory.filter((r) => r.lineId === "LINE-03");
    const scheduled = rows.reduce((s, r) => s + r.scheduledHours, 0);
    const run = rows.reduce((s, r) => s + r.runHours, 0);

    expect(stats.months).toBe(12);
    expect(stats.attainmentPct).toBeCloseTo(run / scheduled, 9);
    expect(stats.avgDowntimeHours).toBeGreaterThan(0);
    expect(describeLineHistory(stats)).toMatch(/^Last 12 months: .*h\/mo unplanned downtime · .*h\/mo overtime · .* late material arrivals?\/mo$/);
  });

  it("invents nothing when Line_History is absent", () => {
    const plan = buildCapacityPlan(
      {
        ...dataset,
        lineHistory: [],
        metadata: { ...dataset.metadata, capabilities: { ...dataset.metadata.capabilities, lineHistory: false } },
      },
      situations
    );
    expect(plan.historyAvailable).toBe(false);
    expect(plan.lines.every((l) => l.history === undefined)).toBe(true);
  });
});

describe("chart and focused month", () => {
  it("before any scenario, chart bars are formal and carry-forward — the Overview's hours", () => {
    for (const line of baseline.lines) {
      lineChartMonths(line).forEach((m, i) => {
        const cell = line.cells[i]!;
        expect(m.committedHours).toBeCloseTo(cell.formalHours, 6);
        expect(m.addedHours).toBeCloseTo(cell.carryForwardHours, 6);
        expect(m.movedInHours).toBe(0);
        expect(m.capacityHours).toBe(cell.availableHours);
      });
    }
  });

  it("after a move, bars still add up to what the line runs", () => {
    const worst = [...baseline.lines].sort((a, b) => b.overCapacityHours - a.overCapacityHours)[0]!;
    const plan = buildCapacityPlan(dataset, situations, adjust({ moveWeeks: { [worst.lineId]: 8 } }));
    const line = plan.lines.find((l) => l.lineId === worst.lineId)!;
    lineChartMonths(line).forEach((m, i) => {
      expect(m.committedHours + m.addedHours + m.movedInHours).toBeCloseTo(line.cells[i]!.loadAfterHours, 6);
    });
  });

  it("before and after are different series once a scenario moves load; before is the baseline", () => {
    const worst = [...baseline.lines].sort((a, b) => b.overCapacityHours - a.overCapacityHours)[0]!;
    const plan = buildCapacityPlan(dataset, situations, adjust({ moveWeeks: { [worst.lineId]: 8 } }));
    const after = plan.lines.find((l) => l.lineId === worst.lineId)!;
    expect(after.movedHours).toBeGreaterThan(0);

    const beforeBars = lineChartMonths(worst);
    const afterBars = lineChartMonths(after);
    expect(beforeBars.every((m) => m.movedInHours === 0)).toBe(true);
    expect(afterBars.some((m) => m.movedInHours > 0.5)).toBe(true);
    expect(afterBars).not.toEqual(beforeBars);

    // The Before view passes the baseline line twice: nothing moves, nothing resolves.
    const period = worstPeriod(worst)!;
    const beforeFocus = focusMonth(worst, worst, period)!;
    expect(beforeFocus.movedHours).toBe(0);
    expect(beforeFocus.overflowAfterHours).toBe(beforeFocus.overflowBeforeHours);
    const afterFocus = focusMonth(worst, after, period)!;
    expect(afterFocus.overflowAfterHours).toBeLessThan(afterFocus.overflowBeforeHours);
  });

  it("focuses the worst month and prices the hours it resolves", () => {
    const worst = [...baseline.lines].sort((a, b) => b.overCapacityHours - a.overCapacityHours)[0]!;
    const period = worstPeriod(worst)!;
    const cell = worst.cells.find((c) => c.period === period)!;
    expect(cell.overCapacityHours).toBe(Math.max(...worst.cells.map((c) => c.overCapacityHours)));

    const key = lineMonthKey(worst.lineId, period);
    const plan = buildCapacityPlan(dataset, situations, adjust({ extraShifts: { [key]: 1 } }));
    const focus = focusMonth(worst, plan.lines.find((l) => l.lineId === worst.lineId)!, period)!;
    expect(focus.overflowBeforeHours).toBeCloseTo(cell.overCapacityHours, 6);
    expect(focus.hoursResolved).toBeCloseTo(focus.overflowBeforeHours - focus.overflowAfterHours, 6);
    expect(focus.unitsSecured).toBeCloseTo((cell.units / cell.loadHours) * focus.hoursResolved, 6);
  });
});

describe("pullForwardPlanForMonth", () => {
  const worst = [...baseline.lines].sort((a, b) => b.overCapacityHours - a.overCapacityHours)[0]!;
  const plan = buildCapacityPlan(dataset, situations, adjust({ moveWeeks: { [worst.lineId]: 8 } }));
  const line = plan.lines.find((l) => l.lineId === worst.lineId)!;

  it("lists every SKU leaving or arriving in the month, with components ordered earlier by the same shift", () => {
    const move = line.moves[0]!;
    const monthPlan = pullForwardPlanForMonth(line, move.fromPeriod, situations, DEMO_PLANNING_NOW)!;
    const touching = line.moves.filter((m) => m.fromPeriod === move.fromPeriod || m.toPeriod === move.fromPeriod);
    expect(monthPlan.skus).toHaveLength(touching.length);

    const sku = monthPlan.skus.find((s) => s.candidateId === move.candidateId && s.toPeriod === move.toPeriod)!;
    expect(sku.direction).toBe("out");
    expect(sku.shiftDays).toBeGreaterThanOrEqual(28);

    const situation = situations.find((s) => s.id === move.situationId)!;
    for (const component of sku.components) {
      const row = situation.materialExposure.rows.find((r) => r.materialId === component.materialId)!;
      const contributor = row.contributors.find((c) => c.candidateId === move.candidateId)!;
      expect(component.quantity).toBeCloseTo((contributor.requirement / contributor.units) * move.units!, 6);
      expect(component.wasOrderBy).toBe(row.decisionDate);
      expect(daysBetween(component.orderBy, component.wasOrderBy)).toBe(sku.shiftDays);
      expect(component.weeksLeft).toBe(weeksBetween(DEMO_PLANNING_NOW, component.orderBy));
      expect(component.urgency).toBe(procurementUrgency(component.weeksLeft));
      expect(component.waitNote !== undefined).toBe(component.status === "WAIT");
    }
  });

  it("shows the move from the receiving month as arriving", () => {
    const move = line.moves[0]!;
    const monthPlan = pullForwardPlanForMonth(line, move.toPeriod, situations, DEMO_PLANNING_NOW)!;
    expect(monthPlan.skus.some((s) => s.candidateId === move.candidateId && s.direction === "in")).toBe(true);
  });

  it("is empty for a month nothing moves in, and carries that month's hours", () => {
    const cell = worst.cells[0]!;
    const monthPlan = pullForwardPlanForMonth(worst, cell.period, situations, DEMO_PLANNING_NOW)!;
    expect(monthPlan.skus).toEqual([]);
    expect(monthPlan.committedHours).toBe(cell.formalHours);
    expect(monthPlan.carryForwardHours).toBe(cell.carryForwardHours);
    expect(monthPlan.capacityHours).toBe(cell.availableHours);
  });

  it("grades urgency: overdue or ≤8 weeks critical, ≤20 warning, else positive", () => {
    expect(procurementUrgency(-3)).toBe("critical");
    expect(procurementUrgency(8)).toBe("critical");
    expect(procurementUrgency(9)).toBe("warning");
    expect(procurementUrgency(20)).toBe("warning");
    expect(procurementUrgency(21)).toBe("positive");
  });
});

describe("one set of cells behind every figure", () => {
  const worst = [...baseline.lines].sort((a, b) => b.overCapacityHours - a.overCapacityHours)[0]!;
  const period = worstPeriod(worst)!;
  const cell = worst.cells.find((c) => c.period === period)!;
  const scenarios: [string, CapacityAdjustments][] = [
    ["baseline", EMPTY_CAPACITY_ADJUSTMENTS],
    ["pull forward", adjust({ moveWeeks: { [worst.lineId]: 8 } })],
    ["cap cut", adjust({ availableHours: { [lineMonthKey(worst.lineId, period)]: 30 } })],
    [
      "cap cut + pull forward + shift",
      adjust({
        moveWeeks: { [worst.lineId]: 8 },
        availableHours: { [lineMonthKey(worst.lineId, period)]: Math.round(cell.availableHours * 0.5) },
        extraShifts: { [lineMonthKey(worst.lineId, worst.cells[0]!.period)]: 1 },
      }),
    ],
  ];

  it.each(scenarios)("%s: the hero is the sum of every line's per-cell over capacity, and the chart agrees", (_, a) => {
    const plan = buildCapacityPlan(dataset, situations, a);
    const cellTotal = plan.lines.reduce((s, l) => s + l.cells.reduce((t, c) => t + c.overCapacityHours, 0), 0);
    expect(plan.summary.overCapacityHours).toBeCloseTo(cellTotal, 6);
    for (const line of plan.lines) {
      expect(line.overCapacityHours).toBeCloseTo(
        line.cells.reduce((t, c) => t + c.overCapacityHours, 0),
        6
      );
      lineChartMonths(line).forEach((m, i) => {
        const c = line.cells[i]!;
        const over = Math.max(0, m.committedHours + m.addedHours + m.movedInHours - m.capacityHours);
        expect(over).toBeCloseTo(c.overCapacityHours, 6);
        const f = focusMonth(baseline.lines.find((l) => l.lineId === line.lineId)!, line, c.period)!;
        expect(f.overflowAfterHours).toBe(c.overCapacityHours);
      });
    }
    const peak = plan.lines.flatMap((l) => l.cells).reduce((m, c) => Math.max(m, c.utilization), 0);
    expect(plan.summary.peak?.utilization).toBe(peak);
  });

  it("marks exactly the months whose capacity was edited", () => {
    const shiftKey = lineMonthKey(worst.lineId, worst.cells[0]!.period);
    const plan = buildCapacityPlan(
      dataset,
      situations,
      adjust({
        availableHours: {
          [lineMonthKey(worst.lineId, period)]: 30,
          // Set back to its own baseline: not an edit.
          [lineMonthKey(worst.lineId, worst.cells[1]!.period)]: worst.cells[1]!.baselineAvailableHours,
        },
        extraShifts: { [shiftKey]: 1 },
      })
    );
    const line = plan.lines.find((l) => l.lineId === worst.lineId)!;
    const edited = lineChartMonths(line)
      .filter((m) => m.capacityEdited)
      .map((m) => m.period)
      .sort();
    expect(edited).toEqual([period, worst.cells[0]!.period].sort());
    expect(lineChartMonths(worst).some((m) => m.capacityEdited)).toBe(false);
  });
});

describe("resolveCapacityEntry", () => {
  const cell = { plannedAvailableHours: 480, baselineAvailableHours: 480, calendarMaxHours: 744, formalHours: 400 };

  it("never turns a blank or garbage box into a zero-hour month", () => {
    expect(resolveCapacityEntry("", cell)).toEqual({ kind: "unchanged" });
    expect(resolveCapacityEntry("   ", cell)).toEqual({ kind: "unchanged" });
    expect(resolveCapacityEntry("abc", cell)).toEqual({ kind: "unchanged" });
    expect(resolveCapacityEntry("480", cell)).toEqual({ kind: "unchanged" });
  });

  it("sets a plausible value, clamped to the calendar, and resets when it matches Line_Capacity", () => {
    expect(resolveCapacityEntry("520", cell)).toEqual({ kind: "set", hours: 520 });
    expect(resolveCapacityEntry("1,000h", cell)).toEqual({ kind: "set", hours: 744 });
    expect(resolveCapacityEntry("480", { ...cell, plannedAvailableHours: 520 })).toEqual({ kind: "reset" });
  });

  it("asks before a cap below the month's formal load — a half-typed 43 for 433", () => {
    expect(resolveCapacityEntry("43", cell)).toEqual({ kind: "confirm", hours: 43 });
    expect(resolveCapacityEntry("0", cell)).toEqual({ kind: "confirm", hours: 0 });
    expect(resolveCapacityEntry("400", cell)).toEqual({ kind: "set", hours: 400 });
  });
});

describe("pull-forward plan order", () => {
  it("does not re-sort SKUs when the lever changes how many hours each moves", () => {
    const worst = [...baseline.lines].sort((a, b) => b.overCapacityHours - a.overCapacityHours)[0]!;
    const names = (weeks: number) => {
      const plan = buildCapacityPlan(dataset, situations, adjust({ moveWeeks: { [worst.lineId]: weeks } }));
      const line = plan.lines.find((l) => l.lineId === worst.lineId)!;
      return line.cells.flatMap((c) =>
        (pullForwardPlanForMonth(line, c.period, situations, DEMO_PLANNING_NOW)?.skus ?? []).map(
          (s) => `${c.period}:${s.direction}:${s.itemName}`
        )
      );
    };
    const isSorted = (list: string[]) => {
      // Within each month and direction, names are alphabetical.
      const groups = new Map<string, string[]>();
      for (const k of list) {
        const [p, d, ...rest] = k.split(":");
        const g = `${p}:${d}`;
        groups.set(g, [...(groups.get(g) ?? []), rest.join(":")]);
      }
      return [...groups.values()].every((g) => g.every((n, i) => i === 0 || g[i - 1]!.localeCompare(n) <= 0));
    };
    expect(names(8).length).toBeGreaterThan(0);
    expect(isSorted(names(4))).toBe(true);
    expect(isSorted(names(8))).toBe(true);
  });

  it("carries the new-this-season flag onto each moved SKU", () => {
    const worst = [...baseline.lines].sort((a, b) => b.overCapacityHours - a.overCapacityHours)[0]!;
    const plan = buildCapacityPlan(dataset, situations, adjust({ moveWeeks: { [worst.lineId]: 8 } }));
    const line = plan.lines.find((l) => l.lineId === worst.lineId)!;
    const candidates = new Map(situations.flatMap((s) => s.candidateItems.map((c) => [`${s.id}::${c.id}`, c])));
    expect(line.moves.length).toBeGreaterThan(0);
    for (const m of line.moves) {
      expect(m.isNewThisSeason).toBe(candidates.get(`${m.situationId}::${m.candidateId}`)!.isNewThisSeason);
    }
  });
});

describe("describeCapacityChanges", () => {
  it("lists only the levers actually moved", () => {
    expect(describeCapacityChanges(baseline, EMPTY_CAPACITY_ADJUSTMENTS)).toEqual([]);

    const cell = allCells()[5]!;
    const key = lineMonthKey(cell.lineId, cell.period);
    const bp = baseline.brandPacks[0]!;
    const adjustments = adjust({
      availableHours: { [key]: cell.baselineAvailableHours + 40 },
      extraShifts: { [key]: 1 },
      allocation: { [bp.key]: 0.8 },
    });
    const changes = describeCapacityChanges(buildCapacityPlan(dataset, situations, adjustments), adjustments);
    expect(changes.map((c) => c.category).sort()).toEqual(["allocation", "availableHours", "extraShifts"]);
  });
});

/**
 * Cross-page reconciliation.
 *
 * The same figure is computed by more than one module — Overview's portfolio
 * roll-up and horizon, Reconcile's bridge and candidate list, Decisions, the
 * SKU and material drawers, and Scenario Lab's baseline. Each page is honest
 * on its own; this suite is what stops two honest pages from disagreeing.
 *
 * Every assertion compares two independently computed numbers. Nothing here
 * re-implements a module's arithmetic beyond the one-line definition a planner
 * would use to check it by hand ("carrying forward is the carry-forward SKUs").
 *
 * Runs on the demo at the pinned anchor, at a real "today", and with planner
 * dispositions applied — the case where counting by match status and counting
 * by disposition come apart.
 */

import { describe, expect, it } from "vitest";
import { generateDemoDataset } from "@/lib/dataset/demo/generate";
import type { PlanningDataset } from "@/types/dataset";
import {
  LOAD_BEARING_DISPOSITIONS,
  type ContributorDisposition,
  type PlanningSituation,
  type SituationOverrides,
} from "@/types/situation";
import { buildSituations } from "./build";
import { buildCapacityPlan } from "./capacity-plan";
import { upcomingDecisions, blockedAcrossProgrammes, nextDecision, releaseFor, pendingDecisions } from "./decisions";
import { buildDemandPlan } from "./demand-plan";
import { buildPlanningHorizon, missingItems, skuCounts } from "./horizon";
import { materialDetail } from "./material-detail";
import { ALL_LINES, buildLineLoadSeries, listLoadLines, summarizePortfolio } from "./portfolio";
import { buildReadinessCurve } from "./readiness-curve";
import { skuImpact } from "./sku-impact";

const UNDECIDED: readonly ContributorDisposition[] = ["unreviewed", "under_review", "new_or_changed"];
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const close = (a: number, b: number, tolerance = 1e-6) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(a), Math.abs(b)));

interface Case {
  name: string;
  dataset: PlanningDataset;
  situations: PlanningSituation[];
  overrides: Record<string, SituationOverrides>;
}

/**
 * Planner decisions that separate "unmatched" from "missing": an unmatched item
 * exited, an unmatched item declared represented, a matched item doubted, and a
 * matched item carried forward anyway.
 */
function withPlannerDecisions(dataset: PlanningDataset): Record<string, SituationOverrides> {
  const baseline = buildSituations(dataset);
  const out: Record<string, SituationOverrides> = {};
  for (const s of baseline) {
    const unmatched = s.candidateItems.filter((c) => !c.match.matchedItemId);
    const matched = s.candidateItems.filter((c) => c.match.matchedItemId);
    const dispositions: Record<string, ContributorDisposition> = {};
    if (unmatched[0]) dispositions[unmatched[0].id] = "intentional_exit";
    if (unmatched[1]) dispositions[unmatched[1].id] = "already_represented";
    if (unmatched[2]) dispositions[unmatched[2].id] = "new_or_changed";
    if (matched[0]) dispositions[matched[0].id] = "under_review";
    if (matched[1]) dispositions[matched[1].id] = "carry_forward";
    out[s.id] = { dispositions };
  }
  return out;
}

function makeCase(name: string, planningNow: string, planner = false): Case {
  const dataset = generateDemoDataset({ planningNow });
  const overrides = planner ? withPlannerDecisions(dataset) : {};
  return { name, dataset, overrides, situations: buildSituations(dataset, { overridesBySituation: overrides }) };
}

const CASES: Case[] = [
  makeCase("demo anchor", "2027-03-08T09:00:00.000Z"),
  makeCase("real today", "2026-09-15T09:00:00Z"),
  makeCase("real today, planner decisions", "2026-09-15T09:00:00Z", true),
];

/** Reconcile's own reading of one programme, straight off its candidate list. */
function reconcileFigures(s: PlanningSituation) {
  const carrying = s.candidateItems.filter((c) => c.disposition === "carry_forward");
  const undecided = s.candidateItems.filter((c) => UNDECIDED.includes(c.disposition));
  return {
    carryingForward: carrying.length,
    toDecide: undecided.length,
    missing: carrying.length + undecided.length,
    exited: s.candidateItems.filter((c) => c.disposition === "intentional_exit").length,
    carryingUnits: sum(carrying.map((c) => c.plannedUnits)),
    carryingValue: sum(carrying.map((c) => c.plannedValue)),
    toDecideUnits: sum(undecided.map((c) => c.plannedUnits)),
    toDecideValue: sum(undecided.map((c) => c.plannedValue)),
  };
}

/** Every line-month once, with formal counted once and carry-forward summed. */
function combinedCells(situations: readonly PlanningSituation[]) {
  const cells = new Map<string, { lineId: string; period: string; formal: number; added: number; available: number; target: number }>();
  for (const s of situations) {
    for (const c of s.capacityExposure.cells) {
      const key = `${c.lineId}::${c.period}`;
      const cell = cells.get(key) ?? { lineId: c.lineId, period: c.period, formal: c.formalHours, added: 0, available: c.availableHours, target: c.targetUtilizationPct };
      close(cell.formal, c.formalHours);
      cell.added += c.unresolvedHours;
      cells.set(key, cell);
    }
  }
  return cells;
}

describe.each(CASES)("reconciliation — $name", ({ dataset, situations, overrides }) => {
  it("has something to reconcile", () => {
    expect(situations.length).toBeGreaterThan(1);
    expect(sum(situations.map((s) => s.bridge.validatedUnits))).toBeGreaterThan(0);
  });

  /* ---------------- Overview headline ---------------- */

  it("Overview headline = Σ Reconcile = horizon totals", () => {
    const summary = summarizePortfolio(situations);
    const horizon = buildPlanningHorizon(situations);
    const perProgramme = situations.map(reconcileFigures);

    const missing = sum(perProgramme.map((p) => p.missing));
    const carrying = sum(perProgramme.map((p) => p.carryingForward));
    const toDecide = sum(perProgramme.map((p) => p.toDecide));

    // SKU counts: welcome panel (portfolio), timeline headline (horizon), Reconcile.
    expect(summary.unrepresentedSkuCount).toBe(missing);
    expect(missingItems(horizon.total)).toBe(missing);
    expect(summary.carryingForwardSkuCount).toBe(carrying);
    expect(horizon.total.items.carryingForward).toBe(carrying);
    expect(summary.undecidedSkuCount).toBe(toDecide);
    expect(horizon.total.items.toDecide).toBe(toDecide);
    expect(horizon.total.items.exited).toBe(sum(perProgramme.map((p) => p.exited)));
    for (const s of situations) expect(skuCounts(s)).toMatchObject(reconcileFigures(s));

    // Money and units: bridge.
    close(summary.unresolvedValue, sum(situations.map((s) => s.bridge.unresolvedValue)));
    close(horizon.total.missingValue, summary.unresolvedValue);
    close(horizon.total.missingUnits, sum(situations.map((s) => s.bridge.unresolvedUnits)));

    // The load-bearing figure, three ways.
    const validatedUnits = sum(situations.map((s) => s.bridge.validatedUnits));
    close(validatedUnits, sum(perProgramme.map((p) => p.carryingUnits)));
    close(summary.validatedUnits, validatedUnits);
    close(horizon.total.units.carryingForward, validatedUnits);
    close(horizon.total.value.carryingForward, sum(perProgramme.map((p) => p.carryingValue)));
    close(horizon.total.units.toDecide, sum(perProgramme.map((p) => p.toDecideUnits)));
    close(horizon.total.value.toDecide, sum(perProgramme.map((p) => p.toDecideValue)));
  });

  it("horizon months add up to the horizon total", () => {
    const horizon = buildPlanningHorizon(situations);
    expect(horizon.unphased).toEqual([]);
    for (const measure of ["units", "value"] as const) {
      for (const key of ["planned", "carryingForward", "toDecide", "unexplained", "exited"] as const) {
        close(sum(horizon.months.map((m) => m[measure][key])), horizon.total[measure][key]);
      }
    }
    close(sum(horizon.months.map((m) => m.missingValue)), horizon.total.missingValue);
  });

  /* ---------------- What that does to the plan ---------------- */

  it("Overview consequences = portfolio = Σ capacity cells", () => {
    const summary = summarizePortfolio(situations);
    const cells = combinedCells(situations);
    close(summary.formalHours, sum([...cells.values()].map((c) => c.formal)));
    close(summary.unresolvedHours, sum([...cells.values()].map((c) => c.added)));

    const expected = sum(situations.map((s) => s.bridge.expectedValue));
    close(summary.representedPct, sum(situations.map((s) => s.bridge.formalValue)) / expected);

    // Hours added = the carry-forward SKUs' own hours (SKU drawer), summed.
    const skuHours = sum(
      situations.flatMap((s) =>
        s.candidateItems
          .filter((c) => LOAD_BEARING_DISPOSITIONS.includes(c.disposition))
          .map((c) => skuImpact(s, c.id)?.totalHours ?? 0)
      )
    );
    close(skuHours, summary.unresolvedHours);
  });

  it("factory load series = capacity cells, and the plant total = Σ lines", () => {
    const cells = combinedCells(situations);
    const lines = listLoadLines(situations);
    expect(lines.length).toBeGreaterThan(0);
    const plant = buildLineLoadSeries(situations, ALL_LINES);

    const plantByMonth = new Map(plant.months.map((m) => [m.period, m]));
    const summedByMonth = new Map<string, { committed: number; added: number; capacity: number }>();

    for (const { lineId } of lines) {
      const series = buildLineLoadSeries(situations, lineId);
      for (const m of series.months) {
        const cell = cells.get(`${lineId}::${m.period}`)!;
        close(m.committedHours, cell.formal);
        close(m.addedHours, cell.added);
        close(m.capacityHours, cell.available);
        close(m.effectiveUtilization, (cell.formal + cell.added) / cell.available);
        const acc = summedByMonth.get(m.period) ?? { committed: 0, added: 0, capacity: 0 };
        acc.committed += m.committedHours;
        acc.added += m.addedHours;
        acc.capacity += m.capacityHours;
        summedByMonth.set(m.period, acc);
        close(sum(m.byProgramme.map((p) => p.hours)), m.addedHours);
      }
    }
    expect(plantByMonth.size).toBe(summedByMonth.size);
    for (const [period, acc] of summedByMonth) {
      const m = plantByMonth.get(period as never)!;
      close(m.committedHours, acc.committed);
      close(m.addedHours, acc.added);
      close(m.capacityHours, acc.capacity);
    }
  });

  it("every programme's capacity cell shows the line as Overview does", () => {
    // A SKU drawer, the copilot and Decisions read a programme's own cells. The
    // utilisation on them must be the line's — every programme's carry-forward
    // on top of the formal plan — or two pages quote two figures for one month.
    const cells = combinedCells(situations);
    for (const s of situations) {
      for (const c of s.capacityExposure.cells) {
        const line = cells.get(`${c.lineId}::${c.period}`)!;
        close(c.effectiveHours, line.formal + line.added);
        close(c.effectiveUtilization, (line.formal + line.added) / line.available);
      }
    }
  });

  /* ---------------- What changes once these SKUs count ---------------- */

  it("before/after = bridge and capacity sums; components = material exposure rows", () => {
    const { beforeAfter } = summarizePortfolio(situations);
    const cells = combinedCells(situations);
    close(beforeAfter.demandValueBefore, sum(situations.map((s) => s.bridge.formalValue)));
    close(beforeAfter.addedValue, sum(situations.map((s) => s.bridge.validatedValue)));
    close(beforeAfter.demandValueAfter, beforeAfter.demandValueBefore + beforeAfter.addedValue);
    close(beforeAfter.hoursBefore, sum([...cells.values()].map((c) => c.formal)));
    close(beforeAfter.addedHours, sum([...cells.values()].map((c) => c.added)));
    close(beforeAfter.hoursAfter, beforeAfter.hoursBefore + beforeAfter.addedHours);
    expect(beforeAfter.carriedForwardSkuCount).toBe(sum(situations.map((s) => reconcileFigures(s).carryingForward)));

    const rows = situations.flatMap((s) => s.materialExposure.rows.map((r) => ({ s, r })));
    expect(beforeAfter.components.length).toBe(rows.length);
    for (const { s, r } of rows) {
      const c = beforeAfter.components.find((x) => x.situationId === s.id && x.materialId === r.materialId)!;
      close(c.quantity, r.netRequirement ?? r.requirementBase);
      expect(c.decisionDate).toBe(r.decisionDate);
      expect(c.weeksToDecision).toBe(r.weeksToDecision);
    }

    if (beforeAfter.peak) {
      const peakCell = [...cells.values()]
        .filter((c) => c.added > 0)
        .map((c) => (c.formal + c.added) / c.available)
        .reduce((a, b) => Math.max(a, b), 0);
      close(beforeAfter.peak.effectiveUtilization, peakCell);
    }
  });

  /* ---------------- Decisions ---------------- */

  it("Decisions = material, capacity and representation data in the situations", () => {
    const upcoming = upcomingDecisions(situations, overrides);
    const portfolio = summarizePortfolio(situations);

    for (const s of situations) {
      const mine = upcoming.filter((d) => d.situationId === s.id);

      const orders = mine.filter((d) => d.kind === "material_order");
      const orderable = s.materialExposure.rows.filter((r) => r.status !== "WAIT");
      expect(orders.length).toBe(orderable.length);
      for (const r of orderable) {
        const d = orders.find((o) => o.materialId === r.materialId)!;
        close(d.quantity!, r.netRequirement ?? r.requirementBase);
        expect(d.date).toBe(r.decisionDate);
        expect(d.weeksAway).toBe(r.weeksToDecision);
        // Releasing records exactly the quantity shown.
        close(releaseFor(d, s.calculatedAt)!.quantity, d.quantity!);
      }

      const representation = mine.filter((d) => d.kind === "representation");
      const { toDecide } = reconcileFigures(s);
      expect(representation.length).toBe(toDecide > 0 ? 1 : 0);
      if (representation[0]) expect(representation[0].title).toContain(`${toDecide} product`);

      // Reconcile's footer counts this programme the way Decisions scopes to it.
      expect(upcomingDecisions([s], overrides).length).toBe(mine.length);

      // A line Overview shows past target because of this programme is a decision here.
      const lineDecisions = mine.filter((d) => d.kind === "line_capacity");
      const overTarget = s.capacityExposure.cells.filter((c) => c.effectiveUtilization > c.targetUtilizationPct && c.unresolvedHours > 0);
      expect(lineDecisions.length).toBe(overTarget.length > 0 ? 1 : 0);
    }

    // Overview's exposed lines = the programmes' exposed lines (Workspace list).
    expect(new Set(portfolio.exposedLines.map((l) => l.lineId))).toEqual(
      new Set(situations.flatMap((s) => s.capacityExposure.exposedLineIds))
    );
    // Any programme with an exposed line has a line-load decision on Decisions.
    for (const s of situations) {
      const hasDecision = upcoming.some((d) => d.situationId === s.id && d.kind === "line_capacity");
      expect(hasDecision).toBe(s.capacityExposure.exposedLineIds.length > 0);
    }

    // The capacity decision quotes the same utilisation Overview's line load shows.
    for (const d of upcoming.filter((x) => x.kind === "line_capacity")) {
      const [, lineId, period] = d.id.split(":");
      const month = buildLineLoadSeries(situations, lineId!).months.find((m) => m.period === period)!;
      expect(d.consequence).toContain(`Runs at ${Math.round(month.effectiveUtilization * 100)}%`);
    }

    // Blocked = WAIT rows.
    expect(blockedAcrossProgrammes(situations).length).toBe(
      sum(situations.map((s) => s.materialExposure.rows.filter((r) => r.status === "WAIT").length))
    );
    expect(portfolio.waitCount).toBe(blockedAcrossProgrammes(situations).length);

    // The next decision is one of the listed decisions.
    const next = nextDecision(upcoming);
    if (next) expect(upcoming).toContain(next);
  });

  it("pending decisions for one programme agree with the cross-programme list", () => {
    for (const s of situations) {
      const own = pendingDecisions(s, overrides[s.id]?.releases ?? {}).filter(
        (d) => !d.released && d.kind !== "production_start"
      );
      expect(own.map((d) => d.id)).toEqual(
        upcomingDecisions(situations, overrides).filter((d) => d.situationId === s.id).map((d) => d.id)
      );
    }
  });

  /* ---------------- Readiness ---------------- */

  it("readiness today = bridge.representedPct", () => {
    for (const s of situations) {
      const curve = buildReadinessCurve(s, dataset);
      expect(curve.todayPct).toBe(s.bridge.representedPct);
      if (curve.currentSeasonPace.length > 0) {
        expect(curve.currentSeasonPace[curve.currentSeasonPace.length - 1]!.representedPct).toBe(s.bridge.representedPct);
      }
    }
  });

  /* ---------------- Scenario Lab baseline (read-only) ---------------- */

  it("Scenario Lab demand plan (no overrides) = bridge", () => {
    for (const s of situations) {
      const plan = buildDemandPlan(dataset, s);
      const r = reconcileFigures(s);
      close(plan.total.targetValue, s.bridge.expectedValue);
      close(plan.total.formalValue, s.bridge.formalValue);
      close(plan.total.formalUnits, s.bridge.formalUnits);
      close(plan.total.gapToTargetValue, s.bridge.unresolvedValue);
      close(plan.total.missing.carryForwardValue, s.bridge.validatedValue);
      close(plan.total.missing.carryForwardUnits, s.bridge.validatedUnits);
      close(plan.total.missing.toDecideValue, r.toDecideValue);
      close(sum(plan.families.map((f) => f.formalValue)), plan.total.formalValue);
      close(sum(plan.families.map((f) => f.missing.carryForwardValue)), plan.total.missing.carryForwardValue);
    }
  });

  it("Scenario Lab capacity plan Before cells (no overrides) = Overview line load", () => {
    const plan = buildCapacityPlan(dataset, situations);
    expect(plan.available).toBe(true);
    for (const line of plan.lines) {
      const series = buildLineLoadSeries(situations, line.lineId);
      for (const cell of line.cells) {
        const month = series.months.find((m) => m.period === cell.period);
        if (!month) {
          // A month no programme produces in carries no carry-forward load.
          expect(cell.carryForwardHours).toBeCloseTo(0, 6);
          continue;
        }
        close(cell.formalHours, month.committedHours);
        close(cell.carryForwardHours, month.addedHours);
        close(cell.loadHours, month.committedHours + month.addedHours);
        close(cell.availableHours, month.capacityHours);
      }
    }
  });

  /* ---------------- Drawers ---------------- */

  it("SKU drawer and material drawer quantities = material exposure rows", () => {
    for (const s of situations) {
      for (const row of s.materialExposure.rows) {
        // The SKU drawer's per-item requirements add back to the row.
        const perSku = sum(
          s.candidateItems.map((c) => skuImpact(s, c.id)?.materials.find((m) => m.materialId === row.materialId)?.requirement ?? 0)
        );
        close(perSku, row.requirementBase);

        const detail = materialDetail(dataset, s, row.materialId)!;
        close(detail.requiredBase, row.requirementBase);
        close(sum(detail.contributors.map((c) => c.requirement)), row.requirementBase);
        // "Still to buy" on the drawer is the quantity Overview and Decisions order.
        close(detail.outstandingQty, row.netRequirement ?? row.requirementBase);
      }
    }
  });

  it("SKU drawer line peak = Overview line load for that month", () => {
    for (const s of situations) {
      for (const c of s.candidateItems.filter((x) => x.disposition === "carry_forward")) {
        const impact = skuImpact(s, c.id)!;
        for (const line of impact.lines) {
          const month = buildLineLoadSeries(situations, line.lineId).months.find((m) => m.period === line.peak.period)!;
          close(line.peak.effectiveUtilization, month.effectiveUtilization);
          close(line.peak.effectiveHours, month.committedHours + month.addedHours);
        }
      }
    }
  });
});

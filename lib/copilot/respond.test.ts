/**
 * Tests for the V2 copilot intent engine.
 *
 * Grounded in real data: `generateDemoDataset()` + `buildSituations()`, the
 * same pipeline `components/dataset/dataset-provider.tsx` runs. Assertions
 * compare against the situation's own computed fields (via the same `fmt*`
 * helpers `respond.ts` uses) rather than hand-typed numbers, so a change to
 * the demo dataset or the build pipeline cannot silently make these tests
 * pass for the wrong reason.
 */

import { describe, expect, it } from "vitest";
import { DEMO_PLANNING_NOW, generateDemoDataset } from "@/lib/dataset/demo/generate";
import { buildSituations } from "@/lib/situations/build";
import { respond } from "./respond";
import type { CopilotContext } from "./types";
import { formatMonthLabel } from "@/lib/dataset/periods";
import { fmtDateShort, fmtHours, fmtMoney, fmtPct, fmtWeeks } from "@/lib/utils/format";
import type { BusinessPlanRow, CurrentPlanRow, DatasetMetadata, HistoricalItemRow, PlanningDataset } from "@/types/dataset";

// Pinned to the demo's native anchor: the app defaults `planningNow` to
// the real current date, so a test that did not pin it would drift.
const dataset = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
const situations = buildSituations(dataset);

const halloween = situations.find((s) => s.eventOrProgram === "Halloween 2027")!;
const holiday = situations.find((s) => s.eventOrProgram === "Holiday 2027")!;
const valentine = situations.find((s) => s.eventOrProgram === "Valentine 2028")!;

it("fixture sanity: the demo dataset produced the three situations these tests assume", () => {
  expect(situations.length).toBe(3);
  expect(halloween).toBeDefined();
  expect(holiday).toBeDefined();
  expect(valentine).toBeDefined();
});

function ctx(overrides: Partial<CopilotContext> = {}): CopilotContext {
  return { situations, activeSituationId: null, pathname: "/overview", ...overrides };
}

/* ------------------------------------------------------------------ */
/* A situation with no capacity, material, or lead-time data at all   */
/* ------------------------------------------------------------------ */

function meta(planningNow: string): DatasetMetadata {
  return {
    id: "ds_unavailable",
    name: "No downstream data",
    mode: "UPLOADED",
    createdAt: "2027-01-01T00:00:00.000Z",
    planningNow,
    currency: "USD",
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

function buildUnavailableDataset(): PlanningDataset {
  const businessPlans: BusinessPlanRow[] = [
    {
      id: "bp1",
      planningPeriod: "2027-NoData",
      eventOrProgram: "NoData",
      businessUnit: "US",
      brand: "B",
      targetValue: 1000,
      targetUnits: 100,
    },
  ];
  const currentPlanItems: CurrentPlanRow[] = [
    {
      id: "cp1",
      planningPeriod: "2027-NoData",
      itemId: "item1",
      itemName: "Item 1",
      brand: "B",
      productFamily: "F",
      plannedUnits: 10,
      eventOrProgram: "NoData",
    },
  ];
  const historicalItems: HistoricalItemRow[] = [
    {
      id: "hi1",
      historicalPeriod: "2026-NoData",
      itemId: "item_h1",
      itemName: "Hist 1",
      brand: "OtherBrand",
      productFamily: "OtherFam",
      actualUnits: 50,
    },
  ];
  return {
    metadata: meta("2027-01-01"),
    businessPlans,
    currentPlanItems,
    historicalItems,
    boms: [],
    lineCapacity: [],
    itemLineMappings: [],
    leadTimeHistory: [],
    inventorySupply: [],
    readinessHistory: [], lineHistory: [],
  };
}

const unavailableSituation = buildSituations(buildUnavailableDataset())[0]!;

it("fixture sanity: the unavailable-data situation really has no capacity or material data", () => {
  expect(unavailableSituation.capacityExposure.available).toBe(false);
  expect(unavailableSituation.materialExposure.available).toBe(false);
});

/* ------------------------------------------------------------------ */
/* Explain the gap                                                     */
/* ------------------------------------------------------------------ */

describe("explain the gap", () => {
  it("reports expected / formal / unresolved / represented from the named situation's bridge", () => {
    const reply = respond("how big is the halloween gap", ctx());
    const { bridge } = halloween;

    expect(reply.action).toEqual({ kind: "none" });
    expect(reply.text).toContain(fmtMoney(bridge.expectedValue, bridge.currency));
    expect(reply.text).toContain(fmtMoney(bridge.formalValue, bridge.currency));
    expect(reply.text).toContain(fmtMoney(bridge.unresolvedValue, bridge.currency));
    expect(reply.text).toContain(fmtPct(bridge.representedPct));
    expect(reply.visualsUpdated).toContain("Reconcile");
  });

  it("falls back to activeSituationId when no situation is named in the question", () => {
    const reply = respond("why is there a gap here", ctx({ activeSituationId: valentine.id }));
    expect(reply.text).toContain(valentine.title);
    expect(reply.text).toContain(fmtMoney(valentine.bridge.unresolvedValue, valentine.bridge.currency));
  });
});

/* ------------------------------------------------------------------ */
/* Navigate                                                             */
/* ------------------------------------------------------------------ */

describe("navigate", () => {
  it("sends a capacity question to the items that cause it", () => {
    const reply = respond("open capacity for Halloween 2027", ctx());
    // Capacity is not a destination any more: it is what particular
    // unrepresented items do, so the answer is the list of those items.
    expect(reply.action).toEqual({ kind: "navigate", href: `/workspace/${halloween.id}/reconcile` });
    expect(reply.text).toMatch(/capacity/i);
    expect(reply.text).toMatch(/not represented/i);
  });

  it("sends a materials question to the same place, using the active situation", () => {
    const reply = respond("show materials", ctx({ activeSituationId: holiday.id }));
    expect(reply.action).toEqual({ kind: "navigate", href: `/workspace/${holiday.id}/reconcile` });
    expect(reply.text).toMatch(/materials/i);
  });

  it("resolves the situation from the pathname when nothing else names one", () => {
    const reply = respond("take me to reconcile", ctx({ pathname: `/workspace/${valentine.id}/capacity` }));
    expect(reply.action).toEqual({ kind: "navigate", href: `/workspace/${valentine.id}/reconcile` });
  });

  it("opens scenario lab, scoped to a situation", () => {
    const reply = respond("scenario lab", ctx({ activeSituationId: halloween.id }));
    expect(reply.action).toEqual({ kind: "navigate", href: `/scenario-lab?situation=${halloween.id}` });
  });

  it("opens overview and decisions without needing a situation", () => {
    expect(respond("open overview", ctx()).action).toEqual({ kind: "navigate", href: "/overview" });
    expect(respond("open decisions", ctx()).action).toEqual({ kind: "navigate", href: "/decisions" });
  });

  it("asks which situation when a situation-scoped command names none and nothing else resolves one", () => {
    const reply = respond("open capacity", ctx());
    expect(reply.action).toEqual({ kind: "none" });
    expect(reply.unavailable).toBeTruthy();
  });

  it("does not treat a plain question as a navigation command", () => {
    // "which line is exposed" has a question word and no nav verb, so it must
    // fall through to the capacity intent rather than "opening" anything.
    const reply = respond("which line is exposed for Halloween 2027", ctx());
    expect(reply.action).toEqual({ kind: "none" });
    expect(reply.visualsUpdated).toContain("Capacity");
  });
});

/* ------------------------------------------------------------------ */
/* Capacity                                                             */
/* ------------------------------------------------------------------ */

describe("capacity", () => {
  it("lists every exposed line for the situation", () => {
    const reply = respond("which line is exposed for Halloween 2027", ctx());
    expect(halloween.capacityExposure.exposedLineIds.length).toBeGreaterThan(0);
    for (const lineId of halloween.capacityExposure.exposedLineIds) {
      const name = halloween.capacityExposure.lines.find((l) => l.lineId === lineId)?.lineName;
      expect(reply.text).toContain(name);
    }
  });

  it("explains why a named line is exposed, quoting its nonzero deduction fields", () => {
    const reply = respond("why is line 03 red for Halloween 2027", ctx());
    const cell = halloween.capacityExposure.cells
      .filter((c) => c.lineId === "LINE-03")
      .reduce((worst, c) => (!worst || c.effectiveUtilization > worst.effectiveUtilization ? c : worst));

    expect(reply.text).toContain(cell.lineName);
    expect(reply.text).toContain(formatMonthLabel(cell.period));
    expect(reply.text).toContain(fmtPct(cell.formalUtilization));
    expect(reply.text).toContain(fmtPct(cell.effectiveUtilization));
    expect(reply.text).toContain(fmtHours(cell.availableHours));
    if (cell.plannedMaintenanceHours > 0) {
      expect(reply.text).toContain(`${fmtHours(cell.plannedMaintenanceHours)} maintenance`);
    }
    if (cell.projectDowntimeHours > 0) {
      expect(reply.text).toContain(`${fmtHours(cell.projectDowntimeHours)} project downtime`);
    }
    if (cell.laborConstraintHours > 0) {
      expect(reply.text).toContain(`${fmtHours(cell.laborConstraintHours)} labor constraint`);
    }
  });

  it("reports the peak cell when no line is named", () => {
    const reply = respond("what is the peak for Holiday 2027", ctx());
    const peak = holiday.capacityExposure.peak!;
    expect(reply.text).toContain(peak.lineName);
    expect(reply.text).toContain(formatMonthLabel(peak.period));
    expect(reply.text).toContain(fmtPct(peak.effectiveUtilization));
  });

  it("returns unavailable, never a fabricated number, when the situation has no capacity data", () => {
    const reply = respond(
      "what is the peak capacity",
      ctx({ situations: [unavailableSituation], activeSituationId: unavailableSituation.id })
    );
    expect(reply.action).toEqual({ kind: "none" });
    expect(reply.unavailable).toBe(unavailableSituation.capacityExposure.unavailableReason);
    expect(reply.text).toBe(unavailableSituation.capacityExposure.unavailableReason);
  });
});

/* ------------------------------------------------------------------ */
/* Materials                                                            */
/* ------------------------------------------------------------------ */

describe("materials", () => {
  it("reports the plan-now count and a driving reason", () => {
    const reply = respond("what can I plan now for Halloween 2027", ctx());
    expect(halloween.materialExposure.planNowCount).toBeGreaterThan(0);
    const example = halloween.materialExposure.rows.find((r) => r.status === "PLAN_NOW")!;
    expect(reply.text).toContain(String(halloween.materialExposure.planNowCount));
    expect(reply.text).toContain(example.materialName);
    expect(reply.text).toContain(example.reason);
  });

  it("reports what should wait", () => {
    const reply = respond("what should wait for Halloween 2027", ctx());
    expect(halloween.materialExposure.waitCount).toBeGreaterThan(0);
    expect(reply.text).toContain(String(halloween.materialExposure.waitCount));
  });

  it("names the material that drives the earliest decision date", () => {
    const reply = respond("which material is first for Halloween 2027", ctx());
    const earliest = halloween.materialExposure.earliestDecisionDate!;
    const driver = halloween.materialExposure.rows.find((r) => r.decisionDate === earliest)!;
    expect(reply.text).toContain(driver.materialName);
    expect(reply.text).toContain(fmtDateShort(earliest));
  });

  it("returns unavailable, never a fabricated number, when the situation has no material data", () => {
    const reply = respond(
      "what can I plan now",
      ctx({ situations: [unavailableSituation], activeSituationId: unavailableSituation.id })
    );
    expect(reply.action).toEqual({ kind: "none" });
    expect(reply.unavailable).toBe(unavailableSituation.materialExposure.unavailableReason);
  });
});

/* ------------------------------------------------------------------ */
/* Runway                                                               */
/* ------------------------------------------------------------------ */

describe("runway", () => {
  it("reports the earliest irreversible marker for the named situation", () => {
    const reply = respond("how long do I have for Halloween 2027", ctx());
    const marker = halloween.runway.earliest!;
    expect(reply.text).toContain(marker.label);
    expect(reply.text).toContain(fmtWeeks(marker.weeksAway));
    expect(reply.visualsUpdated).toContain("Decision runway");
  });

  it("says 'overdue' when the earliest marker is already in the past", () => {
    // The Halloween fixture's own material-commitment marker is already
    // negative (see fixture sanity below) — this asserts the real behaviour
    // rather than constructing a synthetic negative-runway situation.
    expect(halloween.runway.earliest!.weeksAway).toBeLessThan(0);
    const reply = respond("how long do I have for Halloween 2027", ctx());
    expect(reply.text).toContain("overdue");
  });

  it("answers 'what is irreversible first' the same way", () => {
    const reply = respond("what is irreversible first for Halloween 2027", ctx());
    expect(reply.text).toContain(halloween.runway.earliest!.label);
  });
});

/* ------------------------------------------------------------------ */
/* Reconciliation actions (set_disposition)                            */
/* ------------------------------------------------------------------ */

describe("reconciliation actions", () => {
  it("marks a uniquely-named prior item by a distinctive word in its name", () => {
    // Derived from the data rather than hardcoded, so the test survives a
    // rename of the demo items — it only needs *some* name that identifies
    // exactly one candidate.
    const target = halloween.candidateItems.find(
      (c) => halloween.candidateItems.filter((o) => o.itemName === c.itemName).length === 1
    );
    expect(target).toBeDefined();

    const reply = respond(
      `treat ${target!.itemName.toLowerCase()} as an intentional exit`,
      ctx({ activeSituationId: halloween.id })
    );
    expect(reply.action).toEqual({
      kind: "set_disposition",
      situationId: halloween.id,
      candidateIds: [target!.id],
      disposition: "intentional_exit",
    });
    expect(reply.text).toContain("1 item");
  });

  it("marks a prior item by its exact item id", () => {
    const target = halloween.candidateItems.find((c) => c.itemId === "SKU-HAL-H-20");
    expect(target).toBeDefined();

    const reply = respond(`mark ${target!.itemId} as already represented`, ctx({ activeSituationId: halloween.id }));
    expect(reply.action).toEqual({
      kind: "set_disposition",
      situationId: halloween.id,
      candidateIds: [target!.id],
      disposition: "already_represented",
    });
  });

  it("carries forward every unmatched item in bulk", () => {
    const unmatched = halloween.candidateItems.filter((c) => !c.match.matchedItemId);
    expect(unmatched.length).toBeGreaterThan(0);

    const reply = respond("carry forward everything unmatched", ctx({ activeSituationId: halloween.id }));
    expect(reply.action.kind).toBe("set_disposition");
    if (reply.action.kind !== "set_disposition") throw new Error("unreachable");
    expect(reply.action.situationId).toBe(halloween.id);
    expect(new Set(reply.action.candidateIds)).toEqual(new Set(unmatched.map((c) => c.id)));
    expect(reply.action.disposition).toBe("carry_forward");
    expect(reply.text).toContain(String(unmatched.length));
  });

  it("says nothing was found rather than guessing when no item matches", () => {
    const reply = respond("treat the nonexistent purple widget as intentional exit", ctx({ activeSituationId: halloween.id }));
    expect(reply.action).toEqual({ kind: "none" });
    expect(reply.unavailable).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* Scenario actions                                                    */
/* ------------------------------------------------------------------ */

describe("scenario actions", () => {
  it("sets available hours for a resolved month and line, in a new scenario", () => {
    const reply = respond("assume june capacity is 720 hours on line 03", ctx({ activeSituationId: halloween.id }));
    const period = halloween.capacityExposure.periods.find((p) => p.slice(5, 7) === "06");
    expect(period).toBeDefined();
    expect(reply.action).toEqual({
      kind: "set_available_hours",
      situationId: halloween.id,
      lineId: "LINE-03",
      period,
      hours: 720,
    });
    expect(reply.visualsUpdated).toContain("Scenario Lab");
  });

  it("sets a material's lead time in days, resolving the material by a distinctive word", () => {
    const reply = respond("use 81 day lead time for printed film", ctx({ activeSituationId: halloween.id }));
    const material = halloween.materialExposure.rows.find((r) => r.materialName.toLowerCase().includes("printed film"));
    expect(material).toBeDefined();
    expect(reply.action).toEqual({
      kind: "set_lead_time",
      situationId: halloween.id,
      materialId: material!.materialId,
      days: 81,
    });
    expect(reply.visualsUpdated).toContain("Scenario Lab");
  });

  it("reports unavailable rather than guessing a line when the situation has no capacity data", () => {
    const reply = respond(
      "assume june capacity is 500 hours",
      ctx({ situations: [unavailableSituation], activeSituationId: unavailableSituation.id })
    );
    expect(reply.action).toEqual({ kind: "none" });
    expect(reply.unavailable).toBe(unavailableSituation.capacityExposure.unavailableReason);
  });
});

/* ------------------------------------------------------------------ */
/* Unknown                                                              */
/* ------------------------------------------------------------------ */

describe("unknown", () => {
  it("names a few real capabilities instead of a canned apology", () => {
    const reply = respond("what is the meaning of life", ctx());
    expect(reply.action).toEqual({ kind: "none" });
    expect(reply.text.length).toBeGreaterThan(0);
    expect(reply.text).toMatch(/capacity|materials|scenario/i);
  });

  it("returns the unknown reply for empty input without throwing", () => {
    const reply = respond("   ", ctx());
    expect(reply.action).toEqual({ kind: "none" });
  });
});

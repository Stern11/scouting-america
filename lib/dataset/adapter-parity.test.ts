/**
 * Demo and Excel must be interchangeable input adapters.
 *
 * The demo generator emits rows keyed by the same snake_case columns the
 * workbook template uses, so writing those rows into a real .xlsx and reading
 * them back through the upload path must reproduce the same
 * `PlanningDataset` — and therefore the same transitions. If this fails, the
 * two adapters have diverged and demo and uploaded data no longer get the
 * identical product experience.
 */

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { DEMO_PLANNING_NOW, generateDemoDataset, generateDemoRawInput } from "@/lib/dataset/demo/generate";
import { validateWorkbook } from "@/lib/excel/validate";
import { buildTransitions } from "@/lib/transitions/build";
import { WORKBOOK_SCHEMA } from "@/lib/excel/schema";
import type { SheetName } from "@/lib/dataset/issues";
import type { PlanningDataset, RawPlanningInput, RawRow } from "@/types/dataset";
import type { TransitionView } from "@/types/transition";

/** Which field of the raw input carries each sheet's rows. */
const SHEET_SOURCES: Record<SheetName, Exclude<keyof RawPlanningInput, "metadata">> = {
  Stores: "stores",
  SKU_Master: "skus",
  SKU_Transitions: "transitions",
  Sales_History: "sales",
  Inventory: "inventory",
  Inbound_Supply: "inbound",
  Current_Plan: "currentPlan",
  Selling_Profiles: "sellingProfiles",
  Transition_History: "history",
};

/**
 * Writes the demo's raw rows into a genuine workbook — the same file shape a
 * planner uploads — rather than short-cutting straight into the parser.
 */
function demoAsWorkbook(): ArrayBuffer {
  // Same anchor as the dataset it is compared against.
  const raw = generateDemoRawInput({ planningNow: DEMO_PLANNING_NOW });
  const wb = XLSX.utils.book_new();

  for (const spec of WORKBOOK_SCHEMA) {
    const rows = (raw[SHEET_SOURCES[spec.name]] ?? []) as RawRow[];
    // Pin every template column so a sheet whose first row omits an optional
    // value still round-trips that column.
    const headers = spec.columns.map((c) => c.name);
    const normalized = rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const header of headers) out[header] = row[header] ?? null;
      return out;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(normalized, { header: headers }), spec.name);
  }

  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/** The numbers every page reads off a transition. */
function keyFigures(t: TransitionView) {
  return {
    id: t.id,
    status: t.status,
    riskKind: t.riskKind,
    horizonUnits: t.demand.horizonUnits,
    effectiveSupply: t.inventory.effectiveSupply,
    atRisk: t.coverage.atRiskCount,
    transfers: t.coverage.transferUnits,
    recommended: t.replenishment.recommendedUnits,
    stranded: t.sellThrough.remainingUnits,
    actions: t.actions.map((a) => a.id),
  };
}

describe("demo and Excel adapters produce the same dataset", () => {
  const demo = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
  const result = validateWorkbook(demoAsWorkbook(), {
    fileName: "demo.xlsx",
    planningNow: demo.metadata.planningNow,
    datasetId: "parity",
    datasetName: "Parity check",
  });
  const uploaded = (): PlanningDataset => {
    if (!result.dataset) throw new Error("workbook produced no dataset");
    return result.dataset;
  };

  it("round-trips the demo workbook with no blocking issue", () => {
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.summary.ready).toBe(true);
  });

  it("reports the same capabilities", () => {
    expect(uploaded().metadata.capabilities).toEqual(demo.metadata.capabilities);
  });

  it("normalizes every collection to identical rows", () => {
    const u = uploaded();
    // Whole-array equality catches coercion drift (dates, percents,
    // booleans), not just count drift.
    expect(u.stores).toEqual(demo.stores);
    expect(u.skus).toEqual(demo.skus);
    expect(u.transitions).toEqual(demo.transitions);
    expect(u.sales).toEqual(demo.sales);
    expect(u.inventory).toEqual(demo.inventory);
    expect(u.inbound).toEqual(demo.inbound);
    expect(u.currentPlan).toEqual(demo.currentPlan);
    expect(u.sellingProfiles).toEqual(demo.sellingProfiles);
    expect(u.history).toEqual(demo.history);
  });

  it("drives the planning engine to identical transitions", () => {
    const fromDemo = buildTransitions(demo);
    const fromUpload = buildTransitions(uploaded());
    expect(fromDemo.length).toBeGreaterThan(100);
    expect(fromUpload.map(keyFigures)).toEqual(fromDemo.map(keyFigures));
  });

  it("differs only in metadata, which records where the data came from", () => {
    expect(uploaded().metadata.mode).toBe("UPLOADED");
    expect(uploaded().metadata.sourceFileName).toBe("demo.xlsx");
    expect(demo.metadata.mode).toBe("DEMO");
    expect(demo.metadata.seed).toBeDefined();
  });
});

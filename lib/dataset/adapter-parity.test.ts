/**
 * Demo and Excel must be interchangeable input adapters (V2 §71).
 *
 * The demo generator emits rows keyed by the same snake_case columns the
 * workbook template uses, so writing those rows into a real .xlsx and reading
 * them back through the upload path must reproduce the same
 * `PlanningDataset` — and therefore the same situations. If this fails, the
 * two adapters have diverged and demo and uploaded data no longer get the
 * identical product experience.
 */

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { DEMO_PLANNING_NOW, generateDemoDataset, generateDemoRawInput } from "@/lib/dataset/demo/generate";
import { validateWorkbook } from "@/lib/excel/validate";
import { buildSituations } from "@/lib/situations/build";
import { WORKBOOK_SCHEMA } from "@/lib/excel/schema";
import type { RawRow } from "@/types/dataset";

/** Which field of the raw input carries each sheet's rows. */
const SHEET_SOURCES = {
  Business_Plan: "businessPlans",
  Current_Plan: "currentPlanItems",
  Historical_Items: "historicalItems",
  BOM: "boms",
  Line_Capacity: "lineCapacity",
  Item_Line_Mapping: "itemLineMappings",
  Lead_Time_History: "leadTimeHistory",
  Inventory_Supply: "inventorySupply",
  Readiness_History: "readinessHistory",
  Line_History: "lineHistory",
} as const;

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
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(normalized, { header: headers }),
      spec.name
    );
  }

  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("demo and Excel adapters produce the same dataset", () => {
  // Pinned to the demo's native anchor: the app defaults `planningNow` to
  // the real current date, so a test that did not pin it would drift.
  const demo = generateDemoDataset({ planningNow: DEMO_PLANNING_NOW });
  const result = validateWorkbook(demoAsWorkbook(), {
    fileName: "demo.xlsx",
    planningNow: demo.metadata.planningNow,
    datasetId: "parity",
    datasetName: "Parity check",
  });

  it("round-trips the demo workbook with no blocking issue", () => {
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.summary.ready).toBe(true);
    expect(result.dataset).not.toBeNull();
  });

  it("reports the same capabilities", () => {
    expect(result.dataset?.metadata.capabilities).toEqual(demo.metadata.capabilities);
  });

  it("normalizes every sheet to identical rows", () => {
    const uploaded = result.dataset;
    if (!uploaded) throw new Error("workbook produced no dataset");
    // Row ids are positional and so are stable across both adapters, which
    // means whole-array equality catches coercion drift, not just count drift.
    expect(uploaded.businessPlans).toEqual(demo.businessPlans);
    expect(uploaded.currentPlanItems).toEqual(demo.currentPlanItems);
    expect(uploaded.historicalItems).toEqual(demo.historicalItems);
    expect(uploaded.boms).toEqual(demo.boms);
    expect(uploaded.lineCapacity).toEqual(demo.lineCapacity);
    expect(uploaded.itemLineMappings).toEqual(demo.itemLineMappings);
    expect(uploaded.leadTimeHistory).toEqual(demo.leadTimeHistory);
    expect(uploaded.inventorySupply).toEqual(demo.inventorySupply);
    expect(uploaded.readinessHistory).toEqual(demo.readinessHistory);
    expect(uploaded.lineHistory).toEqual(demo.lineHistory);
  });

  it("drives the planning engine to identical situations", () => {
    const uploaded = result.dataset;
    if (!uploaded) throw new Error("workbook produced no dataset");

    const fromDemo = buildSituations(demo);
    const fromUpload = buildSituations(uploaded);

    expect(fromUpload.length).toBe(fromDemo.length);
    expect(fromDemo.length).toBeGreaterThan(0);

    for (const [index, expected] of fromDemo.entries()) {
      const actual = fromUpload[index];
      expect(actual).toBeDefined();
      if (!actual) continue;
      expect(actual.id).toBe(expected.id);
      expect(actual.state).toBe(expected.state);
      expect(actual.bridge).toEqual(expected.bridge);
      expect(actual.capacityExposure.cells).toEqual(expected.capacityExposure.cells);
      expect(actual.materialExposure.rows).toEqual(expected.materialExposure.rows);
      expect(actual.runway.markers).toEqual(expected.runway.markers);
    }
  });

  it("differs only in metadata, which records where the data came from", () => {
    expect(result.dataset?.metadata.mode).toBe("UPLOADED");
    expect(result.dataset?.metadata.sourceFileName).toBe("demo.xlsx");
    expect(demo.metadata.mode).toBe("DEMO");
    expect(demo.metadata.seed).toBeDefined();
  });
});

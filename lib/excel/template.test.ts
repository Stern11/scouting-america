import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildPlanningTemplate, TEMPLATE_FILENAME } from "@/lib/excel/template";
import { SHEET_NAMES } from "@/lib/dataset/issues";
import { WORKBOOK_SCHEMA } from "@/lib/excel/schema";

async function build() {
  const arrayBuffer = await buildPlanningTemplate();
  const buffer = Buffer.from(arrayBuffer);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  return { arrayBuffer, buffer, workbook };
}

describe("buildPlanningTemplate", () => {
  it("re-parses without error and is a non-trivial size", async () => {
    const { arrayBuffer, workbook } = await build();
    expect(arrayBuffer.byteLength).toBeGreaterThan(5000);
    expect(workbook.SheetNames.length).toBeGreaterThan(0);
  });

  it("exposes the expected filename constant", () => {
    expect(TEMPLATE_FILENAME).toBe("heizen-sku-transition-template.xlsx");
  });

  it("has every expected tab, in the right order", async () => {
    const { workbook } = await build();
    const expectedOrder = ["README", ...SHEET_NAMES, "Example_Data"];
    expect(workbook.SheetNames).toEqual(expectedOrder);
  });

  it("gives each input tab exactly the schema headers in order, and zero data rows", async () => {
    const { workbook } = await build();

    for (const spec of WORKBOOK_SCHEMA) {
      const ws = workbook.Sheets[spec.name];
      expect(ws, `missing worksheet ${spec.name}`).toBeDefined();
      if (!ws) continue;

      const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });
      expect(rows.length, `${spec.name} should have only a header row`).toBe(1);

      const headerRow = rows[0] as string[];
      const expectedHeaders = spec.columns.map((c) => c.name);
      expect(headerRow, `${spec.name} headers`).toEqual(expectedHeaders);
    }
  });

  it("has an Example_Data tab that contains rows and mentions every sheet name", async () => {
    const { workbook } = await build();
    const ws = workbook.Sheets["Example_Data"];
    expect(ws).toBeDefined();
    if (!ws) return;

    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });
    expect(rows.length).toBeGreaterThan(0);

    const flatText = rows
      .flat()
      .filter((v): v is string => typeof v === "string")
      .join(" \n ");

    for (const sheetName of SHEET_NAMES) {
      expect(flatText.includes(sheetName), `Example_Data should mention ${sheetName}`).toBe(true);
    }

    // Confirm actual example data values made it in, not just headings.
    const firstSpec = WORKBOOK_SCHEMA[0]!;
    const firstExampleValue = String(Object.values(firstSpec.exampleRows[0]!)[0]);
    expect(flatText.includes(firstExampleValue)).toBe(true);
  });

  it("README lists every sheet name and marks the required ones as Required", async () => {
    const { workbook } = await build();
    const ws = workbook.Sheets["README"];
    expect(ws).toBeDefined();
    if (!ws) return;

    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });

    for (const spec of WORKBOOK_SCHEMA) {
      const row = rows.find((r) => r[0] === spec.name && r[1] === (spec.required ? "Required" : "Optional"));
      expect(row, `README should list ${spec.name} as ${spec.required ? "Required" : "Optional"}`).toBeDefined();
    }
  });
});

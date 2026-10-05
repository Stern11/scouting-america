/**
 * Workbook contract -> downloadable .xlsx template.
 *
 * Entirely driven by `WORKBOOK_SCHEMA` (lib/excel/schema.ts) so the template
 * a planner downloads and the parser/validator that reads it back can never
 * drift apart. The input tabs carry the header row only — example data
 * must never be uploadable as if it were real (V2 §25) — so every filled
 * example row lives on its own `Example_Data` tab instead.
 */

import ExcelJS from "exceljs";
import { sheetSpec, WORKBOOK_SCHEMA, type ColumnSpec, type ColumnType, type SheetSpec } from "@/lib/excel/schema";

export const TEMPLATE_FILENAME = "heizen-sku-transition-template.xlsx";

const REQUIRED_HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F2937" },
};

const OPTIONAL_HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF6B7280" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };

const DEFAULT_COLUMN_WIDTH = 16;
/**
 * ExcelJS supports range-level data validation at runtime but leaves it out
 * of its typings; per-cell validation over 20,000 rows would bloat the file.
 */
interface RangeValidations {
  dataValidations: { add(range: string, validation: ExcelJS.DataValidation): void };
}

/** How far down dropdown validation reaches — well past any realistic paste. */
const VALIDATION_ROWS = 20000;

function numberFormatFor(type: ColumnType, name: string): string | undefined {
  switch (type) {
    case "date":
      return "yyyy-mm-dd";
    case "percent":
      return "0%";
    case "integer":
      return "#,##0";
    case "number":
      // Money and weeks need decimals (unit_cost 14.60, 2.5 weeks); everything
      // else is a whole unit count.
      return /cost|price|weeks/i.test(name) ? "#,##0.00" : "#,##0";
    default:
      return undefined;
  }
}

function buildInputSheet(workbook: ExcelJS.Workbook, spec: SheetSpec): void {
  const ws = workbook.addWorksheet(spec.name, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = spec.columns.map((col) => ({
    header: col.name,
    key: col.name,
    width: col.width ?? DEFAULT_COLUMN_WIDTH,
  }));

  const headerRow = ws.getRow(1);
  spec.columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.font = HEADER_FONT;
    cell.fill = col.required ? REQUIRED_HEADER_FILL : OPTIONAL_HEADER_FILL;
    cell.alignment = { vertical: "middle", horizontal: "left" };
  });
  headerRow.height = 20;
  headerRow.commit();

  // Apply number formats to the whole column (well past any pasted data)
  // so values a planner pastes in display correctly.
  spec.columns.forEach((col, idx) => {
    const format = numberFormatFor(col.type, col.name);
    if (!format) return;
    const column = ws.getColumn(idx + 1);
    column.numFmt = format;
  });

  // Enum and yes/no columns get a dropdown, so a planner picks a value the
  // parser accepts instead of discovering a typo on upload. Blank stays legal.
  spec.columns.forEach((col, idx) => {
    const values = col.type === "boolean" ? ["Y", "N"] : col.type === "enum" ? col.enumValues : undefined;
    if (!values?.length) return;
    const letter = ws.getColumn(idx + 1).letter;
    (ws as unknown as RangeValidations).dataValidations.add(`${letter}2:${letter}${VALIDATION_ROWS}`, {
      type: "list",
      allowBlank: true,
      formulae: [`"${values.join(",")}"`],
    });
  });

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: spec.columns.length },
  };
}

function sectionHeadingCell(ws: ExcelJS.Worksheet, rowNumber: number, text: string): void {
  const row = ws.getRow(rowNumber);
  const cell = row.getCell(1);
  cell.value = text;
  cell.font = { bold: true, size: 13 };
  row.commit();
}

function buildExampleDataSheet(workbook: ExcelJS.Workbook): void {
  const ws = workbook.addWorksheet("Example_Data");
  ws.properties.defaultColWidth = 20;

  let r = 1;
  for (const spec of WORKBOOK_SCHEMA) {
    sectionHeadingCell(ws, r, `${spec.name} — example rows (for reference only, not uploaded)`);
    r += 1;

    const headerRow = ws.getRow(r);
    spec.columns.forEach((col, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = col.name;
      cell.font = HEADER_FONT;
      cell.fill = col.required ? REQUIRED_HEADER_FILL : OPTIONAL_HEADER_FILL;
    });
    headerRow.commit();
    r += 1;

    for (const exampleRow of spec.exampleRows) {
      const dataRow = ws.getRow(r);
      spec.columns.forEach((col, idx) => {
        const value = exampleRow[col.name];
        dataRow.getCell(idx + 1).value = value === undefined ? "" : value;
      });
      dataRow.commit();
      r += 1;
    }

    r += 1; // blank spacer row between sheet sections
  }

  ws.columns.forEach((column) => {
    column.width = DEFAULT_COLUMN_WIDTH;
  });
}

function addTableRow(ws: ExcelJS.Worksheet, rowNumber: number, values: (string | number)[], opts?: { bold?: boolean; wrap?: boolean }): void {
  const row = ws.getRow(rowNumber);
  values.forEach((value, idx) => {
    const cell = row.getCell(idx + 1);
    cell.value = value;
    if (opts?.bold) cell.font = { bold: true };
    if (opts?.wrap) cell.alignment = { wrapText: true, vertical: "top" };
  });
  row.commit();
}

function buildReadmeSheet(workbook: ExcelJS.Workbook): void {
  const ws = workbook.addWorksheet("README");
  ws.columns = [
    { width: 22 },
    { width: 14 },
    { width: 46 },
    { width: 46 },
    { width: 24 },
  ];

  let r = 1;

  const title = ws.getRow(r);
  title.getCell(1).value = "Scout Shop Planner — SKU Transition Template";
  title.getCell(1).font = { bold: true, size: 16 };
  title.commit();
  r += 2;

  addTableRow(
    ws,
    r,
    [
      "This workbook is filled in by pasting exports from JDA MMS (store list, SKU master, sales, inventory, open POs), plus one sheet JDA cannot produce: which legacy SKUs and successor SKUs are the same product. It is read in your browser and never sent anywhere.",
    ],
    { wrap: true }
  );
  ws.mergeCells(r, 1, r, 5);
  r += 2;

  sectionHeadingCell(ws, r, "How to use");
  r += 1;
  const howTo = [
    "1. Export stores, the SKU master, sales, inventory and open POs from JDA MMS for the SKUs that are transitioning.",
    "2. Paste values under the matching headers on each tab — do not rename or reorder headers.",
    "3. Fill every dark-header (required) column; grey-header (optional) columns may stay blank.",
    "4. Leave the README and Example_Data tabs as reference only — do not add data to them.",
    "5. Save the file and upload it to the Scout Shop Planner.",
  ];
  for (const line of howTo) {
    addTableRow(ws, r, [line]);
    ws.mergeCells(r, 1, r, 5);
    r += 1;
  }
  r += 1;

  sectionHeadingCell(ws, r, "Conventions");
  r += 1;
  const conventions = [
    "Dates: write as YYYY-MM-DD (e.g. 2026-10-05).",
    "Numbers: enter plainly, no text or units in the cell (e.g. 12000, not \"12,000 units\").",
    "Percentages: 90, 90% or 0.9 are all read as 90%.",
    "Several SKUs in one cell (SKU_Transitions): separate them with commas, e.g. CS-1048, CS-1049.",
    "Yes/no columns: Y or N.",
    "Sales: any period length works — weekly, monthly, or one row per store for a recent window. Leave store_id blank for network totals.",
    "Blanks are allowed in optional (grey-header) columns; required (dark-header) columns must be filled.",
    "Do not rename or reorder the header row on any tab.",
    "Do not add data to the README or Example_Data tabs — they are reference only.",
  ];
  for (const line of conventions) {
    addTableRow(ws, r, [`• ${line}`]);
    ws.mergeCells(r, 1, r, 5);
    r += 1;
  }
  r += 1;

  addTableRow(ws, r, ["Legend: dark headers = required columns. Grey headers = optional columns."], {
    bold: true,
  });
  ws.mergeCells(r, 1, r, 5);
  r += 2;

  sectionHeadingCell(ws, r, "Sheets in this workbook");
  r += 1;
  addTableRow(ws, r, ["Sheet", "Required?", "Purpose", "If you leave it out"], { bold: true });
  r += 1;
  for (const spec of WORKBOOK_SCHEMA) {
    addTableRow(
      ws,
      r,
      [spec.name, spec.required ? "Required" : "Optional", spec.purpose, spec.absentConsequence],
      { wrap: true }
    );
    r += 1;
  }
  r += 1;

  sectionHeadingCell(ws, r, "Column reference");
  r += 1;

  for (const spec of WORKBOOK_SCHEMA) {
    const heading = ws.getRow(r);
    heading.getCell(1).value = `${spec.name} (${spec.required ? "Required" : "Optional"} sheet)`;
    heading.getCell(1).font = { bold: true, size: 12 };
    heading.commit();
    r += 1;

    addTableRow(ws, r, ["Column", "Required?", "Type", "What it means", "Example"], { bold: true });
    r += 1;

    for (const col of spec.columns as readonly ColumnSpec[]) {
      addTableRow(
        ws,
        r,
        [col.name, col.required ? "Required" : "Optional", col.type, col.purpose, col.example],
        { wrap: true }
      );
      r += 1;
    }
    r += 1; // spacer between sheets
  }
}

export async function buildPlanningTemplate(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Scout Shop Planner";
  workbook.created = new Date();

  buildReadmeSheet(workbook);

  for (const spec of WORKBOOK_SCHEMA) {
    buildInputSheet(workbook, spec);
  }

  buildExampleDataSheet(workbook);

  const buffer = await workbook.xlsx.writeBuffer();
  // exceljs types writeBuffer as returning a Buffer; normalize to a plain
  // ArrayBuffer so callers (including the Response constructor) get a type
  // that isn't tied to Node's Buffer.
  return toArrayBuffer(buffer);
}

function toArrayBuffer(buffer: ExcelJS.Buffer): ArrayBuffer {
  if (buffer instanceof ArrayBuffer) return buffer;
  const view = buffer as unknown as Uint8Array;
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

// Re-exported so tests/other callers can look up a sheet's spec without a
// second import of lib/excel/schema.
export { sheetSpec };

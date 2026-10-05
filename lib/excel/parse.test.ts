import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseWorkbook } from "./parse";
import { buildTestWorkbook, validSheets } from "./fixtures";

describe("parseWorkbook", () => {
  it("parses every sheet of a valid workbook into raw rows keyed by header", () => {
    const parsed = parseWorkbook(buildTestWorkbook(validSheets()));

    expect(parsed.unknownSheets).toEqual([]);
    expect(parsed.sheets.get("Stores")).toHaveLength(2);
    expect(parsed.sheets.get("SKU_Master")).toHaveLength(2);
    expect(parsed.sheets.get("Sales_History")).toHaveLength(5);

    const sku = parsed.sheets.get("SKU_Master")![0]!;
    expect(sku["sku_id"]).toBe("CS-1048");
    expect(sku["lead_time_days"]).toBe(56);
  });

  it("records the workbook's own headers per sheet", () => {
    const headers = parseWorkbook(buildTestWorkbook(validSheets())).headers.get("Inventory")!;
    expect(headers).toContain("location_type");
    expect(headers).toContain("on_hand");
  });

  it("returns Date objects for date-typed cells, not serials or strings", () => {
    const buffer = buildTestWorkbook({
      Inbound_Supply: [
        { sku_id: "CS-2841", location_id: "DC-CLT", quantity: 600, expected_receipt_date: new Date(Date.UTC(2026, 9, 26)) },
      ],
    });
    const row = parseWorkbook(buffer).sheets.get("Inbound_Supply")![0]!;
    expect(row["expected_receipt_date"]).toBeInstanceOf(Date);
  });

  it("returns real numbers for numeric cells, not strings", () => {
    const row = parseWorkbook(buildTestWorkbook(validSheets())).sheets.get("Inventory")![0]!;
    expect(typeof row["on_hand"]).toBe("number");
  });

  it("ignores README and Example_Data tabs silently", () => {
    const buffer = buildTestWorkbook({
      ...validSheets(),
      // @ts-expect-error -- deliberately not a SheetName, simulating our own generated tabs
      README: [{ note: "read this" }],
    });
    expect(parseWorkbook(buffer).unknownSheets).toEqual([]);
  });

  it("collects tabs it does not recognise as unknownSheets", () => {
    const wb = XLSX.read(buildTestWorkbook(validSheets()), { type: "array" });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ foo: "bar" }]), "Vendor_Scorecard");
    const withExtra = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(parseWorkbook(withExtra).unknownSheets).toContain("Vendor_Scorecard");
  });

  it("skips rows that are entirely blank", () => {
    const buffer = buildTestWorkbook({
      Stores: [
        { store_id: "ST-014", store_name: "Dallas #14" },
        { store_id: null, store_name: null },
      ],
    });
    expect(parseWorkbook(buffer).sheets.get("Stores")).toHaveLength(1);
  });

  it("matches sheet names case/spacing-insensitively", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ store_id: "ST-014", store_name: "Dallas #14" }]), "sales history");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ sku_id: "A", sku_name: "A" }]), "sku master");
    const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const parsed = parseWorkbook(buffer);
    expect(parsed.sheets.get("Sales_History")).toHaveLength(1);
    expect(parsed.sheets.get("SKU_Master")).toHaveLength(1);
    expect(parsed.unknownSheets).toEqual([]);
  });
});

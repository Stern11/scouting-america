import { describe, expect, it } from "vitest";
import { validateWorkbook } from "./validate";
import { buildTestWorkbook, validSheets } from "./fixtures";
import type { SheetName } from "@/lib/dataset/issues";

const OPTS = {
  fileName: "jda-transition-export.xlsx",
  planningNow: "2026-10-05",
  datasetId: "ds_test",
  datasetName: "Test Upload",
};

type Sheets = Partial<Record<SheetName, Record<string, unknown>[]>>;

function row0(sheets: Sheets, sheet: SheetName): Record<string, unknown> {
  return { ...sheets[sheet]![0]! };
}

describe("validateWorkbook — clean input", () => {
  it("parses and validates a valid workbook clean", () => {
    const result = validateWorkbook(buildTestWorkbook(validSheets()), OPTS);

    expect(result.dataset).not.toBeNull();
    expect(result.summary.errors).toBe(0);
    expect(result.summary.ready).toBe(true);
    expect(result.scope).toMatchObject({
      storeCount: 2,
      skuCount: 2,
      explicitTransitionCount: 1,
      plannedTransitionCount: 1,
      suggestedTransitionCount: 0,
      salesFrom: "2026-08-01",
      salesTo: "2026-10-04",
    });
    expect(result.scope!.unavailable).toEqual([]);
    expect(result.dataset!.metadata.currency).toBe("USD");
    expect(result.dataset!.metadata.mode).toBe("UPLOADED");
  });

  it("counts the transitions Heizen will suggest on top of the explicit ones", () => {
    const sheets = validSheets();
    delete sheets.SKU_Transitions;
    const result = validateWorkbook(buildTestWorkbook(sheets), OPTS);
    expect(result.scope!.explicitTransitionCount).toBe(0);
    // CS-1048 is discontinued with no replacement; CS-2841 matches it.
    expect(result.scope!.plannedTransitionCount).toBe(1);
    expect(result.scope!.suggestedTransitionCount).toBe(1);
  });
});

describe("validateWorkbook — structural problems", () => {
  it("reports an error for a missing required sheet", () => {
    const sheets = validSheets();
    delete sheets.Inventory;
    const result = validateWorkbook(buildTestWorkbook(sheets), OPTS);

    expect(result.summary.ready).toBe(false);
    expect(result.issues.some((i) => i.code === "missing_sheet_Inventory")).toBe(true);
    // Still not structurally unusable — the workbook itself was readable.
    expect(result.dataset).not.toBeNull();
  });

  it("does not require the optional SKU_Transitions sheet", () => {
    const sheets = validSheets();
    delete sheets.SKU_Transitions;
    const result = validateWorkbook(buildTestWorkbook(sheets), OPTS);
    expect(result.summary.ready).toBe(true);
  });

  it("reports an error for a missing required column", () => {
    const sheets = validSheets();
    sheets.Inventory = sheets.Inventory!.map((r) => {
      const copy = { ...r };
      delete copy.location_id;
      return copy;
    });
    const result = validateWorkbook(buildTestWorkbook(sheets), OPTS);

    expect(result.issues.some((i) => i.code === "missing_column_location_id" && i.sheet === "Inventory")).toBe(true);
    expect(result.summary.ready).toBe(false);
  });

  it("returns dataset: null only when the file cannot be read as a workbook at all", () => {
    // A truncated .xlsx is a broken zip, which is how an unreadable file
    // actually arrives — SheetJS reads plain text happily as CSV.
    const full = buildTestWorkbook(validSheets());
    const result = validateWorkbook(full.slice(0, Math.floor(full.byteLength / 3)), OPTS);

    expect(result.dataset).toBeNull();
    expect(result.scope).toBeNull();
    expect(result.issues.some((i) => i.code === "unreadable_workbook")).toBe(true);
  });
});

describe("validateWorkbook — row-level problems surfaced from normalize", () => {
  it("flags an invalid on_hand value as an error", () => {
    const sheets = validSheets();
    sheets.Inventory = [{ ...row0(sheets, "Inventory"), on_hand: "lots" }];
    const issue = validateWorkbook(buildTestWorkbook(sheets), OPTS).issues.find((i) => i.code === "invalid_on_hand");
    expect(issue?.severity).toBe("error");
  });

  it("flags an unreadable optional date as a warning, not a blocking error", () => {
    const sheets = validSheets();
    sheets.SKU_Transitions = [{ ...row0(sheets, "SKU_Transitions"), target_completion_date: "end of fall" }];
    const result = validateWorkbook(buildTestWorkbook(sheets), OPTS);
    const issue = result.issues.find((i) => i.code === "invalid_target_completion_date");
    expect(issue?.severity).toBe("warning");
    expect(result.summary.ready).toBe(true);
  });

  it("warns and drops sales for a SKU that is not in the SKU master", () => {
    const sheets = validSheets();
    sheets.Sales_History = [...sheets.Sales_History!, { sku_id: "XX-0000", period_start: "2026-09-01", period_end: "2026-09-30", units_sold: 5 }];
    const result = validateWorkbook(buildTestWorkbook(sheets), OPTS);
    const issue = result.issues.find((i) => i.code === "unknown_sku" && i.sheet === "Sales_History");
    expect(issue?.severity).toBe("warning");
    expect(result.dataset!.sales.some((r) => r.skuId === "XX-0000")).toBe(false);
    expect(result.summary.ready).toBe(true);
  });

  it("flags a duplicate SKU as an error and keeps the first", () => {
    const sheets = validSheets();
    sheets.SKU_Master = [...sheets.SKU_Master!, { ...row0(sheets, "SKU_Master"), sku_name: "Duplicate" }];
    const result = validateWorkbook(buildTestWorkbook(sheets), OPTS);
    expect(result.issues.find((i) => i.code === "duplicate_sku")?.severity).toBe("error");
    expect(result.dataset!.skus.filter((s) => s.skuId === "CS-1048")).toHaveLength(1);
    expect(result.summary.ready).toBe(false);
  });

  it("flags a bad location_type as an error", () => {
    const sheets = validSheets();
    sheets.Inventory = [{ ...row0(sheets, "Inventory"), location_type: "WAREHOUSE" }];
    const result = validateWorkbook(buildTestWorkbook(sheets), OPTS);
    expect(result.issues.find((i) => i.code === "invalid_location_type")?.severity).toBe("error");
  });
});

describe("validateWorkbook — optional sheets absent", () => {
  it("degrades capabilities without blocking readiness, and explains what is unavailable", () => {
    const sheets = validSheets();
    delete sheets.Inbound_Supply;
    delete sheets.Current_Plan;
    delete sheets.Selling_Profiles;
    delete sheets.Transition_History;
    const result = validateWorkbook(buildTestWorkbook(sheets), OPTS);

    expect(result.summary.errors).toBe(0);
    expect(result.summary.ready).toBe(true);
    expect(result.scope!.capabilities.inboundSupply).toBe(false);
    expect(result.scope!.capabilities.currentPlan).toBe(false);
    expect(result.scope!.capabilities.sellingProfiles).toBe(false);
    expect(result.scope!.unavailable).toContain("Inbound supply not included — recommendations count only stock on hand.");
    expect(result.scope!.unavailable.some((m) => m.includes("Current_Plan"))).toBe(true);
    expect(result.summary.infos).toBeGreaterThan(0);
  });

  it("says so when store-level sales are missing", () => {
    const sheets = validSheets();
    sheets.Sales_History = sheets.Sales_History!.filter((r) => !r.store_id);
    const result = validateWorkbook(buildTestWorkbook(sheets), OPTS);
    expect(result.scope!.capabilities.storeLevelDemand).toBe(false);
    expect(result.scope!.unavailable).toContain("Add store-level sales to see where stock will run out.");
  });

  it("says so when a transitioning SKU has no unit cost", () => {
    const sheets = validSheets();
    sheets.SKU_Master = sheets.SKU_Master!.map((r) => ({ ...r, unit_cost: null }));
    const result = validateWorkbook(buildTestWorkbook(sheets), OPTS);
    expect(result.scope!.capabilities.unitCosts).toBe(false);
    expect(result.scope!.unavailable.some((m) => m.includes("unit_cost"))).toBe(true);
  });
});

describe("validateWorkbook — column mapping end to end", () => {
  it("auto-maps an alias header so the value reaches the dataset with no missing-column error", () => {
    const sheets = validSheets();
    sheets.Sales_History = sheets.Sales_History!.map((r) => {
      const copy: Record<string, unknown> = { ...r, qty_sold: r.units_sold };
      delete copy.units_sold;
      return copy;
    });
    const result = validateWorkbook(buildTestWorkbook(sheets), OPTS);

    expect(result.issues.some((i) => i.code === "missing_column_units_sold")).toBe(false);
    expect(result.dataset!.sales[0]!.units).toBe(1400);
    const res = result.mapping.resolutions.find((r) => r.sheet === "Sales_History" && r.expected === "units_sold");
    expect(res?.status).toBe("aliased");
  });

  it("applies a manual mapping for a header nothing could resolve", () => {
    const sheets = validSheets();
    sheets.Stores = sheets.Stores!.map((r) => {
      const copy: Record<string, unknown> = { ...r, shop_label: r.store_name };
      delete copy.store_name;
      return copy;
    });
    const buffer = buildTestWorkbook(sheets);
    const first = validateWorkbook(buffer, OPTS);
    expect(first.issues.some((i) => i.code === "missing_column_store_name")).toBe(true);

    const manual = new Map<SheetName, Map<string, string>>([["Stores", new Map([["store_name", "shop_label"]])]]);
    const second = validateWorkbook(buffer, { ...OPTS, manualMapping: manual });
    expect(second.summary.ready).toBe(true);
    expect(second.dataset!.stores[0]!.storeName).toBe("Dallas #14");
  });
});
